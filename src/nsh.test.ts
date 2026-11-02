import { describe, expect, it } from "vitest";
import { boundingRadius } from "./geometry.ts";
import { createNSH } from "./nsh.ts";

/* public/models/internal/pod1.nsh */
const POD = `VECTOR POD1_vertex[] = {
 { 0, 0, 72 }, { -72, 0, 0 }, { 0, 0, -72 }, { 72, 0, 0 }, { 0, -72, 0 }, { 0, 72, 0 },
 { 0, 0, 96 }, { -96, 0, 0 }, { 0, 0, -96 }, { 96, 0, 0 }, { 0, -96, 0 }, { 0, 96, 0 },
};
SPOLY POD1_spoly[] = {
 { 13, 3, { 4, 1, 0,}}, { 29, 3, { 4, 2, 1,}}, { 13, 3, { 4, 3, 2,}}, { 29, 3, { 4, 0, 3,}},
 { 5, 3, { 0, 1, 5,}}, { 21, 3, { 1, 2, 5,}}, { 5, 3, { 2, 3, 5,}}, { 21, 3, { 3, 0, 5,}},
 { 15, 2, { 0, 6, -1,}}, { 15, 2, { 1, 7, -1,}}, { 15, 2, { 2, 8, -1,}},
 { 15, 2, { 3, 9, -1,}}, { 15, 2, { 4, 10, -1,}}, { 15, 2, { 5, 11, -1,}},
};
SHAPE POD1_shape = {
0,12,14,
POD1_vertex,
POD1_spoly
};
`;

describe("createNSH", () => {
	it("builds triangles and lines in meters", () => {
		const geometries = createNSH(POD);

		expect(geometries.filter(g => g.type == "triangle")).toHaveLength(8);
		expect(geometries.filter(g => g.type == "line")).toHaveLength(6);
		expect(boundingRadius(geometries)).toBeCloseTo(0.96);
	});
});
