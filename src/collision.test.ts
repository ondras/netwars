import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { segmentHitsSphere } from "./collision.ts";

const v = (x: number, y: number, z: number) => vec3.fromValues(x, y, z);

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
