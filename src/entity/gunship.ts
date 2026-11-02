import { Hunter, type HunterOptions } from "./hunter.ts";
import type { Ship } from "./ship.ts";

/** Slow and heavy: big, well shielded, turns slowly, and its shots hit twice as hard as a hunter's */
export const GUNSHIP: HunterOptions = {
	model: "internal/cruiser1", scale: 1.5, shields: 200, speed: 8, acceleration: 6, turnRate: 1.3, reload: 0.5, damageFactor: 2, muzzle: [0, 0, -2.2],
};

/** Armoured dogfighter */
export class Gunship extends Hunter {
	constructor(player: Ship) {
		super(player, GUNSHIP);
	}
}
