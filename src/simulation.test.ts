import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { Debris, explode } from "./entity/debris.ts";
import { Entity } from "./entity/entity.ts";
import { Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";
import { Weapon } from "./weapon.ts";

const STEP = 0.015;

function run(loop: Loop, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / STEP); i++) { loop.update(STEP); }
}

/** Hittable entity with a single triangle of the given size */
function target(z: number, size = 1): Entity {
	const entity = new Entity();
	entity.hittable = true;
	entity.position[2] = z;
	entity.geometries = [triangle(vec3.fromValues(0, size, 0), vec3.fromValues(-size, 0, 0), vec3.fromValues(size, 0, 0), new Color(0xffffff))];
	return entity;
}

const count = (loop: Loop, type: Function) => loop.scene.filter(entity => entity instanceof type).length;

describe("shots", () => {
	it("destroy a hittable entity in the line of fire", () => {
		const loop = new Loop();
		const victim = target(-20);
		const ship = new Ship();
		ship.trigger = true;
		loop.scene.push(victim, ship);

		run(loop, 1);

		expect(victim.dead).toBe(true);
		expect(loop.scene).not.toContain(victim);
		expect(count(loop, Debris)).toBeGreaterThan(0);
	});

	it("do not hit entities outside the line of fire", () => {
		const loop = new Loop();
		const bystander = target(-20);
		bystander.position[0] = 5;
		const ship = new Ship();
		ship.trigger = true;
		loop.scene.push(bystander, ship);

		run(loop, 1);

		expect(bystander.dead).toBe(false);
	});

	it("do not hit their owner", () => {
		const loop = new Loop();
		const ship = new Ship();
		ship.geometries = target(0, 3).geometries; /* bounding sphere larger than the muzzle offset */
		ship.trigger = true;
		loop.scene.push(ship);

		run(loop, 0.5);

		expect(ship.dead).toBe(false);
		expect(count(loop, Shot)).toBeGreaterThan(0);
	});

	it("disappear after their lifetime", () => {
		const loop = new Loop();
		const ship = new Ship();
		ship.trigger = true;
		loop.scene.push(ship);

		run(loop, STEP);
		ship.trigger = false;
		expect(count(loop, Shot)).toBe(1);

		run(loop, new Weapon().options.lifetime + 0.1);
		expect(count(loop, Shot)).toBe(0);
	});

	it("appear at the muzzle, rotated with the owner", () => {
		const owner = new Entity();
		vec3.set(owner.position, 10, 0, 0);
		owner.orientation[1] = Math.SQRT1_2; /* 90° left: ahead is -X */
		owner.orientation[3] = Math.SQRT1_2;

		const shot = new Weapon({ muzzle: [0, -0.3, -3] }).fire(owner)!;

		expect(shot.position[0]).toBeCloseTo(7);
		expect(shot.position[1]).toBeCloseTo(-0.3);
		expect(shot.position[2]).toBeCloseTo(0);
		expect(shot.velocity[0]).toBeLessThan(0);
	});

	it("inherit the owner's velocity", () => {
		const owner = new Entity();
		vec3.set(owner.velocity, 0, 0, -10);

		const shot = new Weapon({ muzzleSpeed: 50 }).fire(owner)!;

		expect(shot.velocity[2]).toBeCloseTo(-60);
	});
});

describe("weapon", () => {
	it("cannot fire again until reloaded", () => {
		const weapon = new Weapon({ reload: 0.15 });
		const owner = new Entity();

		expect(weapon.fire(owner)).toBeInstanceOf(Shot);
		expect(weapon.fire(owner)).toBeNull();

		weapon.update(0.1);
		expect(weapon.fire(owner)).toBeNull();

		weapon.update(0.05);
		expect(weapon.fire(owner)).toBeInstanceOf(Shot);
	});
});

describe("explosions", () => {
	it("do not modify geometry shared with other entities", () => {
		const loop = new Loop();
		const shared = target(0).geometries;
		const before = shared[0].points.map(point => vec3.clone(point));

		const a = new Entity();
		const b = new Entity();
		a.geometries = b.geometries = shared;
		vec3.set(a.position, 3, 0, 0);
		a.orientation[1] = 1; /* rotated */

		explode(a, loop);
		explode(b, loop);

		shared[0].points.forEach((point, i) => expect(vec3.equals(point, before[i])).toBe(true));
	});

	it("send debris away at a constant speed for at most 3 s", () => {
		const loop = new Loop();
		explode(target(0), loop);
		loop.update(STEP);

		const debris = loop.scene.filter(entity => entity instanceof Debris);
		const speeds = debris.map(entity => vec3.length(entity.velocity));
		expect(Math.min(...speeds)).toBeGreaterThan(0);

		run(loop, 1);
		debris.forEach((entity, i) => expect(vec3.length(entity.velocity)).toBeCloseTo(speeds[i]));

		run(loop, 2);
		expect(count(loop, Debris)).toBe(0);
	});

	it("happen only once", () => {
		const loop = new Loop();
		const entity = target(0);

		explode(entity, loop);
		explode(entity, loop);
		loop.update(STEP);

		expect(count(loop, Debris)).toBe(2); /* one geometry → one piece + one particle */
	});
});

describe("speed", () => {
	it("accelerates to the target speed and holds it", () => {
		const loop = new Loop();
		const ship = new Ship();
		ship.engine.speed.target = 5;
		loop.scene.push(ship);

		run(loop, 0.15); /* 15 m/s² → 2.25 m/s */
		expect(ship.engine.speed.value).toBeCloseTo(2.25);

		run(loop, 1);
		expect(ship.engine.speed.value).toBeCloseTo(5);
		expect(ship.velocity[2]).toBeCloseTo(-5); /* along -Z, the default heading */
	});

	it("goes into reverse and stays within ±limit", () => {
		const loop = new Loop();
		const ship = new Ship();
		const { limit } = ship.engine.speed;
		loop.scene.push(ship);

		ship.engine.speed.target = 100;
		run(loop, 2);
		expect(ship.engine.speed.value).toBeCloseTo(limit);

		ship.engine.speed.target = -100;
		run(loop, 3);
		expect(ship.engine.speed.value).toBeCloseTo(-limit);
		expect(ship.velocity[2]).toBeCloseTo(limit); /* moving backwards: +Z */
	});
});

describe("shields", () => {
	/** Ship 20 m ahead of an armed one, both with a 1 m bounding sphere */
	function duel(): { loop: Loop; shooter: Ship; victim: Ship } {
		const loop = new Loop();
		const shooter = new Ship();
		shooter.trigger = true;
		const victim = new Ship();
		victim.geometries = target(-20).geometries;
		victim.position[2] = -20;
		loop.scene.push(shooter, victim);
		return { loop, shooter, victim };
	}

	it("absorb hits until depleted", () => {
		const { loop, victim } = duel();

		run(loop, 0.25); /* first shot arrives after ~0.15 s */
		expect(victim.dead).toBe(false);
		expect(victim.shields.value).toBeLessThan(victim.shields.max);
		expect(victim.shields.value).toBeGreaterThan(0);
	});

	it("destroy the ship when depleted", () => {
		const { loop, victim } = duel();

		run(loop, 2); /* 4 hits at 25 points, one every 0.15 s */
		expect(victim.shields.value).toBe(0);
		expect(victim.dead).toBe(true);
		expect(count(loop, Debris)).toBeGreaterThan(0);
	});
});

describe("steering", () => {
	it("turns at the configured rate even at full deflection", () => {
		const loop = new Loop();
		const ship = new Ship();
		ship.engine.yaw.control = 1;
		loop.scene.push(ship);

		const seconds = 0.495;
		run(loop, seconds);

		const angle = ship.engine.yaw.changeRate * seconds;
		const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		expect(forward[0]).toBeCloseTo(-Math.sin(angle), 5); /* positive yaw turns left */
		expect(forward[2]).toBeCloseTo(-Math.cos(angle), 5);
	});
});

describe("loop", () => {
	it("limits catching up after a long pause", () => {
		const loop = new Loop({ step: STEP, maxFrame: 0.25 });
		expect(loop.advance(10)).toBe(Math.floor(0.25 / STEP));
	});
});
