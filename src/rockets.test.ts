import { quat, vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { Entity } from "./entity/entity.ts";
import { Missile } from "./entity/missile.ts";
import { applyPowerup, ROCKET_REFILL } from "./entity/powerup.ts";
import { ROCKET, ROCKET_CAPACITY, Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import { triangle } from "./geometry.ts";
import { HOLD_CONE, LOCK_RANGE, LOCK_TIME, TargetLock } from "./lock.ts";
import { Loop } from "./loop.ts";
import { stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

/** Ship with a 1 m bounding sphere */
function shipAt(x: number, y: number, z: number): Ship {
	const ship = new Ship();
	vec3.set(ship.position, x, y, z);
	ship.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
	return ship;
}

class Enemy extends Ship {}

/** Player at the origin facing -Z, with rockets and a lock on Enemy ships */
function player(rockets = 3): Ship {
	const ship = shipAt(0, 0, 0);
	ship.rockets = rockets;
	ship.targetLock = new TargetLock(entity => entity instanceof Enemy);
	return ship;
}

function enemyAt(x: number, y: number, z: number): Enemy {
	const enemy = new Enemy();
	vec3.set(enemy.position, x, y, z);
	enemy.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
	return enemy;
}

function run(loop: Loop, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / STEP); i++) { loop.update(STEP); }
}

describe("target lock", () => {
	it(`locks onto an enemy kept ahead for ${LOCK_TIME} s`, () => {
		const lock = new TargetLock(entity => entity instanceof Enemy);
		const observer = shipAt(0, 0, 0);
		const enemy = enemyAt(2, 0, -50);

		lock.update(LOCK_TIME / 2, observer, [enemy]);
		expect(lock.target).toBe(enemy);
		expect(lock.locked).toBe(false);

		lock.update(LOCK_TIME / 2, observer, [enemy]);
		expect(lock.locked).toBe(true);
	});

	it("picks the enemy closest to the nose, and nothing too far off it, too far away or not an enemy", () => {
		const lock = new TargetLock(entity => entity instanceof Enemy);
		const observer = shipAt(0, 0, 0);

		lock.update(STEP, observer, [enemyAt(30, 0, -50), enemyAt(0, 0, -(LOCK_RANGE + 10)), shipAt(0, 0, -20)]);
		expect(lock.target).toBeNull();

		const nearer = enemyAt(1, 0, -60);
		lock.update(STEP, observer, [enemyAt(5, 0, -60), nearer]);
		expect(lock.target).toBe(nearer);
	});

	it("loses the target when it leaves the cone or is destroyed", () => {
		const lock = new TargetLock(entity => entity instanceof Enemy);
		const observer = shipAt(0, 0, 0);
		const enemy = enemyAt(0, 0, -50);
		lock.update(LOCK_TIME, observer, [enemy]);
		expect(lock.locked).toBe(true);

		quat.setAxisAngle(observer.orientation, [0, 1, 0], HOLD_CONE + 0.05); /* turned away */
		lock.update(STEP, observer, [enemy]);
		expect(lock.target).toBeNull();

		quat.identity(observer.orientation);
		lock.update(LOCK_TIME, observer, [enemy]);
		enemy.dead = true;
		lock.update(STEP, observer, [enemy]);
		expect(lock.target).toBeNull();
	});
});

describe("rockets", () => {
	it("launch only at a locked target, one per key press, until none are left", () => {
		const loop = new Loop();
		const ship = player(1);
		const enemy = enemyAt(0, 0, -60);
		loop.scene.push(ship, enemy);
		const rockets = () => loop.scene.filter(entity => entity instanceof Missile);

		ship.launch = true; /* not locked yet */
		loop.update(STEP);
		loop.update(STEP);
		expect(rockets()).toHaveLength(0);
		expect(ship.rockets).toBe(1);
		expect(ship.launch).toBe(false);

		run(loop, LOCK_TIME);
		ship.launch = true;
		loop.update(STEP);
		loop.update(STEP);
		expect(rockets()).toHaveLength(1);
		expect(rockets()[0].target).toBe(enemy);
		expect(ship.rockets).toBe(0);

		ship.launch = true;
		loop.update(STEP);
		loop.update(STEP);
		expect(rockets()).toHaveLength(1);
		expect(ship.targetLock!.target).toBeNull(); /* nothing to lock for without rockets */
	});

	it(`take ${ROCKET.damage} shield points: a pirate's worth`, () => {
		const loop = new Loop();
		const ship = player();
		const enemy = enemyAt(6, 0, -60); /* a little off the nose: the rocket has to turn */
		enemy.shields.value = enemy.shields.max = 50;
		loop.scene.push(ship, enemy);

		run(loop, LOCK_TIME);
		ship.launch = true;
		run(loop, 4);

		expect(enemy.dead).toBe(true);
	});

	it("are not shot down by their owner's gun", () => {
		const loop = new Loop();
		const owner = new Entity();
		const rocket = new Missile(vec3.fromValues(0, 0, -10), vec3.fromValues(0, 0, -1), owner, new Entity(), ROCKET);
		const shot = new Shot(vec3.create(), vec3.fromValues(0, 0, -100), owner, 1, 25);
		loop.spawn(rocket, shot);
		run(loop, 0.3);

		expect(rocket.dead).toBe(false);
	});

	it(`are refilled by ${ROCKET_REFILL} with a powerup, up to ${ROCKET_CAPACITY}`, () => {
		const ship = player(1);
		applyPowerup("rockets", ship);
		expect(ship.rockets).toBe(1 + ROCKET_REFILL);

		ship.rockets = ROCKET_CAPACITY - 1;
		applyPowerup("rockets", ship);
		expect(ship.rockets).toBe(ROCKET_CAPACITY);
	});
});
