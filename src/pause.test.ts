import { describe, expect, it, vi } from "vitest";
import { Ship } from "./entity/ship.ts";
import { Loop } from "./loop.ts";
import { IdlePilot } from "./pilot.ts";

describe("after a level", () => {
	it("the ship slows to a stop and turns slowly, whatever the mouse was doing", () => {
		const loop = new Loop();
		const ship = new Ship();
		ship.engine.speed.value = 12;
		ship.engine.yaw.control = 1; /* full stick, as left by the player */
		ship.engine.pitch.control = -0.6;
		ship.trigger = true;
		ship.setPilot(new IdlePilot(0.05));
		loop.scene.push(ship);

		for (let i = 0; i < 100; i++) { loop.update(0.015); }

		expect(ship.engine.speed.value).toBe(0);
		expect(ship.angularVelocity[0]).toBe(0);
		expect(ship.angularVelocity[1]).toBeCloseTo(0.05);
		expect(ship.trigger).toBe(false);
	});
});

describe("pausing", () => {
	it("keeps drawing the scene but stops the simulation, which goes on from where it was", () => {
		vi.stubGlobal("requestAnimationFrame", () => 1);
		const loop = new Loop();
		let steps = 0;
		let frames = 0;
		loop.onStep = () => steps++;
		loop.renderers.push({ render: () => frames++ });
		const tick = (loop as unknown as { tick: (time: number) => void }).tick; /* the animation frame callback */

		tick(0);
		loop.paused = true;
		tick(100);
		tick(5000);
		expect(steps).toBe(0);
		expect(frames).toBe(3);

		loop.paused = false;
		tick(5060); /* only the time since the last frame counts, not the pause */
		expect(steps).toBeGreaterThanOrEqual(3);
		expect(steps).toBeLessThanOrEqual(4);
		vi.unstubAllGlobals();
	});
});
