import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { convexHull, gunshipShape, hunterShape, pirateShape, raiderShape } from "./entity/shapes.ts";
import { boundingRadius, type Geometry, type Triangle } from "./geometry.ts";

const triangles = (geometries: readonly Geometry[]) => geometries.filter((g): g is Triangle => g.type == "triangle");
const lines = (geometries: readonly Geometry[]) => geometries.filter(g => g.type == "line");
const normalOf = ({ points: [a, b, c] }: Triangle) =>
	vec3.normalize(vec3.create(), vec3.cross(vec3.create(), vec3.subtract(vec3.create(), b, a), vec3.subtract(vec3.create(), c, a)));
const hex = (geometry: Geometry) => ("color" in geometry ? geometry.color.toString() : "");

describe("convexHull", () => {
	it("wraps a cube in twelve triangles, all facing out", () => {
		const cube = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => [x, y, z] as const)));
		const faces = convexHull([...cube, [0, 0, 0], [0.5, 0.2, -0.3]]); /* inner points are left out */
		expect(faces).toHaveLength(12);
		for (const [a, b, c] of faces) {
			const [pa, pb, pc] = [cube[a], cube[b], cube[c]].map(p => vec3.fromValues(...p));
			const normal = vec3.cross(vec3.create(), vec3.subtract(vec3.create(), pb, pa), vec3.subtract(vec3.create(), pc, pa));
			const centroid = vec3.scale(vec3.create(), vec3.add(vec3.create(), vec3.add(vec3.create(), pa, pb), pc), 1 / 3);
			expect(vec3.dot(normal, centroid)).toBeGreaterThan(0);
		}
	});
});

describe("enemy ships", () => {
	it("are as big as the models they replaced", () => {
		expect(boundingRadius(raiderShape())).toBeCloseTo(1, 5);
		expect(boundingRadius(hunterShape())).toBeCloseTo(1.25, 5);
		expect(boundingRadius(pirateShape())).toBeCloseTo(1.25, 5);
		expect(boundingRadius(gunshipShape())).toBeCloseTo(1.7, 5);
	});

	it("have neon edges where the scheme has them, and sticks as lines", () => {
		expect(lines(raiderShape())).toHaveLength(0); /* two-tone parts: no edges, no sticks */
		expect(lines(pirateShape()).map(hex)).toEqual(Array(4).fill("rgb(255,255,255)")); /* grey: just the four white sticks */
		expect(new Set(lines(hunterShape()).map(hex))).toEqual(new Set(["rgb(255,130,41)"]));
		expect(new Set(lines(gunshipShape()).map(hex))).toEqual(new Set(["rgb(199,110,255)"]));
		expect(lines(gunshipShape()).length).toBeGreaterThan(10);
	});

	it("give the raider flat wings seen from both sides", () => {
		const normals = triangles(raiderShape()).map(normalOf);
		const opposite = normals.filter(n => normals.some(m => vec3.dot(n, m) < -0.999));
		expect(opposite.length).toBeGreaterThanOrEqual(12); /* three wings, two triangles on each of two sides */
	});

	it("are built once and shared (debris copies what it takes)", () => {
		expect(gunshipShape()).toBe(gunshipShape());
	});
});
