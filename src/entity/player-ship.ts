import { DEFAULT_LOOK, shipGeometries } from "./player-ships.ts";
import { Ship } from "./ship.ts";

/** A ship flown by a person: yours, or another pilot's in online play */
export class PlayerShip extends Ship {
	/** @param look Which ship and colours (./player-ships.ts); all are the same size to hit */
	constructor(look = DEFAULT_LOOK) {
		super();
		this.geometries = shipGeometries(look);
	}
}
