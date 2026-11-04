import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Debris } from "../entity/debris.ts";
import { Missile } from "../entity/missile.ts";
import { Pirate } from "../entity/pirate.ts";
import { PlayerShip } from "../entity/player-ship.ts";
import { Pod } from "../entity/pod.ts";
import { ROCKET, ROCKET_CAPACITY } from "../entity/ship.ts";
import { Shot } from "../entity/shot.ts";
import { Loop } from "../loop.ts";
import { settle, stubModels } from "../testing.ts";
import { kindIndex } from "./kinds.ts";
import type { ClientMessage, EntityKind, EntityRecord, GameEvent, Snapshot, StartMessage } from "./protocol.ts";
import { INTERPOLATION_DELAY, OnlineSession } from "./session.ts";

beforeAll(stubModels);

const ME = 1;
const MY_SHIP = 100;
const TEAMMATE = 101;

function setup(arena: StartMessage["arena"] = null) {
	const loop = new Loop();
	loop.size = arena?.size ?? null;
	const sent: ClientMessage[] = [];
	const sounds: string[] = [];
	const clock = { now: 0 };
	const ship = new PlayerShip();
	loop.players.push(ship);
	loop.scene.push(ship);
	const start: StartMessage = {
		type: "start", run: 1, level: 0, difficulty: "normal", ships: { [ME]: MY_SHIP, 2: TEAMMATE },
		spawn: [0, 0, 0], facing: [0, 0, 0, 1], rockets: 3, alive: true, podsTotal: 3, arena,
	};
	const session = new OnlineSession(loop, message => sent.push(message), start, ME, ship, () => clock.now);
	loop.rules = session.rules;
	loop.onStep = () => session.step(loop.step);
	loop.onSound = name => sounds.push(name);

	/** Arrives now, sent at server time t (no delay: the clocks match); this player's ship is always in it, unless told otherwise */
	const receive = (t: number, records: EntityRecord[], ev: GameEvent[] = [], shields = 100, own: { ship: number; flying: boolean } = { ship: MY_SHIP, flying: true }) => {
		clock.now = t;
		const e = (own.flying && !records.some(([id]) => id == own.ship) ? [...records, record(own.ship, "player", [0, 0, 0], shields)] : records);
		session.receive({ type: "snapshot", t, e, ev, enemies: 2, pods: 3, shields, ship: own.ship } satisfies Snapshot);
	};
	/** Steps while the local clock runs on */
	const run = (seconds: number) => {
		for (let i = 0; i < Math.round(seconds / loop.step); i++) {
			clock.now += loop.step;
			loop.update(loop.step);
		}
	};
	const reports = () => sent.filter((message): message is Extract<ClientMessage, { type: "state" }> => message.type == "state");
	return { loop, ship, session, clock, receive, run, reports, sounds };
}

const record = (id: number, kind: EntityKind, [x, y, z]: [number, number, number], extra = 0): EntityRecord =>
	[id, kindIndex(kind), x, y, z, 0, 0, 0, 1, extra];

describe("online session", () => {
	it("shows the server's entities a moment in the past, moving smoothly between snapshots", async () => {
		const { loop, clock, receive, run } = setup();
		receive(0, [record(5, "pod", [0, 0, -20])]);
		receive(0.1, [record(5, "pod", [10, 0, -20])]);
		await settle();

		clock.now = 0.15 - 2 * loop.step; /* two steps to 0.15: shown at 0.05, halfway */
		run(2 * loop.step);
		const pod = loop.scene.find(entity => entity instanceof Pod)!;
		expect(pod.simulated).toBe(false);
		expect(pod.position[0]).toBeCloseTo(10 * (0.15 - INTERPOLATION_DELAY) / 0.1, 1);
	});

	it("blows up copies when the server says, and never brings them back", async () => {
		const { loop, receive, run, sounds } = setup();
		receive(0, [record(5, "pod", [0, 0, -20]), record(6, "pod", [5, 0, -20])]);
		run(0.2);
		await settle(); /* the pods' model, which the debris is made of */
		expect(loop.scene.filter(entity => entity instanceof Pod)).toHaveLength(2);

		receive(0.3, [record(5, "pod", [0, 0, -20])], [["explode", 0.29, 5]]); /* 5 explodes, 6 just leaves */
		run(0.03);
		expect(sounds).toContain("explosion");
		expect(loop.scene.some(entity => entity instanceof Debris)).toBe(true);

		run(0.3);
		expect(loop.scene.filter(entity => entity instanceof Pod)).toHaveLength(0);
	});

	it("reports the ship, its shots and what they hit; a ship hit but not destroyed is heard at once", async () => {
		const { loop, ship, receive, run, reports, sounds } = setup();
		receive(0, [record(7, "pirate", [0, -0.3, -30], 50)]);
		await settle();
		run(0.2);
		const pirate = loop.scene.find(entity => entity instanceof Pirate)!;
		expect(pirate).toBeDefined();

		ship.trigger = true;
		run(0.05);
		ship.trigger = false;
		run(0.4);

		const all = reports();
		expect(all.length).toBeGreaterThan(5); /* about 30 a second */
		const shots = all.flatMap(report => report.shots);
		expect(shots).toHaveLength(1);
		const hits = all.flatMap(report => report.hits);
		expect(hits).toEqual([{ shot: shots[0].n, id: 7, t: expect.any(Number) }]);
		expect(hits[0].t).toBeGreaterThan(shots[0].t); /* both on the same clock: the server's, as shown here */
		expect(pirate.shields.value).toBe(25);
		expect(sounds).toContain("hit");
	});

	it("shows other ships' shots without letting them hurt: the server decides", async () => {
		const { loop, ship, receive, run, reports } = setup();
		receive(0, [record(TEAMMATE, "player", [0, 0, 10]), record(7, "pirate", [0, 0, -30], 50), record(8, "hunter", [0, 0, -60], 75)]);
		await settle();
		run(0.15);
		receive(0.2, [record(TEAMMATE, "player", [0, 0, 10]), record(7, "pirate", [0, 0, -30], 50), record(8, "hunter", [0, 0, -60], 75)], [
			["shot", 0.19, 0, 0, 5, 0, 0, -120, 0xffffff, 1.5, TEAMMATE, 0], /* a teammate's, at the pirate */
			["shot", 0.19, 0, 0, -55, 0, 0, 90, 0xff5544, 1.2, 8, 1], /* the hunter's, at me: 55 m at 90 m/s */
		]);
		run(1);

		expect(loop.scene.find(entity => entity instanceof Pirate)!.shields.value).toBe(50);
		expect(reports().flatMap(report => report.hits)).toEqual([]);
		expect(ship.shields.value).toBe(100);
		expect(loop.scene.filter(entity => entity instanceof Shot)).toHaveLength(0); /* both stopped where they hit */
	});

	it("does not report hits by its rockets: the server flies those", async () => {
		const { loop, ship, receive, run, reports } = setup();
		receive(0, [record(7, "pirate", [0, 0, -15], 50)]);
		await settle();
		run(0.2);
		const pirate = loop.scene.find(entity => entity instanceof Pirate)!;
		loop.spawn(new Missile(vec3.fromValues(0, 0, -3), vec3.fromValues(0, 0, -1), ship, pirate, ROCKET));
		run(1);

		const all = reports();
		expect(all.flatMap(report => report.rockets)).toEqual([{ p: expect.any(Array), target: 7 }]);
		expect(all.flatMap(report => report.hits)).toEqual([]);
		expect(pirate.shields.value).toBe(50);
	});

	it("loses its ship when the server no longer has it, and flies a new one when the server says", async () => {
		const { loop, ship, session, receive, run, reports } = setup({ size: 400, fragLimit: 10 });
		receive(0, []);
		await settle();
		run(0.1);

		receive(0.2, [], [], 0, { ship: MY_SHIP, flying: false }); /* the news of the explosion got lost */
		expect(ship.dead).toBe(true);
		run(0.2);
		expect(loop.scene).not.toContain(ship);
		const sentWhileDead = reports().length;
		run(0.2);
		expect(reports()).toHaveLength(sentWhileDead); /* nothing to say */

		ship.engine.speed.value = 7;
		ship.shields.value = 0;
		ship.rockets = 0;
		receive(0.6, [[MY_SHIP + 5, kindIndex("player"), 30, 20, 10, 0, 1, 0, 0, 100]], [], 100, { ship: MY_SHIP + 5, flying: true });
		run(0.1);
		expect(ship.dead).toBe(false);
		expect(loop.scene).toContain(ship);
		expect(ship.shields.value).toBe(100);
		expect(ship.rockets).toBe(ROCKET_CAPACITY);
		expect(ship.engine.speed.value).toBe(0);
		expect(Array.from(ship.position)).toEqual([30, 20, 10]);
		expect(session.players).toEqual([ship]); /* not a copy of itself */
		expect(reports().at(-1)!.ship!.p).toEqual([30, 20, 10]);
	});

	it("reports the hits of shots still flying after its ship is gone", async () => {
		const { ship, receive, run, reports } = setup({ size: 400, fragLimit: 10 });
		receive(0, [record(7, "pirate", [0, -0.3, -30], 50)]);
		await settle();
		run(0.2);
		ship.trigger = true;
		run(0.05);
		ship.trigger = false;

		receive(0.3, [record(7, "pirate", [0, -0.3, -30], 50)], [], 0, { ship: MY_SHIP, flying: false });
		run(0.4);
		const last = reports().at(-1)!;
		expect(last.hits).toHaveLength(1);
		expect(last.ship).toBeUndefined();
	});

	it("keeps everything at its copy nearest this ship in a world that wraps around", async () => {
		const { loop, ship, receive, run } = setup({ size: 400, fragLimit: 10 });
		vec3.set(ship.position, 190, 0, 0);
		receive(0, [record(TEAMMATE, "player", [-195, 0, 0])]);
		await settle();
		run(0.2);

		const other = loop.scene.find(entity => entity instanceof PlayerShip && entity != ship)!;
		expect(Array.from(other.position)).toEqual([205, 0, 0]); /* 15 m on, through the wall; not 385 m back */

		vec3.set(ship.position, 0, 0, 0);
		run(0.05);
		expect(Array.from(other.position)).toEqual([-195, 0, 0]);
	});

	it("hits other pilots in a deathmatch, across the wall too, but not in co-op", async () => {
		const shootAhead = async (arena: StartMessage["arena"], at: [number, number, number]) => {
			const { loop, ship, receive, run, reports } = setup(arena);
			receive(0, [record(TEAMMATE, "player", at, 100)]);
			await settle();
			run(0.2);
			ship.trigger = true;
			run(0.05);
			ship.trigger = false;
			run(0.4);
			return { hits: reports().flatMap(report => report.hits), shots: loop.scene.filter(entity => entity instanceof Shot) };
		};

		expect((await shootAhead(null, [0, -0.3, -30])).hits).toEqual([]);
		expect((await shootAhead({ size: 400, fragLimit: 10 }, [0, -0.3, -30])).hits).toHaveLength(1);
		expect((await shootAhead({ size: 400, fragLimit: 10 }, [0, -0.3, 370])).hits).toHaveLength(1); /* 30 m ahead, the other way round */
	});

	it("does not let rockets of teammates be shot in co-op, but in a deathmatch", async () => {
		for (const [arena, hittable] of [[null, false], [{ size: 400, fragLimit: 10 }, true]] as const) {
			const { loop, receive, run } = setup(arena);
			receive(0, [record(9, "rocket", [0, 0, -30])]);
			await settle();
			run(0.2);
			expect(loop.scene.find(entity => entity instanceof Missile)!.hittable).toBe(hittable);
		}
	});

	it("takes shields from the server and powerups the server says this ship collected", () => {
		const { ship, receive } = setup();
		receive(0, [], [["powerup", 0, "rapid"]], 60);
		expect(ship.shields.value).toBe(60);
		expect(ship.effects.rapid).toBeGreaterThan(0);
		expect(vec3.length(ship.position)).toBe(0);
	});
});
