import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayerShip } from "./entity/player-ship.ts";
import { KeyRepeat, PlayerPilot } from "./pilot.ts";

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

describe("PlayerPilot", () => {
	afterEach(() => { vi.unstubAllGlobals(); });

	/** Without a browser: the window and the element only need to take listeners */
	function setup(): { pilot: PlayerPilot; ship: PlayerShip; strafe: () => number } {
		vi.stubGlobal("window", new EventTarget());
		vi.stubGlobal("Element", class {});
		const pilot = new PlayerPilot(new EventTarget() as HTMLElement);
		const ship = new PlayerShip(undefined, "modern");
		return { pilot, ship, strafe: () => { pilot.update(STEP, ship); return ship.engine.strafe.target; } };
	}
	const key = (type: "keydown" | "keyup", code: string) =>
		({ type, code, target: null, repeat: false, metaKey: false, ctrlKey: false, altKey: false }) as unknown as Event;

	it("strafes while A or D is held, and not with both", () => {
		const { pilot, ship, strafe } = setup();
		const { limit } = ship.engine.strafe;
		expect(limit).toBeGreaterThan(0);
		expect(strafe()).toBe(0);

		pilot.handleEvent(key("keydown", "KeyD"));
		expect(strafe()).toBe(limit);
		pilot.handleEvent(key("keydown", "KeyA"));
		expect(strafe()).toBe(0);
		pilot.handleEvent(key("keyup", "KeyD"));
		expect(strafe()).toBe(-limit);
		pilot.handleEvent(key("keyup", "KeyA"));
		expect(strafe()).toBe(0);
	});

	it("stops strafing when the window loses focus or play starts over", () => {
		const { pilot, strafe } = setup();
		pilot.handleEvent(key("keydown", "KeyD"));
		pilot.handleEvent({ type: "blur" } as Event);
		expect(strafe()).toBe(0);

		pilot.handleEvent(key("keydown", "KeyA"));
		pilot.reset();
		expect(strafe()).toBe(0);
	});
});
