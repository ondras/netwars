import { quat, vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import type { SoundName } from "./audio/sounds.ts";
import { Color } from "./color.ts";
import { CONTACT } from "./collision.ts";
import { Pirate } from "./entity/pirate.ts";
import { Pod } from "./entity/pod.ts";
import { BUMP_SPEED_KEPT, Ship, TUMBLE_TIME } from "./entity/ship.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";
import { settle, stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

/** Ship with a 1 m bounding sphere, flying at `speed` along -Z (or +Z when turned around) */
function shipAt(z: number, speed: number, turnedAround = false): Ship {
	const ship = new Ship();
	ship.position[2] = z;
	ship.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
	ship.engine.speed.value = ship.engine.speed.target = speed;
	if (turnedAround) { quat.setAxisAngle(ship.orientation, [0, 1, 0], Math.PI); }
	return ship;
}

function listen(loop: Loop): SoundName[] {
	const heard: SoundName[] = [];
	loop.onSound = name => heard.push(name);
	return heard;
}

/** Step until the condition holds; fails after `limit` seconds */
function runUntil(loop: Loop, condition: () => boolean, limit = 3): void {
	for (let t = 0; t < limit && !condition(); t += STEP) { loop.update(STEP); }
	expect(condition(), "condition not reached in time").toBe(true);
}

describe("bumping", () => {
	it("into a pod slows the ship down and pushes it back out; the pod stays put", async () => {
		const loop = new Loop();
		const heard = listen(loop);
		const ship = shipAt(0, 10);
		const pod = new Pod();
		pod.position[2] = -5;
		loop.scene.push(ship, pod);
		await settle(); /* pod model */

		runUntil(loop, () => ship.tumbling);

		expect(ship.engine.speed.value).toBeLessThanOrEqual(10 * BUMP_SPEED_KEPT + 0.2);
		expect(vec3.distance(ship.position, pod.position)).toBeCloseTo(CONTACT * (ship.radius + pod.radius), 5);
		expect(Array.from(pod.position)).toEqual([0, 0, -5]);
		expect(pod.dead).toBe(false);
		expect(heard).toEqual(["impact"]);
	});

	it("spins the ship for a moment, in yaw and pitch only", () => {
		const loop = new Loop();
		const ship = shipAt(0, 0);
		loop.scene.push(ship);
		ship.bump();

		loop.update(STEP);
		expect(vec3.length(ship.angularVelocity)).toBeGreaterThan(1);
		expect(ship.angularVelocity[2]).toBe(0);

		for (let t = 0; t < TUMBLE_TIME; t += STEP) { loop.update(STEP); }
		loop.update(STEP);
		expect(ship.tumbling).toBe(false);
		expect(vec3.length(ship.angularVelocity)).toBe(0);
	});

	it("counts as one bump until the spin is over", () => {
		const ship = shipAt(0, 10);
		expect(ship.bump()).toBe(true);
		expect(ship.bump()).toBe(false);
		expect(ship.engine.speed.value).toBeCloseTo(10 * BUMP_SPEED_KEPT);
	});

	it("of two ships slows both and pushes them apart equally", () => {
		const loop = new Loop();
		const heard = listen(loop);
		const a = shipAt(0, 10);
		const b = shipAt(-6, 10, true);
		loop.scene.push(a, b);

		runUntil(loop, () => a.tumbling);

		expect(b.tumbling).toBe(true);
		expect(a.engine.speed.value).toBeLessThan(4);
		expect(b.engine.speed.value).toBeLessThan(4);
		expect(vec3.distance(a.position, b.position)).toBeCloseTo(CONTACT * 2, 5);
		expect(a.position[2] + b.position[2]).toBeCloseTo(-6, 5); /* met in the middle */
		expect(heard).toEqual(["impact"]);
	});

	it("does not happen between a pirate and the pod it carries", async () => {
		const loop = new Loop();
		const pirate = new Pirate(shipAt(10000, 0)); /* player out of missile range */
		const pod = new Pod();
		pod.position[2] = -15;
		loop.scene.push(pirate, pod);
		await settle();

		runUntil(loop, () => pirate.cargo != null, 10);
		for (let t = 0; t < 1; t += STEP) { loop.update(STEP); }

		expect(pirate.tumbling).toBe(false);
	});
});
