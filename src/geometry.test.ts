import { vec3, type ReadonlyVec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { POWERUPS, type PowerupKind } from "./entity/powerup.ts";
import { boundingRadius, cuboid, pyramid, ring, type Geometry } from "./geometry.ts";

const WHITE = new Color(0xffffff);

/** Counter-clockwise as seen from outside means the right-hand normal points away from the inside */
function facesAwayFrom(geometry: Geometry, inside: ReadonlyVec3): boolean {
	const [a, b, c] = geometry.points as vec3[];
	const normal = vec3.cross(vec3.create(), vec3.subtract(vec3.create(), b, a), vec3.subtract(vec3.create(), c, a));
	const centroid = vec3.create();
	for (const point of geometry.points) { vec3.scaleAndAdd(centroid, centroid, point, 1 / geometry.points.length); }
	return vec3.dot(normal, vec3.subtract(vec3.create(), centroid, inside)) > 0;
}

describe("solids", () => {
	it("wind every face counter-clockwise as seen from outside", () => {
		const box = cuboid(vec3.fromValues(1, 2, 3), vec3.fromValues(2, 4, 3.5), WHITE);
		expect(box).toHaveLength(6);
		for (const face of box) { expect(facesAwayFrom(face, vec3.fromValues(1.5, 3, 3.25))).toBe(true); }

		for (const face of pyramid(0, 1, 0.5, WHITE)) { expect(facesAwayFrom(face, vec3.fromValues(0, 0.25, 0))).toBe(true); }

		for (const face of ring(1, 0.2, WHITE)) { /* away from the middle of the tube next to it */
			const centroid = face.points.reduce((sum, point) => vec3.add(sum, sum, point), vec3.create());
			const toTube = vec3.normalize(vec3.create(), vec3.fromValues(centroid[0], 0, centroid[2]));
			expect(facesAwayFrom(face, toTube)).toBe(true);
		}
	});

	it("shade faces by the way they face: lit from above, darker below", () => {
		const box = cuboid(vec3.fromValues(-1, -1, -1), vec3.fromValues(1, 1, 1), WHITE);
		const brightness = (face: Geometry) => (face.type == "billboard" ? 0 : face.color.rgb[0]);
		const top = box.find(face => face.points.every(point => point[1] == 1))!;
		const bottom = box.find(face => face.points.every(point => point[1] == -1))!;
		expect(brightness(top)).toBeGreaterThan(brightness(bottom));
	});
});

describe("powerup shapes", () => {
	it("differ between kinds and stay about a metre across", () => {
		const shapes = (Object.keys(POWERUPS) as PowerupKind[]).map(kind => POWERUPS[kind].shape());
		expect(new Set(shapes.map(shape => shape.length)).size).toBe(shapes.length);
		for (const shape of shapes) {
			expect(boundingRadius(shape)).toBeGreaterThan(0.5);
			expect(boundingRadius(shape)).toBeLessThan(0.85);
		}
	});
});
