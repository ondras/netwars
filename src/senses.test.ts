import { describe, expect, it } from "vitest";
import { ARENA_SIZES } from "./net/protocol.ts";
import { HEARING_REACH, RADAR_REACH, SENSE_FADE, senseFade, SIGHT_REACH } from "./senses.ts";

describe("a pilot's senses in a deathmatch", () => {
	it("take in what is near in full, fade out over the last stretch, and nothing beyond", () => {
		expect(senseFade(100, SIGHT_REACH)).toBe(1);
		expect(senseFade(SIGHT_REACH - SENSE_FADE, SIGHT_REACH)).toBe(1);
		expect(senseFade(SIGHT_REACH - SENSE_FADE / 2, SIGHT_REACH)).toBeCloseTo(0.5);
		expect(senseFade(SIGHT_REACH, SIGHT_REACH)).toBe(0);
		expect(senseFade(1000, SIGHT_REACH)).toBe(0);
	});

	it("reach so that the radar finds what the eyes cannot see yet, and whatever is heard is on the radar", () => {
		expect(SIGHT_REACH).toBeLessThan(RADAR_REACH);
		expect(HEARING_REACH).toBeLessThanOrEqual(RADAR_REACH);
	});

	it("never take in two copies of anything: all reach less than half the smallest arena", () => {
		for (const reach of [SIGHT_REACH, RADAR_REACH, HEARING_REACH]) { expect(reach).toBeLessThan(Math.min(...ARENA_SIZES) / 2); }
	});
});
