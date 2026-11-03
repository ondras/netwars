import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { isDifficultyLevel } from "../src/difficulty.ts";
import { LEVELS } from "../src/levels.ts";
import { NET_PATH, type ClientMessage, type ServerMessage } from "../src/net/protocol.ts";
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

/** One browser: in at most one room at a time */
function connect(socket: WebSocket, rooms: Rooms): void {
	const member: Member = {
		id: rooms.newMemberId(),
		name: cleanName(""),
		send(message: ServerMessage) {
			if (socket.readyState == WebSocket.OPEN) { socket.send(JSON.stringify(message)); }
		},
	};
	let room: Room | null = null;
	const error = (message: string) => member.send({ type: "error", message });
	const leave = () => {
		if (room) { rooms.leave(room, member.id); }
		room = null;
	};

	socket.on("message", (data: RawData) => {
		const message = parse(data);
		if (!message) { return; }

		switch (message.type) {
			case "create": {
				if (!validLevel(message.level) || !isDifficultyLevel(String(message.difficulty))) { return error("Unknown level or difficulty."); }
				leave();
				member.name = cleanName(String(message.name ?? ""));
				room = rooms.create(member, message.level, message.difficulty);
				if (!room) { return error("The server is full. Try again later."); }
				member.send({ type: "welcome", you: member.id, room: room.info() });
			} break;

			case "join": {
				const found = rooms.find(String(message.code ?? ""));
				if (!found) { return error(`No room with the code ${String(message.code ?? "").trim().toUpperCase()}.`); }
				if (found == room) { return; }
				leave();
				member.name = cleanName(String(message.name ?? ""));
				const refused = found.join(member);
				if (refused) { return error(refused); }
				room = found;
			} break;

			case "name": room?.rename(member.id, String(message.name ?? "")); break;

			case "setup":
				if (validLevel(message.level) && isDifficultyLevel(String(message.difficulty))) {
					room?.setup(member.id, message.level, message.difficulty);
				}
			break;

			case "start": room?.start(member.id, validLevel(message.level) ? message.level : undefined); break;
			case "lobby": room?.toLobby(member.id); break;
			case "state": room?.report(member.id, message); break;
			case "leave": leave(); break;
		}
	});
	socket.on("close", leave);
	socket.on("error", leave);
}

const validLevel = (level: unknown): level is number => Number.isInteger(level) && Boolean(LEVELS[level as number]);

const MESSAGE_TYPES = new Set<ClientMessage["type"]>(["create", "join", "name", "setup", "start", "lobby", "state", "leave"]);

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
