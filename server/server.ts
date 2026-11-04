import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { isDifficultyLevel } from "../src/difficulty.ts";
import { LEVELS } from "../src/levels.ts";
import {
	CLOSE_REPLACED, FRAG_LIMITS, GAME_MODES, HEARTBEAT, NET_PATH, SILENCE_LIMIT, TIME_LIMITS,
	type ClientMessage, type GameMode, type RoomSetup, type ServerMessage,
} from "../src/net/protocol.ts";
import { setModelSource } from "../src/nsh.ts";
import { cleanName } from "../src/scores.ts";
import type { Member, Room } from "./room.ts";
import { Rooms } from "./rooms.ts";

export interface GameServerOptions {
	/** 0 picks a free port */
	port: number;
	/** Built game (dist/) to serve; null to serve nothing but the game connection */
	staticDir: string | null;
	/** Where .nsh models are read from */
	modelsDir: string;
	/** How often rooms are advanced (ms) */
	tick?: number;
}

export interface GameServer {
	readonly port: number;
	readonly rooms: Rooms;
	close(): Promise<void>;
}

/** Largest message a browser may send (bytes) */
const MAX_MESSAGE = 64 * 1024;
/** Messages a browser may send per second over time, and at once; a flying browser sends about 30 a second */
const MESSAGE_RATE = 100;
const MESSAGE_BURST = 300;
/** Tries at a room code per second over time, and at once: guessing the codes takes days */
const JOIN_RATE = 1;
const JOIN_BURST = 5;

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
	".nsh": "text/plain; charset=utf-8",
	".ico": "image/x-icon",
};

/** Serves the game over HTTP and its rooms over a WebSocket at NET_PATH */
export async function startGameServer({ port, staticDir, modelsDir, tick = 10 }: GameServerOptions): Promise<GameServer> {
	setModelSource(name => readFile(join(modelsDir, `${name}.nsh`), "latin1"));

	const rooms = new Rooms();
	const http = createServer((request, response) => {
		serveStatic(staticDir, request, response).catch(() => {
			response.writeHead(500).end();
		});
	});
	const sockets = new WebSocketServer({ server: http, path: NET_PATH, maxPayload: MAX_MESSAGE });
	sockets.on("connection", socket => connect(socket, rooms));

	let last = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		rooms.advance((now - last) / 1000);
		last = now;
	}, tick);

	await new Promise<void>(done => http.listen(port, done));

	return {
		port: (http.address() as AddressInfo).port,
		rooms,
		close: () => new Promise<void>(done => {
			clearInterval(timer);
			for (const client of sockets.clients) { client.terminate(); }
			sockets.close();
			http.close(() => done());
		}),
	};
}

/** A browser: in at most one room at a time; its connection may be replaced by a new one (resume) */
class Client implements Member {
	readonly id: number;
	readonly token = randomBytes(18).toString("base64url");
	name = cleanName("");
	room: Room | null = null;
	socket: WebSocket;

	constructor(id: number, socket: WebSocket) {
		this.id = id;
		this.socket = socket;
	}

	send(message: ServerMessage): void {
		if (this.socket.readyState == WebSocket.OPEN) { this.socket.send(JSON.stringify(message)); }
	}
}

const PING = JSON.stringify({ type: "ping" } satisfies ServerMessage);

/** Allows so many things per second over time, and `burst` at once */
function rateLimit(rate: number, burst: number): () => boolean {
	let left = burst;
	let last = performance.now();
	return () => {
		const now = performance.now();
		left = Math.min(burst, left + rate * (now - last) / 1000);
		last = now;
		if (left < 1) { return false; }
		left--;
		return true;
	};
}

/** One connection: a new client, or one taking its place back after its previous connection dropped */
function connect(socket: WebSocket, rooms: Rooms): void {
	let client = new Client(rooms.newMemberId(), socket);
	const error = (message: string) => client.send({ type: "error", message });
	const leave = () => {
		if (client.room) { rooms.leave(client.room, client.id); }
		client.room = null;
	};

	/* a connection can die without closing (a network that went away): silence tells */
	let heard = performance.now();
	const heartbeat = setInterval(() => {
		if (performance.now() - heard > SILENCE_LIMIT * 1000) {
			socket.terminate();
			return;
		}
		socket.ping(); /* browsers answer these by themselves */
		if (socket.readyState == WebSocket.OPEN) { socket.send(PING); } /* for the browser's own check */
	}, HEARTBEAT * 1000);
	socket.on("pong", () => { heard = performance.now(); });

	const messageAllowed = rateLimit(MESSAGE_RATE, MESSAGE_BURST);
	const joinAllowed = rateLimit(JOIN_RATE, JOIN_BURST);

	socket.on("message", (data: RawData) => {
		heard = performance.now();
		if (!messageAllowed()) { return; }
		const message = parse(data);
		if (!message) { return; }
		const room = client.room;

		switch (message.type) {
			case "create": {
				if (!validLevel(message.level) || !isDifficultyLevel(String(message.difficulty))) { return error("Unknown level or difficulty."); }
				leave();
				client.name = cleanName(String(message.name ?? ""));
				client.room = rooms.create(client, message.level, message.difficulty);
				if (!client.room) { return error("The server is full. Try again later."); }
				client.room.welcome(client);
			} break;

			case "join": {
				if (!joinAllowed()) { return error("Too many tries. Wait a moment and try again."); }
				const found = rooms.find(String(message.code ?? ""));
				if (!found) { return error(`No room with the code ${String(message.code ?? "").trim().toUpperCase()}.`); }
				if (found == room) { return; }
				leave();
				client.name = cleanName(String(message.name ?? ""));
				const refused = found.join(client);
				if (refused) { return error(refused); }
				client.room = found;
			} break;

			case "resume": {
				if (room) { return; }
				const found = rooms.findMember(String(message.token ?? ""));
				if (!found) { return error("Your place in the room is gone: the room closed, or you were away too long."); }
				/* every member is a Client: this server creates them all */
				const back = found.member as Client;
				const previous = back.socket;
				back.socket = socket;
				client = back;
				/* the old connection may still be open: another tab, or a drop the server has not noticed yet */
				if (previous != socket) { previous.close(CLOSE_REPLACED, "Taken over by another connection"); }
				found.room.reconnected(back.id);
			} break;

			case "name": room?.rename(client.id, String(message.name ?? "")); break;

			case "setup":
				if (validSetup(message)) { room?.setup(client.id, message); }
			break;

			case "start": room?.start(client.id, validLevel(message.level) ? message.level : undefined); break;
			case "lobby": room?.toLobby(client.id); break;
			case "state": room?.report(client.id, message); break;
			case "leave": leave(); break;
		}
	});

	/* the client keeps its place for a while, unless it already took it back on a newer connection */
	const dropped = () => {
		clearInterval(heartbeat);
		if (client.socket == socket) { client.room?.disconnected(client.id); }
	};
	socket.on("close", dropped);
	socket.on("error", dropped);
}

const validLevel = (level: unknown): level is number => Number.isInteger(level) && Boolean(LEVELS[level as number]);
const validSetup = ({ mode, level, difficulty, fragLimit, timeLimit }: RoomSetup): boolean => (GAME_MODES.includes(mode as GameMode)
	&& validLevel(level) && isDifficultyLevel(String(difficulty))
	&& (FRAG_LIMITS as readonly number[]).includes(fragLimit) && (TIME_LIMITS as readonly number[]).includes(timeLimit));

const MESSAGE_TYPES = new Set<ClientMessage["type"]>(["create", "join", "name", "setup", "start", "lobby", "state", "leave", "resume"]);

/** A message's shape is checked further where its fields are used */
function parse(data: RawData): ClientMessage | null {
	try {
		const message: unknown = JSON.parse(String(data));
		if (typeof message != "object" || message === null) { return null; }
		const type = (message as { type?: unknown }).type;
		return (MESSAGE_TYPES.has(type as ClientMessage["type"]) ? message as ClientMessage : null);
	} catch {
		return null;
	}
}

/** Files of the built game; anything else gets index.html, so that invite links (?room=…) work */
async function serveStatic(root: string | null, request: IncomingMessage, response: ServerResponse): Promise<void> {
	if (!root || (request.method != "GET" && request.method != "HEAD")) {
		response.writeHead(root ? 405 : 404, { "content-type": "text/plain" }).end(root ? "" : "Only the game connection is served here.");
		return;
	}

	const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
	const base = resolve(root);
	let file = resolve(base, normalize(`.${sep}${path}`));
	if (file != base && !file.startsWith(base + sep)) {
		response.writeHead(403).end();
		return;
	}

	const info = await stat(file).catch(() => null);
	if (!info?.isFile()) { file = join(base, "index.html"); }
	const body = await readFile(file).catch(() => null);
	if (!body) {
		response.writeHead(404, { "content-type": "text/plain" }).end("Build the game first: pnpm build");
		return;
	}

	response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
	response.end(request.method == "HEAD" ? undefined : body);
}
