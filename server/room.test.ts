import { beforeAll, describe, expect, it } from "vitest";
import type { Entity } from "../src/entity/entity.ts";
import type { PlayerShip } from "../src/entity/player-ship.ts";
import { kindIndex } from "../src/net/kinds.ts";
import { RECONNECT_GRACE, type ClientMessage, type EntityRecord, type GameEvent, type ServerMessage, type Snapshot } from "../src/net/protocol.ts";
import { settle, stubModels } from "../src/testing.ts";
import { Room, type Member } from "./room.ts";
import { Rooms } from "./rooms.ts";

beforeAll(stubModels);

interface TestMember extends Member {
	readonly messages: ServerMessage[];
}

function member(id: number): TestMember {
	const messages: ServerMessage[] = [];
	return { id, name: `Pilot ${id}`, token: `token-${id}`, messages, send: message => { messages.push(message); } };
}

const snapshots = (m: TestMember) => m.messages.filter((message): message is Snapshot => message.type == "snapshot");
const lastSnapshot = (m: TestMember) => snapshots(m).at(-1)!;
const events = (m: TestMember, type: GameEvent[0]) => snapshots(m).flatMap(snapshot => snapshot.ev).filter(event => event[0] == type);
const records = (m: TestMember, kind: Parameters<typeof kindIndex>[0]): EntityRecord[] =>
	lastSnapshot(m).e.filter(record => record[1] == kindIndex(kind));

type State = Extract<ClientMessage, { type: "state" }>;
const report = (overrides: Partial<State> = {}): State => ({
	type: "state",
	ship: { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], speed: 0, target: 0, yaw: 0, pitch: 0 },
	shots: [],
	rockets: [],
	hits: [],
	...overrides,
});

/** As the server does: in small pieces of real time (one call simulates at most 0.25 s) */
function run(room: Room, seconds: number): void {
	for (let t = 0; t < seconds; t += 0.05) { room.advance(0.05); }
}

/** The ships the room flies for its members (not reachable from outside) */
const shipOf = (room: Room, id: number) => (room as unknown as { level: { flyers: Map<number, { ship: PlayerShip }> } }).level.flyers.get(id)!.ship;
const entityOf = (room: Room, id: number) => (room as unknown as { byId: Map<number, Entity> }).byId.get(id)!;

async function twoPlayers(level = 0): Promise<{ room: Room; host: TestMember; guest: TestMember }> {
	const host = member(1);
	const guest = member(2);
	const room = new Room("ABCD", host, level, "normal");
	expect(room.join(guest)).toBeNull();
	room.start(host.id);
	await settle(); /* models */
	return { room, host, guest };
}

describe("game rooms", () => {
	it("start a level for everyone, then send snapshots of every ship and pod", async () => {
		const { room, host, guest } = await twoPlayers();

		for (const m of [host, guest]) {
			const start = m.messages.find(message => message.type == "start");
			expect(start).toMatchObject({ level: 0, difficulty: "normal", podsTotal: 12 });
			expect(Object.keys(start!.type == "start" ? start!.ships : {})).toEqual(["1", "2"]);
		}

		run(room, 0.2);
		expect(snapshots(host).length).toBeGreaterThanOrEqual(3); /* every 45 ms */
		expect(records(host, "player")).toHaveLength(2);
		expect(records(host, "pod")).toHaveLength(12);
		expect(lastSnapshot(host)).toMatchObject({ shields: 100, pods: 12, enemies: 4 });
	});

	it("put a player's ship where their browser says, and pass their shots on to the others only", async () => {
		const { room, host, guest } = await twoPlayers();
		room.report(host.id, report({
			ship: { p: [5, 1, 2], q: [0, 0, 0, 1], v: [0, 0, 0], speed: 0, target: 0, yaw: 0, pitch: 0 },
			shots: [{ p: [5, 0.7, -1], v: [0, 0, -120] }],
		}));
		run(room, 0.05);

		const hostShip = shipOf(room, host.id);
		expect(Array.from(hostShip.position)).toEqual([5, 1, 2]);
		expect(events(guest, "shot")).toHaveLength(1);
		expect(events(host, "shot")).toHaveLength(0);
	});

	it("count hits players report: pods blow up, ships lose shields first", async () => {
		const { room, host, guest } = await twoPlayers();
		run(room, 6); /* the first pirate arrives after 5 s */
		const [podId] = records(host, "pod")[0];
		const [pirateId] = records(host, "pirate")[0];

		room.report(guest.id, report({ hits: [{ id: podId, damage: 25 }, { id: pirateId, damage: 25 }] }));
		run(room, 0.05);
		expect(events(host, "explode").map(event => event[2])).toEqual([podId]);
		expect(records(host, "pod").map(([id]) => id)).not.toContain(podId);
		expect(events(host, "sound").some(event => event[2] == "hit")).toBe(true); /* heard by the others… */
		expect(events(guest, "sound").some(event => event[2] == "hit")).toBe(false); /* …the shooter heard it already */

		room.report(guest.id, report({ hits: [{ id: pirateId, damage: 25 }] }));
		run(room, 0.05);
		expect(events(host, "explode").map(event => event[2])).toEqual([podId, pirateId]);
	});

	it("ignore reported hits on players and cap the damage of a hit", async () => {
		const { room, host, guest } = await twoPlayers();
		run(room, 6);
		const [hostShipId] = records(guest, "player").filter(([id]) => entityOf(room, id) == shipOf(room, host.id))[0];
		const [pirateId] = records(host, "pirate")[0];

		room.report(guest.id, report({ hits: [{ id: hostShipId, damage: 50 }, { id: pirateId, damage: 1000 }] }));
		run(room, 0.05);
		expect(shipOf(room, host.id).shields.value).toBe(100);
		expect(events(host, "explode").map(event => event[2])).toEqual([pirateId]); /* capped to 50: just a pirate's shields */
	});

	it("end the level once every player's ship is gone, and go back to the lobby when the host says", async () => {
		const { room, host, guest } = await twoPlayers();
		shipOf(room, host.id).dead = true;
		run(room, 0.05);
		expect(room.state).toBe("playing");

		shipOf(room, guest.id).dead = true;
		run(room, 0.05);
		expect(room.state).toBe("over");
		expect(host.messages.find(message => message.type == "outcome")).toMatchObject({ outcome: "ship-destroyed", podsLeft: 12 });

		room.toLobby(guest.id); /* not the host */
		expect(room.state).toBe("over");
		room.toLobby(host.id);
		expect(room.state).toBe("lobby");
	});

	it("tell only the collector about a powerup", async () => {
		const { room, host, guest } = await twoPlayers(1); /* level 2 has powerups, the first after 20 s */
		run(room, 20.1);
		const [, , x, y, z] = lastSnapshot(host).e.find(record => record[1] >= kindIndex("powerup-shields"))!;
		room.report(guest.id, report({ ship: { p: [x, y, z], q: [0, 0, 0, 1], v: [0, 0, 0], speed: 0, target: 0, yaw: 0, pitch: 0 } }));
		run(room, 0.1);

		expect(events(guest, "powerup")).toHaveLength(1);
		expect(events(host, "powerup")).toHaveLength(0);
	});

	it("refuse joining mid-level or when full, and hand the host role on", async () => {
		const { room, host } = await twoPlayers();
		expect(room.join(member(3))).toMatch(/middle of a level/);

		const lobby = new Room("WXYZ", member(10), 0, "easy");
		for (const id of [11, 12, 13]) { expect(lobby.join(member(id))).toBeNull(); }
		expect(lobby.join(member(14))).toMatch(/full/);

		expect(room.leave(host.id)).toBe(false);
		expect(room.host).toBe(2);
		expect(room.leave(2)).toBe(true);
	});

	it("keep a dropped player's place: their ship holds course, the host role moves on, and they get the level back as it is", async () => {
		const { room, host, guest } = await twoPlayers();
		const half = Math.SQRT1_2; /* turned 90° about y */
		room.report(host.id, report({
			ship: { p: [5, 0, 0], q: [0, half, 0, half], v: [0, 0, 0], speed: 0, target: 0, yaw: 1, pitch: 0 },
			rockets: [{ p: [5, 0, 0], v: [0, 0, -50], target: 999 }],
		}));
		room.disconnected(host.id); /* right after that report: it was turning */
		expect(room.info().players.map(({ away }) => away)).toEqual([true, false]);
		expect(room.host).toBe(guest.id);
		run(room, 1);
		expect(shipOf(room, host.id).engine.yaw.control).toBe(0); /* holding course, not turning on */

		host.messages.length = 0;
		room.reconnected(host.id);
		const [welcome, start] = host.messages;
		expect(welcome).toMatchObject({ type: "welcome", you: host.id, token: "token-1", room: { state: "playing", host: guest.id } });
		expect(start).toMatchObject({ type: "start", run: 1, rockets: 2, alive: true, podsTotal: 12 });
		if (start.type != "start") { return; }
		expect(start.spawn).toEqual([5, 0, 0]);
		expect(start.facing[1]).toBeCloseTo(half, 3);
		expect(room.info().players.every(({ away }) => !away)).toBe(true);
	});

	it("give a player back the outcome of the level that ended while they were away", async () => {
		const { room, host, guest } = await twoPlayers();
		room.disconnected(guest.id);
		shipOf(room, host.id).dead = true;
		shipOf(room, guest.id).dead = true;
		run(room, 0.05);
		expect(room.state).toBe("over");

		guest.messages.length = 0;
		room.reconnected(guest.id);
		expect(guest.messages.map(({ type }) => type)).toEqual(["welcome", "outcome"]);
		expect(guest.messages[1]).toMatchObject({ outcome: "ship-destroyed", podsLeft: 12 });
	});

	it("let players go once they have been away too long, closing the room when nobody came back", () => {
		const rooms = new Rooms();
		const room = rooms.create(member(1), 0, "normal")!;
		room.join(member(2));
		room.disconnected(1);
		room.disconnected(2);

		for (let t = 0; t < RECONNECT_GRACE - 1; t += 0.05) { rooms.advance(0.05); }
		expect(room.members).toHaveLength(2);
		for (let t = 0; t < 1.1; t += 0.05) { rooms.advance(0.05); }
		expect(room.members).toHaveLength(0);
		expect(rooms.count).toBe(0);
	});
});
