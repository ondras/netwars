import { describe, expect, it } from "vitest";
import { KeyRepeat } from "./pilot.ts";

const STEP = 0.015;

/** Total steps produced while advancing by `seconds` */
function hold(keys: KeyRepeat, seconds: number): number {
	let steps = 0;
	for (let i = 0; i < Math.round(seconds / STEP); i++) { steps += keys.update(STEP); }
	return steps;
}

describe("KeyRepeat", () => {
	it("produces one step per press", () => {
		const keys = new KeyRepeat();

		keys.press(1);
		keys.release(1);
		keys.press(1);
		keys.release(1);

		expect(keys.update(STEP)).toBe(2);
		expect(keys.update(STEP)).toBe(0);
	});

	it("repeats a held key only after a delay", () => {
		const keys = new KeyRepeat();
		keys.press(-1);

		expect(hold(keys, 0.285)).toBe(-1); /* the press itself */
		expect(hold(keys, 0.015)).toBe(-1); /* first repeat at 0.3 s */
		expect(hold(keys, 0.81)).toBe(-10); /* then every 0.08 s: at 0.38, 0.46 … 1.10 s */
	});

	it("stops repeating on release", () => {
		const keys = new KeyRepeat();
		keys.press(1);
		hold(keys, 1);
		keys.release(1);

		expect(hold(keys, 1)).toBe(0);
	});

	it("ignores a second press of a key that is still held", () => {
		const keys = new KeyRepeat();
		keys.press(1);
		keys.press(1);

		expect(keys.update(STEP)).toBe(1);
	});

	it("lets opposite keys cancel out", () => {
		const keys = new KeyRepeat();
		keys.press(1);
		keys.press(-1);

		expect(hold(keys, 1)).toBe(0);
	});
});
