import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { resolveHits, segmentHitsSphere, segmentSphereEntry } from "./collision.ts";
import { Color } from "./color.ts";
import { Entity } from "./entity/entity.ts";
import { Shot } from "./entity/shot.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";

const v = (x: number, y: number, z: number) => vec3.fromValues(x, y, z);

describe("segmentSphereEntry", () => {
	it("returns the fraction of the segment where it enters the sphere", () => {
		expect(segmentSphereEntry(v(0, 0, 0), v(10, 0, 0), v(5, 0, 0), 1)).toBeCloseTo(0.4);
		expect(segmentSphereEntry(v(0, 0, 0), v(10, 0, 0), v(5, 2, 0), 1)).toBeNull();
	});

	it("returns 0 when starting inside", () => {
		expect(segmentSphereEntry(v(5, 0, 0), v(10, 0, 0), v(5, 0, 0), 1)).toBe(0);
	});
});

describe("resolveHits", () => {
	/** Hittable entity with a 1 m bounding sphere */
	const target = (z: number) => {
		const entity = new Entity();
		entity.hittable = true;
		entity.position[2] = z;
		entity.geometries = [triangle(v(0, 1, 0), v(-1, 0, 0), v(1, 0, 0), new Color(0xffffff))];
		return entity;
	};

	it("hits the sphere entered first along the shot's path, whatever the scene order", () => {
		const front = target(-10);
		const back = target(-11.5); /* spheres overlap */
		const shot = new Shot(v(0, 0, -20), v(0, 0, -100), null, 1, 25);
		vec3.set(shot.previousPosition, 0, 0, 0);

		resolveHits([shot, back, front], new Loop());

		expect(front.dead).toBe(true);
		expect(back.dead).toBe(false);
		expect(shot.dead).toBe(true);
	});

	it("lets a shot pass through what it is to spare, on to what is behind", () => {
		const teammate = target(-10);
		const enemy = target(-15);
		const shot = new Shot(v(0, 0, -20), v(0, 0, -100), null, 1, 25);
		vec3.set(shot.previousPosition, 0, 0, 0);

		resolveHits([shot, teammate, enemy], new Loop(), (_, hit) => hit == teammate);

		expect(teammate.dead).toBe(false);
		expect(enemy.dead).toBe(true);
	});
});

describe("segmentHitsSphere", () => {
	it("hits a sphere crossed by the middle of the segment", () => {
		expect(segmentHitsSphere(v(-5, 0, 0), v(5, 0, 0), v(0, 0.5, 0), 1)).toBe(true);
	});

	it("misses a sphere beside the segment", () => {
		expect(segmentHitsSphere(v(-5, 0, 0), v(5, 0, 0), v(0, 1.5, 0), 1)).toBe(false);
	});

	it("misses a sphere beyond the segment end", () => {
		expect(segmentHitsSphere(v(-5, 0, 0), v(5, 0, 0), v(7, 0, 0), 1)).toBe(false);
	});

	it("hits when an endpoint is inside the sphere", () => {
		expect(segmentHitsSphere(v(0, 0, 0), v(5, 0, 0), v(5.5, 0, 0), 1)).toBe(true);
	});

	it("treats a zero-length segment as a point", () => {
		expect(segmentHitsSphere(v(1, 0, 0), v(1, 0, 0), v(0, 0, 0), 1)).toBe(true);
		expect(segmentHitsSphere(v(2, 0, 0), v(2, 0, 0), v(0, 0, 0), 1)).toBe(false);
	});
});
