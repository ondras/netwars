import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Entity } from "../entity/entity.ts";
import { Pod } from "../entity/pod.ts";
import { Powerup, POWERUPS, type PowerupKind } from "../entity/powerup.ts";
import { Ship } from "../entity/ship.ts";
import { MIN_ARENA_SIZE } from "../net/protocol.ts";
import { RADAR_REACH, SENSE_FADE } from "../senses.ts";
import { stubModels } from "../testing.ts";
import { POD_COLOR, RadarScope } from "./radar-scope.ts";

beforeAll(stubModels);

const RANGE = 150;

interface Call {
	readonly name: string;
	readonly args: readonly unknown[];
}

/** Draws the radar on a stand-in that writes down what it is told to do */
function draw(...entities: Entity[]): Call[] {
	return drawIn(false, ...entities);
}

function drawIn(reach: boolean, ...entities: Entity[]): Call[] {
	const calls: Call[] = [];
	const state: Record<string | symbol, unknown> = {};
	const ctx = new Proxy(state, {
		get: (_, name) => (name in state ? state[name] : (...args: unknown[]) => { calls.push({ name: String(name), args }); }),
		set: (_, name, value) => {
			state[name] = value;
			if (name == "globalAlpha") { calls.push({ name: "alpha", args: [value] }); }
			if (name == "strokeStyle") { calls.push({ name: "strokeStyle", args: [value] }); }
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	new RadarScope(RANGE).draw(ctx, new Entity(), entities, 0, 0, 260, 160, reach);
	return calls;
}

function at<T extends Entity>(entity: T, x: number, y: number, z: number): T {
	vec3.set(entity.position, x, y, z);
	return entity;
}

const powerup = (kind: PowerupKind, x: number, y: number, z: number) => at(new Powerup(kind, []), x, y, z);

/** How the one contact drawn looks */
function look(calls: readonly Call[]) {
	const index = calls.findIndex(({ name }) => name == "arc");
	const [dotX, dotY] = calls[index].args as number[];
	const texts = calls.filter(({ name }) => name == "fillText").map(({ args }) => args as [string, number, number]);
	return {
		dotX,
		dotY,
		/** Its outline is drawn: filled dots have none */
		hollow: calls.slice(index + 1).some(({ name }) => name == "stroke"),
		letter: texts.find(([text]) => text.length == 1) ?? null,
	};
}

describe("radar", () => {
	it("marks a powerup with its letter beside its dot, level with it, so that it stays put above or below", () => {
		for (const [kind, y] of [["shields", 30], ["boost", 0], ["rockets", -30]] as const) {
			const { dotX, dotY, letter } = look(draw(powerup(kind, 0, y, -60)));
			expect(letter![0]).toBe(POWERUPS[kind].letter);
			expect(letter![1]).toBeGreaterThan(dotX);
			expect(letter![2]).toBeCloseTo(dotY);
		}

		/* a whisker either way is a whisker either way, not a jump */
		const justAbove = look(draw(powerup("boost", 0, 0.1, -60)));
		const justBelow = look(draw(powerup("boost", 0, -0.1, -60)));
		expect(Math.abs(justAbove.letter![2] - justBelow.letter![2])).toBeLessThan(1);
	});

	it("gives each kind of powerup a letter of its own, and nothing else one", () => {
		const letters = (Object.keys(POWERUPS) as PowerupKind[]).map(kind => POWERUPS[kind].letter);
		expect(new Set(letters).size).toBe(letters.length);
		expect(look(draw(at(new Ship(), 0, 30, -60))).letter).toBeNull();
	});

	it("shows whether a contact out of range is above or below, hollow", () => {
		const level = look(draw(at(new Ship(), 0, 0, -400)));
		const above = look(draw(at(new Ship(), 0, 40, -400)));
		const below = look(draw(at(new Ship(), 0, -40, -400)));
		for (const contact of [level, above, below]) { expect(contact.hollow).toBe(true); }
		expect(above.dotY).toBeLessThan(level.dotY);
		expect(below.dotY).toBeGreaterThan(level.dotY);

		expect(look(draw(powerup("power", 0, 40, -400))).hollow).toBe(true);
		expect(look(draw(powerup("power", 0, 40, -400))).letter![0]).toBe(POWERUPS.power.letter);
	});

	it("fills the dots of contacts within range", () => {
		expect(look(draw(at(new Ship(), 0, 30, -60))).hollow).toBe(false);
	});

	describe("a pod being carried off", () => {
		function carriedOff() {
			const thief = at(new Ship(), 0, 30, -60);
			const pod = at(new Pod(), 0, 28.6, -60.3);
			pod.carrier = thief;
			return { thief, pod };
		}
		const arcs = (calls: readonly Call[]) => calls.filter(({ name }) => name == "arc").map(({ args }) => args as number[]);

		it("shows on its thief, with no dot of its own: a halo of its colour round the thief's dot", () => {
			const { thief, pod } = carriedOff();
			const calls = draw(thief, pod);
			const [dot, halo] = arcs(calls);
			expect(arcs(calls)).toHaveLength(2);
			expect(halo.slice(0, 2)).toEqual(dot.slice(0, 2));
			expect(halo[2]).toBeGreaterThan(dot[2]);
			/* the colour it is stroked in */
			const haloAt = calls.length - 1 - [...calls].reverse().findIndex(({ name }) => name == "arc");
			const strokedAt = haloAt + calls.slice(haloAt).findIndex(({ name }) => name == "stroke");
			expect(calls.slice(0, strokedAt).filter(({ name }) => name == "strokeStyle").at(-1)?.args[0]).toBe(POD_COLOR);
		});

		it("dashes the thief's stalk with its colour, and nothing after", () => {
			const { thief, pod } = carriedOff();
			const dashes = draw(thief, pod).filter(({ name }) => name == "setLineDash").map(({ args }) => args[0] as number[]);
			expect(dashes[0].length).toBeGreaterThan(0);
			expect(dashes.at(-1)).toEqual([]);
			expect(draw(at(new Ship(), 0, 30, -60)).some(({ name }) => name == "setLineDash")).toBe(false);
		});

		it("is a pod like any other again once its thief is destroyed", () => {
			const { thief, pod } = carriedOff();
			thief.dead = true;
			const calls = draw(thief, pod);
			expect(arcs(calls)).toHaveLength(1);
			expect(calls.some(({ name }) => name == "setLineDash")).toBe(false);
		});
	});

	describe("with a reach, as in a deathmatch", () => {
		/** Each dot drawn, and how much of it shows */
		function dots(...entities: Entity[]): number[] {
			let alpha = 1;
			const found: number[] = [];
			for (const { name, args } of drawIn(true, ...entities)) {
				if (name == "alpha") { alpha = args[0] as number; }
				if (name == "arc") { found.push(alpha); }
			}
			return found;
		}

		it("shows what is near in full, fades what is nearly out of reach, and leaves out the rest", () => {
			expect(dots(at(new Ship(), 0, 0, -100))).toEqual([1]);
			expect(dots(at(new Ship(), 0, 0, -(RADAR_REACH - SENSE_FADE / 2)))[0]).toBeCloseTo(0.5);
			expect(dots(at(new Ship(), 0, 120, -(RADAR_REACH - 10)))).toEqual([]); /* farther than that, all told */
			expect(dots(at(new Ship(), 0, 0, -(RADAR_REACH + 1)))).toEqual([]);
			expect(drawIn(true, powerup("boost", 0, 0, -250)).some(({ args }) => args[0] == POWERUPS.boost.letter)).toBe(false);
		});

		it("still shows a contact beyond the grid's range, within reach, as a hollow dot", () => {
			expect(look(drawIn(true, at(new Ship(), 0, 0, -(RANGE + 10)))).hollow).toBe(true);
		});

		it("leaves the radar without a reach as it was", () => {
			expect(drawIn(false, at(new Ship(), 0, 0, -300)).filter(({ name }) => name == "arc")).toHaveLength(1);
		});

		it("reaches less than half the smallest arena: a contact changes sides only out of reach", () => {
			expect(RADAR_REACH).toBeLessThan(MIN_ARENA_SIZE / 2);
		});
	});
});
