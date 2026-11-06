import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CLOSE_REPLACED, NET_PATH, type ClientMessage, type ServerMessage } from "../src/net/protocol.ts";
import { startGameServer, type GameServer } from "./server.ts";

let server: GameServer;

beforeAll(async () => {
	server = await startGameServer({ port: 0, staticDir: null, modelsDir: fileURLToPath(new URL("../public/models", import.meta.url)) });
});
afterAll(() => server.close());

/** A browser, as far as the server can tell */
class Client {
	readonly messages: ServerMessage[] = [];
	/** Resolves with the close code once the server closes the connection */
	readonly closed: Promise<number>;
	private readonly socket: WebSocket;
	private waiting: Array<() => void> = [];

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.on("message", data => {
			this.messages.push(JSON.parse(String(data)) as ServerMessage);
			for (const check of this.waiting) { check(); }
		});
		this.closed = new Promise(done => socket.once("close", code => done(code)));
	}

	static open(): Promise<Client> {
		const socket = new WebSocket(`ws://127.0.0.1:${server.port}${NET_PATH}`);
		return new Promise((done, fail) => {
			socket.once("open", () => done(new Client(socket)));
			socket.once("error", fail);
		});
	}

	send(message: ClientMessage): void {
		this.socket.send(JSON.stringify(message));
	}

	/** The first message of the type (that passes the test, if given), waiting for it if need be */
	next<T extends ServerMessage["type"]>(
		type: T, test: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true, timeout = 2000,
	): Promise<Extract<ServerMessage, { type: T }>> {
		return new Promise((done, fail) => {
			const check = () => {
				const found = this.messages.find(message => message.type == type && test(message as Extract<ServerMessage, { type: T }>));
				if (!found) { return false; }
				done(found as Extract<ServerMessage, { type: T }>);
				return true;
			};
			if (check()) { return; }
			const timer = setTimeout(() => fail(new Error(`no ${type} message`)), timeout);
			this.waiting.push(() => { if (check()) { clearTimeout(timer); } });
		});
	}

	close(): void {
		this.socket.close();
	}
}

describe("game server", () => {
	it("keeps a pilot's ship, ignoring looks that do not exist", async () => {
		const host = await Client.open();
		host.send({ type: "create", name: "Ann", level: 0, difficulty: "normal", look: 5 });
		const { room } = await host.next("welcome");
		expect(room.players[0].look).toBe(5);

		host.send({ type: "look", look: 9999 });
		host.send({ type: "look", look: 6 });
		const told = await host.next("room", message => message.room.players[0].look != 5);
		expect(told.room.players[0].look).toBe(6);
		host.send({ type: "leave" });
		host.close();
	});

	it("lets one browser create a room, another join it by code, and both play", async () => {
		const host = await Client.open();
		const guest = await Client.open();

		host.send({ type: "create", name: "  Ann  ", level: 0, difficulty: "hard" });
		const { room } = await host.next("welcome");
		expect(room).toMatchObject({ difficulty: "hard", state: "lobby", players: [{ name: "Ann" }] });

		guest.send({ type: "join", code: room.code.toLowerCase(), name: "Bo" });
		const joined = await guest.next("welcome");
		expect(joined.room.players.map(player => player.name)).toEqual(["Ann", "Bo"]);
		expect((await host.next("room")).room.players).toHaveLength(2);

		host.send({ type: "start" });
		const start = await guest.next("start");
		expect(Object.keys(start.ships)).toHaveLength(2);
		const snapshot = await guest.next("snapshot");
		expect(snapshot.e.length).toBeGreaterThanOrEqual(2 + 12); /* two ships and the pods */

		host.send({ type: "leave" });
		guest.send({ type: "leave" });
		await new Promise(done => setTimeout(done, 50));
		expect(server.rooms.count).toBe(0);
		host.close();
		guest.close();
	});

	it("takes a player whose connection dropped back into their room and level, and closes a connection replaced by a newer one", async () => {
		const host = await Client.open();
		const guest = await Client.open();
		host.send({ type: "create", name: "Ann", level: 0, difficulty: "normal" });
		const { room } = await host.next("welcome");
		guest.send({ type: "join", code: room.code, name: "Bo" });
		const { you, token } = await guest.next("welcome");
		host.send({ type: "start" });
		const { run } = await guest.next("start");

		guest.close();
		await host.next("room", ({ room }) => room.players.some(player => player.id == you && player.away));

		const back = await Client.open();
		back.send({ type: "resume", token: "not a token" });
		expect((await back.next("error")).message).toMatch(/place in the room is gone/);
		back.send({ type: "resume", token });
		expect(await back.next("welcome")).toMatchObject({ you, token, room: { code: room.code, state: "playing" } });
		expect(await back.next("start")).toMatchObject({ run, alive: true });
		await back.next("snapshot");
		await host.next("room", ({ room }) => room.players.every(player => !player.away));

		/* the same player again, from another tab */
		const other = await Client.open();
		other.send({ type: "resume", token });
		await other.next("welcome");
		expect(await back.closed).toBe(CLOSE_REPLACED);

		host.send({ type: "leave" });
		other.send({ type: "leave" });
		await new Promise(done => setTimeout(done, 50));
		expect(server.rooms.count).toBe(0);
		host.close();
		other.close();
	});

	it("says so when the room code is wrong, and ignores junk", async () => {
		const client = await Client.open();
		client.send({ type: "join", code: "QQQQ", name: "Cy" });
		expect((await client.next("error")).message).toMatch(/No room with the code QQQQ/);

		(client as unknown as { socket: WebSocket }).socket.send("{not json");
		client.send({ type: "create", name: "Cy", level: 99, difficulty: "normal" });
		await new Promise(done => setTimeout(done, 50));
		expect(client.messages.filter(message => message.type == "welcome")).toHaveLength(0);
		client.close();
	});

	it("lets the host set up a deathmatch, and nobody set up anything that does not exist", async () => {
		const host = await Client.open();
		host.send({ type: "create", name: "Ann", level: 0, difficulty: "normal" });
		const { room } = await host.next("welcome");
		expect(room).toMatchObject({ mode: "coop", fragLimit: 10, timeLimit: 5 });

		host.send({ type: "setup", mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 1000, timeLimit: 5 });
		host.send({ type: "setup", mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 20, timeLimit: 10 });
		const updated = await host.next("room", ({ room }) => room.mode == "deathmatch");
		expect(updated.room).toMatchObject({ fragLimit: 20, timeLimit: 10 });

		host.send({ type: "start" });
		expect((await host.next("start")).arena).toMatchObject({ fragLimit: 20 });
		expect((await host.next("snapshot")).match).toMatchObject({ left: expect.any(Number) });

		host.send({ type: "leave" });
		host.close();
	});

	it("does not take guesses at room codes for long", async () => {
		const client = await Client.open();
		for (let i = 0; i < 8; i++) { client.send({ type: "join", code: "QQQQ", name: "Cy" }); }
		expect((await client.next("error", ({ message }) => message.includes("Too many"))).message).toMatch(/Too many tries/);
		client.close();
	});

	it("ignores a browser that sends far more than it could need", async () => {
		const client = await Client.open();
		for (let i = 0; i < 400; i++) { client.send({ type: "name", name: "x" }); }
		client.send({ type: "create", name: "Cy", level: 0, difficulty: "normal" });
		await new Promise(done => setTimeout(done, 100));
		expect(client.messages.filter(message => message.type == "welcome")).toHaveLength(0);

		await new Promise(done => setTimeout(done, 200)); /* room for more again */
		client.send({ type: "create", name: "Cy", level: 0, difficulty: "normal" });
		await client.next("welcome");
		client.send({ type: "leave" });
		client.close();
	});
});
