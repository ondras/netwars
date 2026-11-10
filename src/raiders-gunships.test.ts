import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { Color } from "./color.ts";
import { Gunship } from "./entity/gunship.ts";
import { Hunter } from "./entity/hunter.ts";
import { Missile } from "./entity/missile.ts";
import { Pirate } from "./entity/pirate.ts";
import { Pod } from "./entity/pod.ts";
import { Raider } from "./entity/raider.ts";
import { Ship } from "./entity/ship.ts";
import { EnemySpawner } from "./entity/spawner.ts";
import { triangle } from "./geometry.ts";
import { Loop } from "./loop.ts";
import { settle, stubModels } from "./testing.ts";

const STEP = 0.015;

beforeAll(stubModels);

/** Ship with a 1 m bounding sphere */
function shipAt(x: number, y: number, z: number): Ship {
	const ship = new Ship();
	vec3.set(ship.position, x, y, z);
	ship.geometries = [triangle(vec3.fromValues(0, 1, 0), vec3.fromValues(-1, 0, 0), vec3.fromValues(1, 0, 0), new Color(0xffffff))];
	return ship;
}

/** Player far away, so nobody fires */
const absentPlayer = () => shipAt(0, 0, 10000);

describe("raiders", () => {
	/** Seconds until the thief has a pod 40 m ahead */
	async function grabTime(thief: Pirate): Promise<number> {
		const loop = new Loop();
		const pod = new Pod();
		pod.position[2] = -40;
		loop.scene.push(thief, pod);
		await settle();

		let time = 0;
		while (!thief.cargo && time < 20) {
			loop.update(STEP);
			time += STEP;
		}
		expect(thief.cargo).toBe(pod);
		return time;
	}

	it("get to a pod sooner than a pirate", async () => {
		expect(await grabTime(new Raider(absentPlayer()))).toBeLessThan(await grabTime(new Pirate(absentPlayer())));
	});

	it("never fire missiles", async () => {
		const loop = new Loop();
		const player = shipAt(0, 0, -30);
		loop.scene.push(player, new Raider(player));
		await settle();

		for (let t = 0; t < 15; t += STEP) { loop.update(STEP); }
		expect(loop.scene.some(entity => entity instanceof Missile)).toBe(false);
	});
});

describe("gunships", () => {
	/** Shield points the first shot at a player 50 m ahead takes */
	async function firstHit(attacker: (player: Ship) => Hunter): Promise<number> {
		const loop = new Loop();
		const player = shipAt(0, 0, -50);
		loop.scene.push(player, attacker(player));
		await settle();

		for (let t = 0; t < 3 && player.shields.value == player.shields.max; t += STEP) { loop.update(STEP); }
		return player.shields.max - player.shields.value;
	}

	it("hit twice as hard as hunters and carry more shields", async () => {
		const hunter = await firstHit(player => new Hunter(player));
		expect(hunter).toBeGreaterThan(0);
		expect(await firstHit(player => new Gunship(player))).toBe(2 * hunter);
		expect(new Gunship(absentPlayer()).shields.max).toBeGreaterThan(new Hunter(absentPlayer()).shields.max);
	});
});

describe("EnemySpawner", () => {
	it("sends in raiders and gunships", () => {
		const loop = new Loop();
		loop.scene.push(new EnemySpawner(absentPlayer(), ["raider", "gunship"], { max: 2, firstDelay: 0, interval: 0 }));
		for (let i = 0; i < 4; i++) { loop.update(STEP); }

		expect(loop.scene.filter(entity => entity instanceof Raider)).toHaveLength(1);
		expect(loop.scene.filter(entity => entity instanceof Gunship)).toHaveLength(1);
	});
});
