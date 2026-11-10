import { describe, expect, it } from "vitest";
import { gunshipShape, hunterShape, pirateShape, raiderShape } from "./entity/shapes.ts";
import { shipIcon } from "./render/ship-icon.ts";

describe("shipIcon", () => {
	it("draws each enemy as an SVG of its own faces and lines, sized as asked", () => {
		for (const shape of [raiderShape, hunterShape, pirateShape, gunshipShape]) {
			const icon = shipIcon(shape(), 34);
			expect(icon).toMatch(/^<svg viewBox="[-\d. ]+" width="34" height="34"/);
			expect(icon).toContain("<polygon");
			expect(icon).not.toContain("NaN");
		}
	});

	it("keeps the neon edges and sticks", () => {
		expect(shipIcon(hunterShape(), 34)).toContain('<line x1="');
		expect(shipIcon(hunterShape(), 34)).toContain("rgb(255,130,41)");
		expect(shipIcon(pirateShape(), 34)).toContain('stroke="rgb(255,255,255)"');
	});
});
