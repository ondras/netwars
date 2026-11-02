import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { DIFFICULTIES, setDifficulty } from "./difficulty.ts";
import { explode } from "./entity/debris.ts";
import { Entity } from "./entity/entity.ts";
import { Missile } from "./entity/missile.ts";
import { ESCAPE_RADIUS, Pirate } from "./entity/pirate.ts";
import { Pod } from "./entity/pod.ts";
import { Ship } from "./entity/ship.ts";
import { EnemySpawner } from "./entity/spawner.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";
import { settle, stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

/** Run until the condition holds; fails after `limit` seconds */
function runUntil(loop: Loop, condition: () => boolean, limit: number): void {
	for (let t = 0; t < limit; t += STEP) {
		if (condition()) { return; }
		loop.update(STEP);
	}
	expect(condition(), "condition not reached in time").toBe(true);
}

function run(loop: Loop, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / STEP); i++) { loop.update(STEP); }
}

/** Ship with a 1 m bounding sphere */
function shipAt(x: number, y: number, z: number): Ship {
	const ship = new Ship();
	vec3.set(ship.position, x, y, z);
	ship.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
	return ship;
}

/** Player far away, so pirates do not fire */
const absentPlayer = () => shipAt(0, 0, 10000);

describe("Ship.steerTowards", () => {
	it("turns left towards a point on the left and pitches up towards a point above", () => {
		const ship = new Ship();

		ship.steerTowards(vec3.fromValues(-10, 0, -10));
		expect(ship.engine.yaw.control).toBeGreaterThan(0);
		expect(ship.engine.pitch.control).toBeCloseTo(0);

		ship.steerTowards(vec3.fromValues(0, 10, -10));
		expect(ship.engine.yaw.control).toBeCloseTo(0);
		expect(ship.engine.pitch.control).toBeGreaterThan(0);

		expect(ship.steerTowards(vec3.fromValues(0, 0, -10))).toBeCloseTo(0);
	});
});

describe("missiles", () => {
	it("home onto a target off to the side", () => {
		const loop = new Loop();
		const victim = shipAt(20, 0, -20);
		const launcher = new Entity();
		loop.scene.push(victim, launcher);
		loop.spawn(new Missile(vec3.create(), vec3.fromValues(0, 0, -1), launcher, victim));

		run(loop, 3);

		expect(victim.shields.value).toBe(victim.shields.max - 25);
	});

	it("can be shot down", async () => {
		const loop = new Loop();
		const player = shipAt(0, 0, 0);
		player.trigger = true; /* fires along -Z */
		const pirate = new Entity();
		const missile = new Missile(vec3.fromValues(0, 0, -60), vec3.fromValues(0, 0, 1), pirate, player);
		loop.scene.push(player, pirate);
		loop.spawn(missile);
		await settle(); /* missile model */

		run(loop, 2);

		expect(missile.dead).toBe(true);
		expect(player.shields.value).toBe(player.shields.max);
	});

	it("point their nose along the flight path", () => {
		const loop = new Loop();
		const missile = new Missile(vec3.create(), vec3.fromValues(0, 0, -1), new Entity(), shipAt(30, 10, -20));
		loop.spawn(missile);

		run(loop, 0.5);

		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), missile.orientation);
		const heading = vec3.normalize(vec3.create(), missile.velocity);
		expect(vec3.dot(nose, heading)).toBeCloseTo(1, 4);
		expect(heading[0]).toBeGreaterThan(0); /* has turned towards the target */
	});

	it("fly through anything but their target", () => {
		const loop = new Loop();
		const bystander = shipAt(0, 0, -10);
		const victim = shipAt(0, 0, -30);
		const launcher = new Entity();
		loop.scene.push(bystander, victim, launcher);
		loop.spawn(new Missile(vec3.create(), vec3.fromValues(0, 0, -1), launcher, victim));

		run(loop, 2);

		expect(bystander.shields.value).toBe(bystander.shields.max);
		expect(victim.shields.value).toBeLessThan(victim.shields.max);
	});
});

describe("pirates", () => {
	async function heist(): Promise<{ loop: Loop; pirate: Pirate; near: Pod; far: Pod }> {
		const loop = new Loop();
		const pirate = new Pirate(absentPlayer());
		const near = new Pod();
		near.position[2] = -15;
		const far = new Pod();
		far.position[0] = 40;
		loop.scene.push(pirate, far, near);
		await settle(); /* models */
		return { loop, pirate, near, far };
	}

	it("grab the nearest pod", async () => {
		const { loop, pirate, near, far } = await heist();

		runUntil(loop, () => pirate.cargo != null, 10);

		expect(pirate.cargo).toBe(near);
		expect(near.carrier).toBe(pirate);
		expect(far.carrier).toBeNull();
	});

	it("carry the pod away until both are gone", async () => {
		const { loop, pirate, near } = await heist();
		runUntil(loop, () => pirate.cargo != null, 10);

		run(loop, 1);
		expect(vec3.distance(near.position, pirate.position)).toBeLessThan(pirate.radius + near.radius + 0.5);

		const grapple = pirate.grapple;
		runUntil(loop, () => !loop.scene.includes(pirate), ESCAPE_RADIUS / pirate.engine.speed.limit + 10);
		expect(near.dead).toBe(true);
		expect(loop.scene).not.toContain(near);
		expect(loop.scene).not.toContain(grapple);
	});

	it("reel the pod in close, with a grapple between them", async () => {
		const { loop, pirate, near } = await heist();
		runUntil(loop, () => pirate.cargo != null, 10);
		loop.update(STEP);

		expect(loop.scene).toContain(pirate.grapple);

		run(loop, 1); /* reeled in */
		const distance = vec3.distance(near.position, pirate.position);
		expect(distance).toBeLessThan(1.5);
		expect(distance).toBeLessThan(pirate.radius + near.radius); /* hit spheres overlap */
	});

	it("drop the pod when destroyed", async () => {
		const { loop, pirate, near } = await heist();
		runUntil(loop, () => pirate.cargo != null, 10);

		const grapple = pirate.grapple;
		explode(pirate, loop);
		run(loop, 0.5);
		const position = vec3.clone(near.position);
		run(loop, 1);

		expect(near.dead).toBe(false);
		expect(near.carrier).toBeNull();
		expect(vec3.distance(near.position, position)).toBeCloseTo(0);
		expect(loop.scene).not.toContain(grapple);
	});

	it("fire missiles at a player in range, as strong as the difficulty says", async () => {
		const loop = new Loop();
		const player = shipAt(0, 0, -30);
		const pirate = new Pirate(player);
		loop.scene.push(player, pirate);
		await settle();

		setDifficulty("easy");
		try {
			const missiles = () => loop.scene.filter(entity => entity instanceof Missile);
			runUntil(loop, () => missiles().length > 0, 15);
			expect(missiles()[0].damage).toBe(DIFFICULTIES.easy.missileDamage);
		} finally {
			setDifficulty("normal");
		}
	});

	/** Run a fresh spawner once and return its pirate */
	function spawnOne(player: Ship, pods: Pod[]): Pirate {
		const loop = new Loop();
		loop.scene.push(...pods, new EnemySpawner(player, ["pirate"], { max: 1, firstDelay: 0, minDistance: 120 }));
		loop.update(STEP);
		loop.update(STEP);
		return loop.scene.find(entity => entity instanceof Pirate)!;
	}

	const horizontalDistance = (a: vec3, b: vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

	it("appear beyond the pods as seen from the player, facing them", () => {
		const player = shipAt(0, 0, 100);
		const pods = [[-20, -10], [15, 5], [0, 20], [10, -25]].map(([x, z]) => {
			const pod = new Pod();
			vec3.set(pod.position, x, 0, z);
			return pod;
		});
		const center = vec3.fromValues(1.25, 0, -2.5);
		const toCenter = vec3.subtract(vec3.create(), center, player.position);
		const farthestPod = Math.max(...pods.map(pod => horizontalDistance(pod.position, player.position)));

		for (let i = 0; i < 20; i++) { /* the direction is randomized */
			const pirate = spawnOne(player, pods);
			const fromCenter = vec3.subtract(vec3.create(), pirate.position, center);

			expect(vec3.dot(fromCenter, toCenter)).toBeGreaterThan(0); /* on the far side */
			expect(horizontalDistance(pirate.position, player.position)).toBeGreaterThan(farthestPod);
			expect(horizontalDistance(pirate.position, player.position)).toBeGreaterThanOrEqual(120 - 0.1);

			const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), pirate.orientation);
			expect(vec3.dot(nose, vec3.negate(fromCenter, fromCenter))).toBeGreaterThan(0); /* facing the pods */
		}
	});

	it("appear at the minimum distance from the player when there are no free pods", () => {
		const player = shipAt(500, 0, -300);
		const pirate = spawnOne(player, []);

		expect(horizontalDistance(pirate.position, player.position)).toBeCloseTo(120, 0);
	});

	it("are sent in up to the limit, and replaced", async () => {
		const loop = new Loop();
		loop.scene.push(new EnemySpawner(absentPlayer(), ["pirate", "pirate", "pirate", "pirate"], { max: 2, firstDelay: 0, interval: 1 }));
		const pirates = () => loop.scene.filter(entity => entity instanceof Pirate);

		run(loop, 5);
		expect(pirates()).toHaveLength(2);

		explode(pirates()[0], loop);
		run(loop, 0.5);
		expect(pirates()).toHaveLength(1);

		run(loop, 1);
		expect(pirates()).toHaveLength(2);
	});
});
