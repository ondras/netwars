import { quat, vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { placeSound } from "./audio/player.ts";
import { SOUNDS, type SoundName } from "./audio/sounds.ts";
import { applyTremolo, peak, renderSound, renderSteps, SAMPLE_RATE } from "./audio/synth.ts";
import { Color } from "./color.ts";
import { Entity } from "./entity/entity.ts";
import { Missile } from "./entity/missile.ts";
import { Pirate } from "./entity/pirate.ts";
import { Pod } from "./entity/pod.ts";
import { Powerup } from "./entity/powerup.ts";
import { Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";
import { settle, stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

/** Frequency from upward zero crossings between two times (s) */
function pitch(samples: Float32Array, from: number, to: number): number {
	const a = Math.round(from * SAMPLE_RATE) + 100;
	const b = Math.round(to * SAMPLE_RATE) - 100;
	let first = -1;
	let last = -1;
	let count = 0;
	for (let i = a + 1; i < b; i++) {
		if (samples[i - 1] < 0 && samples[i] >= 0) {
			if (first < 0) { first = i; } else { count++; }
			last = i;
		}
	}
	return count / ((last - first) / SAMPLE_RATE);
}

function between(samples: Float32Array, from: number, to: number): Float32Array {
	return samples.subarray(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
}

describe("sound synthesis", () => {
	it("renders every sound, peaking exactly at its level", () => {
		for (const [name, definition] of Object.entries(SOUNDS)) {
			const samples = renderSound(definition);
			expect(samples.length / SAMPLE_RATE, name).toBeGreaterThan(0.1);
			expect(samples.every(Number.isFinite), name).toBe(true);
			expect(peak(samples), name).toBeCloseTo(definition.level, 6);
		}
	});

	it("steps the powerup up 224 Hz at a time, without dips at the steps", () => {
		const { params, steps } = SOUNDS.powerup;
		const samples = renderSteps(params, steps!);
		const switches = [0.0341, 0.0926, 0.1511, 0.2096];

		[0, ...switches].forEach((from, k) => {
			const to = switches[k] ?? from + 0.0585;
			expect(Math.abs(pitch(samples, from, to) - (482 + 224 * k)), `step ${k}`).toBeLessThan(6);
		});

		for (const at of switches) { /* the waves continue in phase, so the level does not sag */
			const before = peak(between(samples, at - 0.003, at - 0.0005));
			let lowest = Infinity;
			for (let t = at - 0.0005; t < at + 0.002; t += 0.0001) { lowest = Math.min(lowest, peak(between(samples, t, t + 0.0007))); }
			expect(lowest / before, `switch at ${at} s`).toBeGreaterThan(0.8);
		}
	});

	it("beeps twice when a pod is grabbed", () => {
		const samples = renderSound(SOUNDS.grabbed);
		expect(peak(between(samples, 0.02, 0.15))).toBeGreaterThan(0.3);
		expect(peak(between(samples, 0.2, 0.255))).toBeLessThan(0.01);
		expect(peak(between(samples, 0.28, 0.4))).toBeGreaterThan(0.3);
	});

	it("pulses the volume once per tremolo period", () => {
		const samples = new Float32Array(SAMPLE_RATE).fill(1);
		applyTremolo(samples, { depth: 0.5, period: 0.1 });
		expect(samples[Math.round(0.025 * SAMPLE_RATE)]).toBeCloseTo(1, 3);
		expect(samples[Math.round(0.075 * SAMPLE_RATE)]).toBeCloseTo(0, 3);
		expect(samples[Math.round(0.125 * SAMPLE_RATE)]).toBeCloseTo(1, 3);
	});
});

describe("placeSound", () => {
	const listener = { position: vec3.create(), orientation: quat.create() }; /* facing -Z */

	it("plays sounds without a position, or near the listener, at full volume in the middle", () => {
		expect(placeSound(listener)).toEqual({ gain: 1, pan: 0 });
		expect(placeSound(null, vec3.fromValues(100, 0, 0))).toEqual({ gain: 1, pan: 0 });
		expect(placeSound(listener, vec3.fromValues(0, 0, -10))).toEqual({ gain: 1, pan: 0 });
	});

	it("makes far sounds quieter and pans them to their side", () => {
		const right = placeSound(listener, vec3.fromValues(40, 0, 0));
		expect(right.gain).toBeCloseTo(0.5);
		expect(right.pan).toBeCloseTo(0.7);

		const left = placeSound(listener, vec3.fromValues(-80, 0, 0));
		expect(left.gain).toBeCloseTo(0.25);
		expect(left.pan).toBeCloseTo(-0.7);
	});

	it("follows the listener's heading", () => {
		const turnedLeft = { position: vec3.create(), orientation: quat.setAxisAngle(quat.create(), [0, 1, 0], Math.PI / 2) }; /* facing -X */
		expect(placeSound(turnedLeft, vec3.fromValues(0, 0, -40)).pan).toBeCloseTo(0.7); /* what was ahead is now on the right */
	});
});

describe("sound events", () => {
	function listen(loop: Loop): SoundName[] {
		const heard: SoundName[] = [];
		loop.onSound = name => heard.push(name);
		return heard;
	}

	function run(loop: Loop, seconds: number): void {
		for (let i = 0; i < Math.round(seconds / STEP); i++) { loop.update(STEP); }
	}

	/** Ship with a 1 m bounding sphere */
	function shipAt(x: number, y: number, z: number): Ship {
		const ship = new Ship();
		vec3.set(ship.position, x, y, z);
		ship.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
		return ship;
	}

	it("fire the cannon", () => {
		const loop = new Loop();
		const heard = listen(loop);
		const ship = shipAt(0, 0, 0);
		ship.trigger = true;
		loop.scene.push(ship);

		loop.update(STEP);
		expect(heard).toEqual(["cannon"]);
	});

	function shoot(shot: Shot, target: Ship): SoundName[] {
		const loop = new Loop();
		const heard = listen(loop);
		loop.scene.push(target);
		loop.spawn(shot);
		run(loop, 1);
		return heard;
	}

	it("hit with a shot or a missile, or explode", () => {
		const shot = () => new Shot(vec3.create(), vec3.fromValues(0, 0, -100), null, 1, 10);
		expect(shoot(shot(), shipAt(0, 0, -10))).toEqual(["hit"]);

		const victim = shipAt(0, 0, -10);
		expect(shoot(new Missile(vec3.create(), vec3.fromValues(0, 0, -1), new Entity(), victim), victim)).toEqual(["impact"]);

		const fragile = shipAt(0, 0, -10);
		fragile.shields.value = 5;
		expect(shoot(shot(), fragile)).toEqual(["explosion"]);
	});

	it("a pirate grabs a pod", async () => {
		const loop = new Loop();
		const heard = listen(loop);
		const pirate = new Pirate(shipAt(0, 0, 10000)); /* player out of missile range */
		const pod = new Pod();
		pod.position[2] = -15;
		loop.scene.push(pirate, pod);
		await settle();

		for (let t = 0; t < 10 && !pirate.cargo; t += STEP) { loop.update(STEP); }
		expect(pirate.cargo).toBe(pod);
		expect(heard).toEqual(["grabbed"]);
	});

	it("a pirate launches a missile at the player, who is warned", async () => {
		const loop = new Loop();
		const heard = listen(loop);
		const player = shipAt(0, 0, -30);
		loop.scene.push(player, new Pirate(player));
		await settle();

		for (let t = 0; t < 15 && !loop.scene.some(entity => entity instanceof Missile); t += STEP) { loop.update(STEP); }
		expect(heard).toEqual(["launch", "warning"]);
	});

	it("the player collects a powerup", () => {
		const loop = new Loop();
		const heard = listen(loop);
		const player = shipAt(0, 0, 0);
		player.engine.speed.target = 10; /* flies into it along -Z */
		const powerup = new Powerup("shields", player);
		powerup.position[2] = -10;
		loop.scene.push(player, powerup);

		run(loop, 2);
		expect(powerup.dead).toBe(true);
		expect(heard).toEqual(["powerup"]);
	});
});
