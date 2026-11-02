import { describe, expect, it } from "vitest";
import { effectsVolume, setEffectsVolume } from "./settings.ts";

describe("settings", () => {
	it("start at 80 % effects volume where nothing is stored", () => {
		expect(effectsVolume()).toBe(0.8);
	});

	it("keep the effects volume between 0 and 1", () => {
		setEffectsVolume(1.7);
		expect(effectsVolume()).toBe(1);
		setEffectsVolume(-0.2);
		expect(effectsVolume()).toBe(0);
		setEffectsVolume(0.35);
		expect(effectsVolume()).toBe(0.35);
	});
});
