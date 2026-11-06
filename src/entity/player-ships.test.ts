import { vec3 } from "gl-matrix";
import { describe, expect, it } from "vitest";
import { Loop } from "../loop.ts";
import { Debris, explode, MAX_DEBRIS } from "./debris.ts";
import { PlayerShip } from "./player-ship.ts";
import { DEFAULT_LOOK, isLook, lookName, lookOf, lookParts, PLAYER_SHIPS, shipGeometries } from "./player-ships.ts";

const allLooks = PLAYER_SHIPS.flatMap((design, ship) => design.skins.map((_, skin) => lookOf(ship, skin)));

describe("player ships", () => {
	it("come in twelve designs of three colour schemes each", () => {
		expect(PLAYER_SHIPS).toHaveLength(12);
		expect(PLAYER_SHIPS.every(design => design.skins.length == 3)).toBe(true);
		expect(new Set(allLooks).size).toBe(36);
	});

	it("are all as big as the sphere hits go by, so none is easier to hit than another", () => {
		for (const look of allLooks) { expect(new PlayerShip(look).radius, lookName(look)).toBeCloseTo(0.75, 6); }
	});

	it("are built of real points only", () => {
		for (const look of allLooks) {
			const geometries = shipGeometries(look);
			expect(geometries.length, lookName(look)).toBeGreaterThan(20);
			for (const geometry of geometries) {
				for (const point of geometry.points) { expect(Array.from(point).every(Number.isFinite), lookName(look)).toBe(true); }
			}
		}
	});

	it("differ by colour between the schemes of a ship, but not in shape", () => {
		const [a, b] = [shipGeometries(lookOf(0, 0)), shipGeometries(lookOf(0, 1))];
		expect(a.length).toBe(b.length);
		expect(Array.from(a[0].points[0])).toEqual(Array.from(b[0].points[0]));
		expect(a.map(g => (g.type == "billboard" ? "" : g.color.toString()))).not.toEqual(b.map(g => (g.type == "billboard" ? "" : g.color.toString())));
	});

	it("tell a look from anything else, and read an unknown one as the default", () => {
		expect(isLook(0)).toBe(true);
		expect(isLook(35)).toBe(true);
		for (const value of [36, -1, 1.5, "3", null, undefined]) { expect(isLook(value)).toBe(false); }
		expect(lookParts(999)).toEqual(lookParts(DEFAULT_LOOK));
		expect(shipGeometries(999)).toBe(shipGeometries(DEFAULT_LOOK));
	});

	it("name a look for the menus", () => {
		expect(lookName(lookOf(0, 1))).toBe("Skate · Reef");
	});

	it("leave a limited amount of debris, however many faces they have", () => {
		for (const look of allLooks) {
			const loop = new Loop();
			const ship = new PlayerShip(look);
			explode(ship, loop);
			loop.update(loop.step);
			const pieces = loop.scene.filter(entity => entity instanceof Debris && entity.geometries[0].type != "billboard");
			expect(pieces.length, lookName(look)).toBeLessThanOrEqual(MAX_DEBRIS);
			expect(pieces.length, lookName(look)).toBeGreaterThan(MAX_DEBRIS / 2);
		}
	});

	it("explode where they are, facing the way they faced", () => {
		const loop = new Loop();
		const ship = new PlayerShip(lookOf(3, 2));
		vec3.set(ship.position, 40, 0, 0);
		explode(ship, loop);
		loop.update(loop.step);
		const debris = loop.scene.find(entity => entity instanceof Debris)!;
		expect(vec3.distance(debris.position, ship.position)).toBeLessThan(2);
	});
});
