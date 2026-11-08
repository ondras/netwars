import { describe, expect, it } from "vitest";
import { SIGHT_REACH, SENSE_FADE } from "../senses.ts";
import { outlineShows } from "./webgl.ts";

describe("outlines", () => {
	it("show in full on what is big on screen, give way to its paint as it shrinks, and are gone on what is a few pixels", () => {
		expect(outlineShows(40)).toBe(1);
		expect(outlineShows(24)).toBe(1);
		expect(outlineShows(16)).toBeGreaterThan(0);
		expect(outlineShows(16)).toBeLessThan(1);
		expect(outlineShows(8)).toBe(0);
		expect(outlineShows(2)).toBe(0);
	});

	it("are gone on a ship where it comes into full view, on a screen 900 pixels tall", () => {
		const shipRadius = 0.75;
		const pixelsPerRadian = 450 / Math.tan(Math.PI / 8); /* 45° high */
		expect(outlineShows(shipRadius / (SIGHT_REACH - SENSE_FADE) * pixelsPerRadian)).toBe(0);
	});
});
