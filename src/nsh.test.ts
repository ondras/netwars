import { describe, expect, it } from "vitest";
import { boundingRadius } from "./geometry.ts";
import { createNSH } from "./nsh.ts";
import { POD_MODEL } from "./testing.ts";

describe("createNSH", () => {
	it("builds triangles and lines in meters", () => {
		const geometries = createNSH(POD_MODEL);

		expect(geometries.filter(g => g.type == "triangle")).toHaveLength(8);
		expect(geometries.filter(g => g.type == "line")).toHaveLength(6);
		expect(boundingRadius(geometries)).toBeCloseTo(0.96);
	});
});
