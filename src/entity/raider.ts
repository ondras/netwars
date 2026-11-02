import { Pirate, type PirateOptions } from "./pirate.ts";
import type { Ship } from "./ship.ts";

/** Nearly as fast as the player and turns quicker than a pirate, but thinly shielded and without missiles */
export const RAIDER: PirateOptions = { model: "internal/fighter3", shields: 30, speed: 14, acceleration: 12, turnRate: 2, missiles: false };

/** Fast pod thief */
export class Raider extends Pirate {
	constructor(player: Ship) {
		super(player, RAIDER);
	}
}
