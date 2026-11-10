import { quat, vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { Entity } from "./entity/entity.ts";
import { radarContact } from "./radar.ts";

function at(x: number, y: number, z: number): Entity {
	const entity = new Entity();
	vec3.set(entity.position, x, y, z);
	return entity;
}

describe("radarContact", () => {
	it("places a target ahead at the top, above with positive height", () => {
		const contact = radarContact(at(0, 0, 0), at(0, 5, -30), 60);

		expect(contact.x).toBeCloseTo(0);
		expect(contact.forward).toBeCloseTo(0.5);
		expect(contact.height).toBeCloseTo(5 / 60);
		expect(contact.outOfRange).toBe(false);
	});

	it("is relative to the observer's position and heading", () => {
		const observer = at(10, 0, 0);
		quat.rotateY(observer.orientation, observer.orientation, Math.PI / 2); /* turned left: now facing -X */

		const ahead = radarContact(observer, at(-20, 0, 0), 60);
		expect(ahead.forward).toBeCloseTo(0.5);
		expect(ahead.x).toBeCloseTo(0);

		const right = radarContact(observer, at(10, 0, -30), 60); /* world -Z is now on the right */
		expect(right.x).toBeCloseTo(0.5);
		expect(right.forward).toBeCloseTo(0);
	});

	it("pins targets beyond range to the edge of the square, keeping the direction", () => {
		const contact = radarContact(at(0, 0, 0), at(300, 0, 400), 100); /* 3 right, 4 behind (in ranges) */

		expect(contact.outOfRange).toBe(true);
		expect(contact.x).toBeCloseTo(0.75);
		expect(contact.forward).toBeCloseTo(-1);
	});

	it("keeps targets inside the square's corners in range", () => {
		const contact = radarContact(at(0, 0, 0), at(90, 0, -90), 100); /* 127 m away, but within the square */

		expect(contact.outOfRange).toBe(false);
		expect(contact.x).toBeCloseTo(0.9);
		expect(contact.forward).toBeCloseTo(0.9);
	});
});
