import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { explode } from "./entity/debris.ts";
import { Hunter } from "./entity/hunter.ts";
import { Pirate } from "./entity/pirate.ts";
import { Pod } from "./entity/pod.ts";
import { EFFECT_TIME, Powerup, SHIELD_BONUS } from "./entity/powerup.ts";
import { BOOST_FACTOR, Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import { EnemySpawner } from "./entity/spawner.ts";
import { triangle } from "./geometry.ts";
import { LEVELS, levelOutcome } from "./levels.ts";
import { Loop } from "./loop.ts";
import { settle, stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

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

const count = (loop: Loop, type: Function) => loop.scene.filter(entity => entity instanceof type).length;

describe("levels", () => {
	it("are lost when the ship is destroyed or all pods are gone, won when no enemies are left", () => {
		expect(levelOutcome({ shipDead: false, podsLeft: 3, enemiesLeft: 2 })).toBeNull();
		expect(levelOutcome({ shipDead: true, podsLeft: 3, enemiesLeft: 0 })).toBe("ship-destroyed");
		expect(levelOutcome({ shipDead: false, podsLeft: 0, enemiesLeft: 0 })).toBe("pods-lost");
		expect(levelOutcome({ shipDead: false, podsLeft: 1, enemiesLeft: 0 })).toBe("won");
	});

	it("add two enemies at once, powerups, then hunters", () => {
		const [first, second, third] = LEVELS;

		expect(first.maxEnemies).toBe(1);
		expect(first.powerups).toBeNull();
		expect(second.maxEnemies).toBe(2);
		expect(second.powerups).not.toBeNull();
		expect(second.enemies).not.toContain("hunter");
		expect(third.enemies).toContain("hunter");
	});

	it("get harder after the third: more enemies, more of them at once, sooner", () => {
		for (let i = 3; i < LEVELS.length; i++) {
			const [previous, level] = [LEVELS[i - 1], LEVELS[i]];
			expect(level.enemies.length, level.name).toBeGreaterThan(previous.enemies.length);
			expect(level.maxEnemies, level.name).toBeGreaterThanOrEqual(previous.maxEnemies);
			expect(level.enemyInterval, level.name).toBeLessThan(previous.enemyInterval);
		}
		expect(LEVELS.length).toBeGreaterThanOrEqual(5);
	});

	it("have unique names, since best scores are kept by level name", () => {
		expect(new Set(LEVELS.map(level => level.name)).size).toBe(LEVELS.length);
	});
});

describe("EnemySpawner", () => {
	it("sends the queue in order, never more than max at once, and counts what remains", () => {
		const loop = new Loop();
		const player = shipAt(0, 0, 10000); /* out of the enemies' reach */
		const spawner = new EnemySpawner(player, ["pirate", "hunter", "pirate"], { max: 2, firstDelay: 0, interval: 0.5 });
		loop.scene.push(spawner);
		expect(spawner.remaining).toBe(3);

		run(loop, 2);
		expect(count(loop, Pirate)).toBe(1);
		expect(count(loop, Hunter)).toBe(1);
		expect(spawner.remaining).toBe(3);

		explode(loop.scene.find(entity => entity instanceof Hunter)!, loop);
		run(loop, 1);
		expect(count(loop, Pirate)).toBe(2);
		expect(spawner.remaining).toBe(2);

		for (const pirate of loop.scene.filter(entity => entity instanceof Pirate)) { explode(pirate, loop); }
		run(loop, 1);
		expect(spawner.remaining).toBe(0);
	});

	it("sends hunters in around the player, facing them", () => {
		const loop = new Loop();
		const player = shipAt(300, 0, 200);
		loop.scene.push(new EnemySpawner(player, ["hunter"], { max: 1, firstDelay: 0, minDistance: 120 }));
		loop.update(STEP);
		loop.update(STEP);

		const hunter = loop.scene.find(entity => entity instanceof Hunter)!;
		expect(Math.hypot(hunter.position[0] - 300, hunter.position[2] - 200)).toBeCloseTo(120, 0);

		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), hunter.orientation);
		const toPlayer = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), player.position, hunter.position));
		expect(vec3.dot(nose, toPlayer)).toBeGreaterThan(0.99);
	});
});

describe("powerups", () => {
	function collect(kind: Powerup["kind"], player: Ship): Loop {
		const loop = new Loop();
		const powerup = new Powerup(kind, player);
		powerup.position[2] = -10;
		player.engine.speed.target = 10; /* flies into it along -Z */
		loop.scene.push(player, powerup);
		run(loop, 2);
		expect(powerup.dead).toBe(true);
		return loop;
	}

	it("restore shields, up to the maximum", () => {
		const player = shipAt(0, 0, 0);
		player.shields.value = 30;
		collect("shields", player);
		expect(player.shields.value).toBe(30 + SHIELD_BONUS);

		const healthy = shipAt(0, 0, 0);
		healthy.shields.value = healthy.shields.max - 5;
		collect("shields", healthy);
		expect(healthy.shields.value).toBe(healthy.shields.max);
	});

	it("double the fire rate for a while", () => {
		const shotsPerSecond = (player: Ship) => {
			const loop = new Loop();
			player.trigger = true;
			loop.scene.push(player);
			let fired = 0;
			for (let i = 0; i < Math.round(1 / STEP); i++) {
				loop.update(STEP);
				fired += loop.scene.filter(entity => entity instanceof Shot && vec3.distance(entity.position, entity.previousPosition) == 0).length;
			}
			return fired;
		};

		const normal = shotsPerSecond(shipAt(0, 0, 0));
		const rapid = shipAt(0, 0, 0);
		collect("rapid", rapid);
		expect(rapid.effects.rapid).toBeGreaterThan(EFFECT_TIME - 2);
		expect(shotsPerSecond(rapid)).toBeGreaterThanOrEqual(2 * normal - 1);
	});

	it("raise the top speed for a while", () => {
		const player = shipAt(0, 0, 0);
		collect("boost", player);
		const boosted = player.engine.speed.limit * BOOST_FACTOR;
		expect(player.topSpeed).toBeCloseTo(boosted);

		const loop = new Loop();
		loop.scene.push(player);
		player.engine.speed.target = 100;
		run(loop, 3);
		expect(player.engine.speed.value).toBeCloseTo(boosted);

		run(loop, EFFECT_TIME);
		expect(player.engine.speed.value).toBeCloseTo(player.engine.speed.limit);
	});
});

describe("hunters", () => {
	async function face(playerZ: number): Promise<{ loop: Loop; player: Ship; hunter: Hunter }> {
		const loop = new Loop();
		const player = shipAt(0, 0, playerZ);
		const hunter = new Hunter(player); /* at the origin, facing -Z */
		loop.scene.push(player, hunter);
		await settle();
		return { loop, player, hunter };
	}

	it("shoot at a player ahead of them", async () => {
		const { loop, player } = await face(-50);
		run(loop, 1);
		expect(player.shields.value).toBeLessThan(player.shields.max);
	});

	it("hold fire while the player is not ahead", async () => {
		const { loop, hunter } = await face(50); /* behind */
		let fired = false;
		for (let i = 0; i < 20; i++) {
			loop.update(STEP);
			fired ||= loop.scene.some(entity => entity instanceof Shot && entity.owner == hunter);
		}
		expect(fired).toBe(false);
	});

	it("cannot hit pods in the line of fire", async () => {
		const { loop, player } = await face(-50);
		const pod = new Pod();
		pod.position[2] = -20;
		loop.scene.push(pod);
		await settle();

		run(loop, 1);
		expect(pod.dead).toBe(false);
		expect(player.shields.value).toBeLessThan(player.shields.max);
	});
});
