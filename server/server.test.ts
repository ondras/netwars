import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { NET_PATH, type ClientMessage, type ServerMessage } from "../src/net/protocol.ts";
import { startGameServer, type GameServer } from "./server.ts";

let server: GameServer;

beforeAll(async () => {
	server = await startGameServer({ port: 0, staticDir: null, modelsDir: fileURLToPath(new URL("../public/models", import.meta.url)) });
});
afterAll(() => server.close());

/** A browser, as far as the server can tell */
class Client {
	readonly messages: ServerMessage[] = [];
	private readonly socket: WebSocket;
	private waiting: Array<() => void> = [];

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.on("message", data => {
			this.messages.push(JSON.parse(String(data)) as ServerMessage);
			for (const check of this.waiting) { check(); }
		});
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

	/** The first message of the type, waiting for it if need be */
	next<T extends ServerMessage["type"]>(type: T, timeout = 2000): Promise<Extract<ServerMessage, { type: T }>> {
		return new Promise((done, fail) => {
			const check = () => {
				const found = this.messages.find(message => message.type == type);
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

		host.close();
		guest.close();
		await new Promise(done => setTimeout(done, 50));
		expect(server.rooms.count).toBe(0);
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
});
