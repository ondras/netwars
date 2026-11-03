import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Debris } from "../entity/debris.ts";
import { Pirate } from "../entity/pirate.ts";
import { PlayerShip } from "../entity/player-ship.ts";
import { Pod } from "../entity/pod.ts";
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

function setup() {
	const loop = new Loop();
	const sent: ClientMessage[] = [];
	const sounds: string[] = [];
	const clock = { now: 0 };
	const ship = new PlayerShip();
	loop.players.push(ship);
	loop.scene.push(ship);
	const start: StartMessage = { type: "start", level: 0, difficulty: "normal", ships: { [ME]: MY_SHIP, 2: TEAMMATE }, spawn: [0, 0, 0], podsTotal: 3 };
	const session = new OnlineSession(loop, message => sent.push(message), start, ME, ship, () => clock.now);
	loop.rules = session.rules;
	loop.onStep = () => session.step(loop.step);
	loop.onSound = name => sounds.push(name);

	/** Arrives now, sent at server time t (no delay: the clocks match) */
	const receive = (t: number, records: EntityRecord[], ev: GameEvent[] = [], shields = 100) => {
		clock.now = t;
		session.receive({ type: "snapshot", t, e: records, ev, enemies: 2, pods: 3, shields } satisfies Snapshot);
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
		expect(all.flatMap(report => report.shots)).toHaveLength(1);
		expect(all.flatMap(report => report.hits)).toEqual([{ id: 7, damage: 25 }]);
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

	it("takes shields from the server and powerups the server says this ship collected", () => {
		const { ship, receive } = setup();
		receive(0, [], [["powerup", 0, "rapid"]], 60);
		expect(ship.shields.value).toBe(60);
		expect(ship.effects.rapid).toBeGreaterThan(0);
		expect(vec3.length(ship.position)).toBe(0);
	});
});
