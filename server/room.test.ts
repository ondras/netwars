import { quat, vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import type { Entity } from "../src/entity/entity.ts";
import { Missile } from "../src/entity/missile.ts";
import { DIFFICULTIES } from "../src/difficulty.ts";
import type { PlayerShip } from "../src/entity/player-ship.ts";
import { applyPowerup, Powerup, POWER_SHOTS } from "../src/entity/powerup.ts";
import { BOOST_FACTOR, BOOST_RAMP, POWER_SHOT, ROCKET_CAPACITY, STRAFE_SPEED } from "../src/entity/ship.ts";
import { enemyWaves, LEVELS } from "../src/levels.ts";
import type { Loop } from "../src/loop.ts";
import type { Mechanics } from "../src/mechanics.ts";
import { kindIndex } from "../src/net/kinds.ts";
import {
	arenaSizeFor, MIN_ARENA_SIZE as ARENA_SIZE, RECONNECT_GRACE, RESPAWN_DELAY,
	type ClientMessage, type EntityRecord, type GameEvent, type OutcomeMessage, type Quat, type ServerMessage, type ShipState, type Snapshot, type StartMessage, type Vec3,
} from "../src/net/protocol.ts";
import { settle, stubModels } from "../src/testing.ts";
import { Weapon } from "../src/weapon.ts";
import type { Allowance } from "./checks.ts";
import { Room, type Member } from "./room.ts";
import { Rooms } from "./rooms.ts";

beforeAll(stubModels);

const PLAYER_GUN_DAMAGE = new Weapon().options.damage;

interface TestMember extends Member {
	readonly messages: ServerMessage[];
}

function member(id: number): TestMember {
	const messages: ServerMessage[] = [];
	return { id, name: `Pilot ${id}`, token: `token-${id}`, look: 0, messages, send: message => { messages.push(message); } };
}

const snapshots = (m: TestMember) => m.messages.filter((message): message is Snapshot => message.type == "snapshot");
const lastSnapshot = (m: TestMember) => snapshots(m).at(-1)!;
const events = (m: TestMember, type: GameEvent[0]) => snapshots(m).flatMap(snapshot => snapshot.ev).filter(event => event[0] == type);
const records = (m: TestMember, kind: Parameters<typeof kindIndex>[0]): EntityRecord[] =>
	lastSnapshot(m).e.filter(record => record[1] == kindIndex(kind));

type State = Extract<ClientMessage, { type: "state" }>;
const flying = (p: Vec3, q: Quat = [0, 0, 0, 1], others: Partial<ShipState> = {}): ShipState => ({ p, q, speed: 0, target: 0, yaw: 0, pitch: 0, ...others });
const report = (overrides: Partial<State> = {}): State => ({
	type: "state",
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
type Reachable = { level: { flyers: Map<number, { ship: PlayerShip; allowance: Allowance }>; loop: Loop; pods: Entity[] }; byId: Map<number, Entity>; time: number };
const inside = (room: Room) => room as unknown as Reachable;
const shipOf = (room: Room, id: number) => inside(room).level.flyers.get(id)!.ship;
const entityOf = (room: Room, id: number) => inside(room).byId.get(id)!;
const nowIn = (room: Room) => inside(room).time;
const idOf = (room: Room, m: TestMember, entity: Entity) => lastSnapshot(m).e.find(([id]) => entityOf(room, id) == entity)![0];

/** The ship is there, as if it had just flown there, without taking the time */
function place(room: Room, id: number, p: Vec3): void {
	const ship = shipOf(room, id);
	vec3.set(ship.position, ...p);
	inside(room).level.flyers.get(id)!.allowance.restart(ship);
}

/** Facing from one point to another */
function facing(from: Vec3, to: Vec3): Quat {
	const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), to, from));
	return Array.from(quat.rotationTo(quat.create(), vec3.fromValues(0, 0, -1), direction)) as Quat;
}

/** A fair shot: a ship at `from` turns to something at `to`, fires, and once the shot can have got there says it hit */
function shootAt(room: Room, m: TestMember, n: number, from: Vec3, to: Vec3, targetId: number): void {
	const q = facing(from, to);
	const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), to, from));
	const muzzle = vec3.scaleAndAdd(vec3.create(), from, direction, 3);
	const t = nowIn(room);
	room.report(m.id, report({
		ship: flying(from, q),
		shots: [{ n, t, p: Array.from(muzzle) as Vec3, v: Array.from(vec3.scale(vec3.create(), direction, 120)) as Vec3 }],
	}));
	const flight = vec3.distance(muzzle, to) / 120;
	run(room, flight + 0.05);
	room.report(m.id, report({ ship: flying(from, q), hits: [{ shot: n, id: targetId, t: t + flight }] }));
}

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
	it("tell everyone which ship each pilot flies, and let them change it between levels only", async () => {
		const host = member(1);
		const guest = member(2);
		guest.look = 7;
		const room = new Room("ABCD", host, 0, "normal");
		expect(room.join(guest)).toBeNull();
		expect(room.info().players.map(({ look }) => look)).toEqual([0, 7]);

		room.setLook(host.id, 4);
		const told = guest.messages.filter((message): message is Extract<ServerMessage, { type: "room" }> => message.type == "room").at(-1)!;
		expect(told.room.players.map(({ look }) => look)).toEqual([4, 7]);

		room.start(host.id);
		await settle();
		room.setLook(host.id, 9); /* the level is on: the ship in flight stays what it is */
		run(room, 0.1);
		const { looks, pilots, e } = lastSnapshot(guest);
		const players = e.filter(record => record[1] == kindIndex("player")).map(([id]) => id);
		expect(players.map(id => looks[id]).sort((a, b) => a - b)).toEqual([4, 7]);
		expect(players.map(id => pilots[id]).sort((a, b) => a - b)).toEqual([host.id, guest.id].sort((a, b) => a - b)); /* whose is which, for names */
	});

	it("start a level for everyone, then send snapshots of every ship and pod", async () => {
		const { room, host, guest } = await twoPlayers();

		for (const m of [host, guest]) {
			const start = m.messages.find(message => message.type == "start");
			expect(start).toMatchObject({ level: 0, difficulty: "normal", mechanics: "classic", podsTotal: 12 });
			expect(Object.keys(start!.type == "start" ? start!.ships : {})).toEqual(["1", "2"]);
		}

		run(room, 0.2);
		expect(snapshots(host).length).toBeGreaterThanOrEqual(3); /* every 45 ms */
		expect(records(host, "player")).toHaveLength(2);
		expect(records(host, "pod")).toHaveLength(12);
		expect(lastSnapshot(host)).toMatchObject({ shields: 100, pods: 12, enemies: enemyWaves(LEVELS[0], 2, DIFFICULTIES.normal.thieves).enemies.length });
	});

	it("put a player's ship where their browser says, and pass their shots on to the others only", async () => {
		const { room, host, guest } = await twoPlayers();
		room.report(host.id, report({
			ship: flying([5, 1, 2]),
			shots: [{ n: 1, t: 0, p: [5, 0.7, -1], v: [0, 0, -120] }],
		}));
		run(room, 0.05);

		const hostShip = shipOf(room, host.id);
		expect(Array.from(hostShip.position)).toEqual([5, 1, 2]);
		expect(events(guest, "shot")).toHaveLength(1);
		expect(events(host, "shot")).toHaveLength(0);
	});

	it("count hits players report that check out: pods blow up, ships lose shields first", async () => {
		const { room, host, guest } = await twoPlayers();
		run(room, 6); /* the first pirate arrives after 5 s */
		const [podId, , px, py, pz] = records(host, "pod")[0];
		place(room, guest.id, [0, 0, 60]);
		shootAt(room, guest, 1, [0, 0, 60], [px, py, pz], podId);
		run(room, 0.05);
		expect(events(host, "explode").map(event => event[2])).toEqual([podId]);
		expect(records(host, "pod").map(([id]) => id)).not.toContain(podId);
		expect(room.refused.hits).toBe(0);

		/* a pirate: 50 shield points, 25 a shot */
		const [pirateId] = records(host, "pirate")[0];
		const enemy = entityOf(room, pirateId) as PlayerShip;
		enemy.engine.speed.limit = 0;
		enemy.engine.speed.value = 0;
		vec3.zero(enemy.velocity);
		run(room, 0.6); /* it has been standing still for a while */
		const [x, y, z] = enemy.position;
		place(room, guest.id, [x, y, z + 30]);
		shootAt(room, guest, 2, [x, y, z + 30], [x, y, z], pirateId);
		run(room, 0.05);
		expect(room.refused.hits).toBe(0);
		expect(enemy.shields.value).toBe(25);
		expect(events(host, "sound").some(event => event[2] == "hit")).toBe(true); /* heard by the others… */
		expect(events(guest, "sound").some(event => event[2] == "hit")).toBe(false); /* …the shooter heard it already */
	});

	it("bring a destroyed ship back by the pods, end the level once every pod is gone, and go back to the lobby when the host says", async () => {
		const { room, host, guest } = await twoPlayers();
		for (const id of [host.id, guest.id]) {
			const ship = shipOf(room, id);
			vec3.set(ship.position, 100, 0, 0);
			ship.absorb(1000);
			ship.dead = ship.exploded = true;
		}
		run(room, 0.05);
		expect(room.state).toBe("playing"); /* every ship is gone, and still the level goes on */

		run(room, RESPAWN_DELAY);
		const back = shipOf(room, host.id);
		expect(back.dead).toBe(false);
		expect(back.shields.value).toBe(back.shields.max);
		expect(vec3.length(back.position)).toBeLessThan(10);

		for (const pod of inside(room).level.pods) { pod.dead = true; }
		run(room, 0.05);
		expect(room.state).toBe("over");
		expect(host.messages.find(message => message.type == "outcome")).toMatchObject({ outcome: "pods-lost", podsLeft: 0 });

		room.toLobby(guest.id); /* not the host */
		expect(room.state).toBe("over");
		room.toLobby(host.id);
		expect(room.state).toBe("lobby");
	});

	it("tell only the collector about a powerup", async () => {
		const { room, host, guest } = await twoPlayers(1); /* level 2 has powerups, the first after 20 s */
		run(room, 20.1);
		const [, , x, y, z] = lastSnapshot(host).e.find(record => record[1] >= kindIndex("powerup-shields"))!;
		place(room, guest.id, [x, y, z]);
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
			ship: flying([5, 0, 0], [0, half, 0, half], { yaw: 1 }),
			rockets: [{ p: [5, 0, 0], target: 999 }],
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
		const { room, guest } = await twoPlayers();
		room.disconnected(guest.id);
		for (const pod of inside(room).level.pods) { pod.dead = true; }
		run(room, 0.05);
		expect(room.state).toBe("over");

		guest.messages.length = 0;
		room.reconnected(guest.id);
		expect(guest.messages.map(({ type }) => type)).toEqual(["welcome", "outcome"]);
		expect(guest.messages[1]).toMatchObject({ outcome: "pods-lost", podsLeft: 0 });
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

	it("let a browser that flew on while its connection was down take up where it is, if it can have got there", async () => {
		const { room, host } = await twoPlayers();
		room.report(host.id, report({ ship: flying([0, 0, 0]) }));
		room.disconnected(host.id);
		run(room, 10);
		room.reconnected(host.id);
		run(room, 1);

		room.report(host.id, report({ ship: flying([0, 0, -150]) })); /* 15 m/s for 10 s */
		expect(room.refused.moves).toBe(0);
		expect(shipOf(room, host.id).position[2]).toBe(-150);

		room.report(host.id, report({ ship: flying([0, 0, -500]) })); /* the time away is used up */
		expect(room.refused.moves).toBe(1);
		expect(shipOf(room, host.id).position[2]).toBeGreaterThan(-180);
	});
});

describe("what browsers report is checked:", () => {
	it("a ship cannot go farther than it can fly: it follows at top speed", async () => {
		const { room, host } = await twoPlayers();
		place(room, host.id, [0, 0, 0]);
		run(room, 2); /* the most that adds up: a second's worth */

		room.report(host.id, report({ ship: flying([0, 0, -1000]) }));
		expect(room.refused.moves).toBe(1);
		expect(shipOf(room, host.id).position[2]).toBeCloseTo(-16.5, 1);

		/* keeps claiming to be far off: gets there at the speed it can */
		for (let i = 0; i < 20; i++) {
			run(room, 0.05);
			room.report(host.id, report({ ship: flying([0, 0, -1000]) }));
		}
		expect(shipOf(room, host.id).position[2]).toBeGreaterThan(-35);
	});

	it("nor turn faster than it can", async () => {
		const { room, host } = await twoPlayers();
		place(room, host.id, [0, 0, 0]);
		run(room, 0.5);
		/* spend what has added up */
		const half = Math.SQRT1_2;
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, half, 0, half]) }));
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, 0, 0, 1]) }));
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, half, 0, half]) }));
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, 0, 0, 1]) }));
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, half, 0, half]) }));
		const after = quat.clone(shipOf(room, host.id).orientation);
		expect(room.refused.moves).toBeGreaterThan(0);

		run(room, 0.05); /* a fifth of a radian or so comes back */
		room.report(host.id, report({ ship: flying([0, 0, 0], [0, 0, 0, 1]) }));
		const turned = quat.getAngle(after, shipOf(room, host.id).orientation);
		expect(turned).toBeLessThan(0.45);
	});

	it("a gun fires no faster than its reload time, and only ahead, from the ship, at its speed", async () => {
		const { room, host, guest } = await twoPlayers();
		place(room, host.id, [0, 0, 0]);
		const shot = (n: number, overrides = {}) => ({ n, t: 0, p: [0, 0, -3] as Vec3, v: [0, 0, -120] as Vec3, ...overrides });

		room.report(host.id, report({ ship: flying([0, 0, 0]), shots: [shot(1, { p: [50, 0, 0] })] }));
		room.report(host.id, report({ ship: flying([0, 0, 0]), shots: [shot(2, { v: [0, 0, 120] })] }));
		room.report(host.id, report({ ship: flying([0, 0, 0]), shots: [shot(3, { v: [0, 0, -500] })] }));
		expect(room.refused.shots).toBe(3);
		run(room, 0.05);
		expect(events(guest, "shot")).toHaveLength(0);

		run(room, 2);
		const many = Array.from({ length: 10 }, (_, i) => shot(10 + i));
		for (let i = 0; i < 10; i++) { room.report(host.id, report({ ship: flying([0, 0, 0]), shots: many })); }
		run(room, 0.05);
		const shown = events(guest, "shot").length;
		expect(shown).toBeLessThanOrEqual(8); /* a second's worth, not a hundred */
		expect(shown).toBeGreaterThan(0);

		run(room, 1);
		room.report(host.id, report({ ship: flying([0, 0, 0]), shots: [shot(30)] }));
		run(room, 0.05);
		expect(events(guest, "shot").length).toBe(shown + 1);
	});

	it("hits count only for a shot that was fired, once, and that got to the target", async () => {
		const { room, host, guest } = await twoPlayers();
		run(room, 0.5);
		const pods = records(host, "pod");
		const [first, , x, y, z] = pods[0];
		const [second] = pods[1];

		/* no such shot */
		room.report(guest.id, report({ hits: [{ shot: 77, id: first, t: nowIn(room) - 0.1 }] }));
		expect(room.refused.hits).toBe(1);

		/* a shot, but aimed elsewhere */
		const from: Vec3 = [x, y, z + 40];
		place(room, guest.id, from);
		const t = nowIn(room);
		room.report(guest.id, report({ ship: flying(from, facing(from, [x + 30, y, z])), shots: [{ n: 1, t, p: from, v: Array.from(vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -120), facing(from, [x + 30, y, z]))) as Vec3 }] }));
		run(room, 0.4);
		room.report(guest.id, report({ hits: [{ shot: 1, id: first, t: t + 0.33 }] }));
		expect(room.refused.hits).toBe(2);
		expect(room.refused.shots).toBe(0);

		/* a good one, claimed twice and for another pod too */
		shootAt(room, guest, 2, from, [x, y, z], first);
		expect(room.refused.hits).toBe(2);
		room.report(guest.id, report({ hits: [{ shot: 2, id: second, t: nowIn(room) - 0.05 }] }));
		expect(room.refused.hits).toBe(3);

		/* too long ago to check */
		run(room, 1);
		room.report(guest.id, report({ hits: [{ shot: 3, id: second, t: nowIn(room) - 2 }] }));
		expect(room.refused.hits).toBe(4);
		run(room, 0.1);
		expect(events(host, "explode").map(event => event[2])).toEqual([first]);
	});

	it("co-op: no shooting at teammates", async () => {
		const { room, host, guest } = await twoPlayers();
		place(room, host.id, [0, 0, -40]);
		place(room, guest.id, [0, 0, 0]);
		run(room, 0.3);
		shootAt(room, guest, 1, [0, 0, 0], [0, 0, -40], idOf(room, host, shipOf(room, host.id)));
		expect(room.refused.hits).toBe(1);
		expect(shipOf(room, host.id).shields.value).toBe(100);
	});

	it("rockets: only those the ship has, at a ship ahead and in range; the server flies them, the launcher's browser its own", async () => {
		const { room, host, guest } = await twoPlayers();
		run(room, 6);
		const [pirateId] = records(host, "pirate")[0];
		const pirate = entityOf(room, pirateId) as PlayerShip;
		const launch = (m: TestMember, target: number) => {
			const from = shipOf(room, m.id).position;
			const p: Vec3 = [from[0], from[1], from[2]];
			room.report(m.id, report({ ship: flying(p, facing(p, Array.from(pirate.position) as Vec3)), rockets: [{ p, target }] }));
		};

		/* too far */
		place(room, guest.id, [pirate.position[0], pirate.position[1], pirate.position[2] + 300]);
		launch(guest, pirateId);
		expect(room.refused.rockets).toBe(1);
		expect(shipOf(room, guest.id).rockets).toBe(ROCKET_CAPACITY - 1);

		/* at a teammate */
		place(room, guest.id, [0, 0, 0]);
		place(room, host.id, [0, 0, -30]);
		room.report(guest.id, report({ ship: flying([0, 0, 0]), rockets: [{ p: [0, 0, 0], target: idOf(room, guest, shipOf(room, host.id)) }] }));
		expect(room.refused.rockets).toBe(2);

		/* a fair one */
		const [x, y, z] = pirate.position;
		place(room, guest.id, [x, y, z + 30]);
		launch(guest, pirateId);
		expect(room.refused.rockets).toBe(2);
		run(room, 0.1);
		expect(records(host, "rocket")).toHaveLength(1);
		expect(records(guest, "rocket")).toHaveLength(0);
		expect(events(host, "sound").some(event => event[2] == "launch")).toBe(true);
		expect(events(guest, "sound").some(event => event[2] == "launch")).toBe(false);

		/* out of rockets */
		shipOf(room, guest.id).rockets = 0;
		launch(guest, pirateId);
		expect(room.refused.rockets).toBe(3);
	});
});

describe("deathmatch", () => {
	/** A match of two, ready to go */
	async function match(fragLimit = 10, timeLimit = 5, mechanics: Mechanics = "classic"): Promise<{ room: Room; host: TestMember; guest: TestMember }> {
		const host = member(1);
		const guest = member(2);
		const room = new Room("ABCD", host, 0, "normal", null, mechanics);
		room.join(guest);
		room.setup(host.id, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit, timeLimit });
		room.start(host.id);
		await settle();
		run(room, 0.1);
		return { room, host, guest };
	}

	/** The guest destroys the host's ship, as many shots as that takes */
	function destroyHost(room: Room, guest: TestMember, host: TestMember, n: number): void {
		const victim = shipOf(room, host.id);
		place(room, host.id, [0, 0, -40]);
		place(room, guest.id, [0, 0, 0]);
		run(room, 0.6);
		const id = idOf(room, guest, victim);
		for (let i = 0; i < 4; i++) {
			shootAt(room, guest, n + i, [0, 0, 0], [0, 0, -40], id);
			run(room, 0.15);
		}
		run(room, 0.05);
	}

	const startOf = (m: TestMember) => m.messages.find((message): message is StartMessage => message.type == "start")!;
	const outcomeOf = (m: TestMember) => m.messages.find((message): message is OutcomeMessage => message.type == "outcome");

	it("starts in the arena: no pods, no enemies, ships apart, the world wraps around", async () => {
		const { room, host, guest } = await match();
		expect(startOf(host).arena).toEqual({ size: ARENA_SIZE, fragLimit: 10 });
		expect(startOf(guest).spawn).not.toEqual(startOf(host).spawn);
		for (const axis of startOf(host).spawn) { expect(Math.abs(axis)).toBeLessThanOrEqual(ARENA_SIZE / 2); }
		expect(records(host, "pod")).toHaveLength(0);
		expect(lastSnapshot(host).match).toEqual({ left: expect.closeTo(300, 0), frags: { 1: 0, 2: 0 } });

		run(room, 13);
		const powerups = inside(room).level.loop.scene.filter(entity => entity instanceof Powerup);
		expect(powerups).toHaveLength(1);
	});

	it("gives a frag for destroying a ship, whose pilot flies a new one soon, elsewhere", async () => {
		const { room, host, guest } = await match();
		const old = shipOf(room, host.id);
		destroyHost(room, guest, host, 1);

		expect(room.refused).toEqual({ moves: 0, shots: 0, rockets: 0, hits: 0 });
		expect(old.dead).toBe(true);
		expect(lastSnapshot(host).match!.frags).toEqual({ 1: 0, 2: 1 });
		expect(events(host, "frag").map(([, , killer, victim]) => [killer, victim])).toEqual([[guest.id, host.id]]);
		const oldId = lastSnapshot(host).ship;
		expect(lastSnapshot(host).e.map(([id]) => id)).not.toContain(oldId);

		run(room, RESPAWN_DELAY + 0.2);
		const ship = shipOf(room, host.id);
		expect(ship).not.toBe(old);
		expect(ship.dead).toBe(false);
		expect(ship.shields.value).toBe(100);
		expect(ship.rockets).toBe(ROCKET_CAPACITY);
		const now = lastSnapshot(host);
		expect(now.ship).not.toBe(oldId);
		expect(now.e.map(([id]) => id)).toContain(now.ship);

		/* its browser takes up from there */
		const [x, y, z] = ship.position;
		room.report(host.id, report({ ship: flying([x, y, z]) }));
		expect(room.refused.moves).toBe(0);
	});

	it("still counts a shot that lands after its shooter's ship is gone", async () => {
		const { room, host, guest } = await match();
		const victim = shipOf(room, host.id);
		place(room, host.id, [0, 0, -40]);
		place(room, guest.id, [0, 0, 0]);
		run(room, 0.6);
		victim.shields.value = 25;

		const t = nowIn(room);
		room.report(guest.id, report({ ship: flying([0, 0, 0], facing([0, 0, 0], [0, 0, -40])), shots: [{ n: 1, t, p: [0, 0, -3], v: [0, 0, -120] }] }));
		shipOf(room, guest.id).dead = true;
		run(room, 0.35);
		room.report(guest.id, report({ hits: [{ shot: 1, id: idOf(room, host, victim), t: t + 0.31 }] }));
		run(room, 0.05);
		expect(victim.dead).toBe(true);
		expect(lastSnapshot(host).match!.frags[guest.id]).toBe(1);
	});

	it("counts rockets too, which home in through the walls", async () => {
		const { room, host, guest } = await match();
		const victim = shipOf(room, host.id);
		victim.shields.value = 50;
		/* near opposite faces of the cube: 30 m apart through the wall, 370 m across it */
		place(room, guest.id, [0, 0, ARENA_SIZE / 2 - 15]);
		place(room, host.id, [0, 0, -ARENA_SIZE / 2 + 15]);
		run(room, 0.1);
		const nose: Vec3 = [0, 0, ARENA_SIZE / 2 - 18];
		/* the guest faces +z, away from the middle */
		room.report(guest.id, report({
			ship: flying([0, 0, ARENA_SIZE / 2 - 15], [0, 1, 0, 0]),
			rockets: [{ p: nose, target: idOf(room, guest, victim) }],
		}));
		expect(room.refused.rockets).toBe(0);
		run(room, 2);
		expect(victim.dead).toBe(true);
		expect(lastSnapshot(host).match!.frags[guest.id]).toBe(1);
	});

	it("checks a shot through the wall against the near copy of its target", async () => {
		const { room, host, guest } = await match();
		const victim = shipOf(room, host.id);
		place(room, guest.id, [0, 0, ARENA_SIZE / 2 - 15]);
		place(room, host.id, [0, 0, -ARENA_SIZE / 2 + 15]);
		run(room, 0.6);

		const from: Vec3 = [0, 0, ARENA_SIZE / 2 - 15];
		const t = nowIn(room);
		room.report(guest.id, report({ ship: flying(from, [0, 1, 0, 0]), shots: [{ n: 1, t, p: [0, 0, from[2] + 3], v: [0, 0, 120] }] }));
		run(room, 0.3);
		room.report(guest.id, report({ hits: [{ shot: 1, id: idOf(room, guest, victim), t: t + 0.225 }] }));
		expect(room.refused).toEqual({ moves: 0, shots: 0, rockets: 0, hits: 0 });
		expect(victim.shields.value).toBe(75);
	});

	it("counts a pilot's power shots itself: stronger until they are used up, whatever the browser thinks", async () => {
		const { room, host, guest } = await match();
		place(room, host.id, [0, 0, -40]);
		const from: Vec3 = [0, 0, 0];
		place(room, guest.id, from);
		const target = shipOf(room, host.id);
		const shooter = shipOf(room, guest.id);
		const id = idOf(room, guest, target);
		run(room, 0.2);

		shootAt(room, guest, 1, from, [0, 0, -40], id);
		expect(target.shields.value).toBe(target.shields.max - PLAYER_GUN_DAMAGE);

		target.shields.value = target.shields.max;
		applyPowerup("power", shooter);
		shootAt(room, guest, 2, from, [0, 0, -40], id);
		expect(target.shields.value).toBe(target.shields.max - POWER_SHOT.damage);
		expect(shooter.effects.power).toBe(POWER_SHOTS - 1);
		expect(events(host, "shot").at(-1)![8]).toBe(POWER_SHOT.color);

		target.shields.value = target.shields.max;
		shooter.effects.power = 0;
		shootAt(room, guest, 3, from, [0, 0, -40], id);
		expect(target.shields.value).toBe(target.shields.max - PLAYER_GUN_DAMAGE);
		expect(room.refused).toMatchObject({ shots: 0, hits: 0 });
	});

	it("believes a ship with extra thrust flying faster than its throttle says, and its shots", async () => {
		const { room, guest } = await match();
		place(room, guest.id, [0, 0, 0]);
		const ship = shipOf(room, guest.id);
		applyPowerup("boost", ship);
		run(room, BOOST_RAMP + 0.1);

		const speed = ship.engine.speed.limit;
		const fast = speed * BOOST_FACTOR;
		let z = 0;
		for (let n = 1; n <= 40; n++) {
			z -= fast * 0.05;
			const v = -(120 + fast);
			room.report(guest.id, report({
				ship: flying([0, 0, z], [0, 0, 0, 1], { speed, target: speed }),
				shots: (n % 4 == 0 ? [{ n, t: nowIn(room), p: [0, 0, z - 3], v: [0, 0, v] }] : []),
			}));
			run(room, 0.05);
			expect(ship.position[2]).toBeCloseTo(z - fast * 0.05, 0);
		}
		expect(ship.engine.speed.value).toBeCloseTo(speed);
		expect(room.refused).toMatchObject({ moves: 0, shots: 0 });
	});

	it("believes a ship strafing at full throttle, keeps it drifting sideways between reports, and takes its shots", async () => {
		const { room, guest } = await match(10, 5, "modern");
		place(room, guest.id, [0, 0, 0]);
		const ship = shipOf(room, guest.id);
		const speed = ship.engine.speed.limit;
		/* as the browser flies it: no faster than top speed in all */
		const share = ship.topSpeed / Math.hypot(speed, STRAFE_SPEED);
		const [vx, vz] = [STRAFE_SPEED * share, -speed * share];
		let [x, z] = [0, 0];
		for (let n = 1; n <= 40; n++) {
			x += vx * 0.05;
			z += vz * 0.05;
			room.report(guest.id, report({
				ship: flying([x, 0, z], [0, 0, 0, 1], { speed, target: speed, strafe: STRAFE_SPEED }),
				/* the shot keeps the forward speed only */
				shots: (n % 4 == 0 ? [{ n, t: nowIn(room), p: [x, 0, z - 3], v: [0, 0, vz - 120] }] : []),
			}));
			run(room, 0.05);
			expect(ship.position[0]).toBeCloseTo(x + vx * 0.05, 0);
			expect(ship.position[2]).toBeCloseTo(z + vz * 0.05, 0);
		}
		expect(room.refused).toMatchObject({ moves: 0, shots: 0 });

		/* no reports for a second: it flies on the same way */
		const before = vec3.clone(ship.position);
		run(room, 1);
		expect(ship.position[0] - before[0]).toBeCloseTo(vx, 0);
		expect(ship.position[2] - before[2]).toBeCloseTo(vz, 0);
	});

	it("takes no strafing from a browser with classic mechanics, the room's", async () => {
		const { room, host, guest } = await match();
		expect(host.messages.find(message => message.type == "start")).toMatchObject({ mechanics: "classic" });
		place(room, guest.id, [0, 0, 0]);
		const ship = shipOf(room, guest.id);
		room.report(guest.id, report({ ship: flying([0, 0, 0], [0, 0, 0, 1], { speed: 0, target: 0, strafe: STRAFE_SPEED }) }));
		run(room, 1);
		expect(ship.engine.strafe.value).toBe(0);
		expect(ship.position[0]).toBeCloseTo(0);
	});

	it("lets a shot destroy a powerup, for everyone, and nobody gets it", async () => {
		const { room, host, guest } = await match();
		const { loop } = inside(room).level;
		const powerup = new Powerup("shields", loop.players);
		vec3.set(powerup.position, 0, 0, -40);
		loop.spawn(powerup);
		place(room, guest.id, [0, 0, 0]);
		place(room, host.id, [100, 100, 100]);
		run(room, 0.2);

		const id = idOf(room, guest, powerup);
		shootAt(room, guest, 1, [0, 0, 0], [0, 0, -40], id);
		run(room, 0.05);

		expect(room.refused.hits).toBe(0);
		expect(powerup.exploded).toBe(true);
		expect(powerup.collector).toBeNull();
		expect(events(host, "explode").map(event => event[2])).toContain(id);
		expect(events(guest, "powerup")).toHaveLength(0);
	});

	it("is fought in a cube sized for its pilots, with as many powerups for its size", async () => {
		expect([1, 2, 3, 4].map(arenaSizeFor)).toEqual([400, 400, 500, 600]);

		const host = member(1);
		const room = new Room("ABCD", host, 0, "normal");
		room.setup(host.id, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 10, timeLimit: 5 });
		for (const id of [2, 3, 4]) { room.join(member(id)); }
		room.start(host.id);
		await settle();

		expect(inside(room).level.loop.size).toBe(600);
		expect(startOf(host).arena).toMatchObject({ size: 600 });
		for (const axis of startOf(host).spawn) { expect(Math.abs(axis)).toBeLessThanOrEqual(300); }

		run(room, 30);
		const powerups = inside(room).level.loop.scene.filter(entity => entity instanceof Powerup);
		expect(powerups.length).toBeGreaterThan(4); /* the smallest cube has 4 at most; this one has 3.4 times the room */
	});

	it("collects powerups through the walls", async () => {
		const { room, host } = await match();
		const powerup = new Powerup("shields", inside(room).level.loop.players);
		vec3.set(powerup.position, 0, 0, ARENA_SIZE / 2 - 1);
		inside(room).level.loop.spawn(powerup);
		place(room, host.id, [0, 0, -ARENA_SIZE / 2 + 1]);
		run(room, 0.1);
		expect(powerup.collector).toBe(shipOf(room, host.id));
	});

	it("ends at the frag limit, with standings", async () => {
		const { room, host, guest } = await match(5);
		for (let i = 0; i < 4; i++) {
			destroyHost(room, guest, host, 10 * i + 1);
			expect(room.state).toBe("playing");
			run(room, RESPAWN_DELAY + 0.1);
		}
		destroyHost(room, guest, host, 100);
		expect(room.state).toBe("over");
		expect(outcomeOf(host)).toMatchObject({
			outcome: "match-over",
			match: { reason: "frags", standings: [{ id: 2, name: "Pilot 2", frags: 5 }, { id: 1, name: "Pilot 1", frags: 0 }] },
		});
	});

	it("ends at the time limit, and the host can play it again", async () => {
		const { room, host, guest } = await match(10, 3);
		run(room, 3 * 60);
		expect(room.state).toBe("over");
		expect(outcomeOf(guest)).toMatchObject({ outcome: "match-over", match: { reason: "time" } });
		const firstRun = startOf(host).run;

		host.messages.length = 0;
		room.start(host.id);
		expect(room.state).toBe("playing");
		expect(startOf(host).run).toBe(firstRun + 1);
		expect(startOf(host).arena).not.toBeNull();
	});

	it("gives a player who comes back the match as it is, also between ships", async () => {
		const { room, host, guest } = await match();
		destroyHost(room, guest, host, 1);
		host.messages.length = 0;
		room.disconnected(host.id);
		room.reconnected(host.id);
		expect(startOf(host)).toMatchObject({ alive: false, arena: { size: ARENA_SIZE } });
		run(room, RESPAWN_DELAY + 0.2);
		const now = lastSnapshot(host);
		expect(now.e.map(([id]) => id)).toContain(now.ship);
		expect(now.match!.frags[guest.id]).toBe(1);
	});

	it("does not give frags for pilots who left, nor hand out new ships to them", async () => {
		const { room, host, guest } = await match();
		expect(room.leave(guest.id)).toBe(false);
		run(room, 0.1);
		expect(lastSnapshot(host).match!.frags).toEqual({ 1: 0 });
		expect(records(host, "player")).toHaveLength(1);
		expect(inside(room).level.loop.scene.filter(entity => entity instanceof Missile)).toHaveLength(0);
	});
});
