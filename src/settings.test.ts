import { describe, expect, it } from "vitest";
import { effectsVolume, lastRoomSetup, readRoomSetup, setEffectsVolume, setLastRoomSetup } from "./settings.ts";
import type { RoomSetup } from "./net/protocol.ts";

const SETUP: RoomSetup = { mode: "deathmatch", level: 2, difficulty: "hard", fragLimit: 20, timeLimit: 10 };

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

	it("remember the room setup picked last, with nothing remembered at first", () => {
		expect(lastRoomSetup()).toBeNull();
		setLastRoomSetup(SETUP);
		expect(lastRoomSetup()).toEqual(SETUP);
		expect(readRoomSetup(JSON.stringify(SETUP))).toEqual(SETUP);
	});

	it("forget a stored room setup that is not one any more, or never was", () => {
		for (const stored of [null, "", "null", "42", "{", JSON.stringify({ ...SETUP, mode: "race" }), JSON.stringify({ ...SETUP, fragLimit: 7 }),
			JSON.stringify({ ...SETUP, level: -1 }), JSON.stringify({ ...SETUP, timeLimit: undefined })]) {
			expect(readRoomSetup(stored), String(stored)).toBeNull();
		}
		expect(readRoomSetup(JSON.stringify({ ...SETUP, arenaSize: 800 }))).toEqual(SETUP); /* stored when the host picked the cube */
	});
});
