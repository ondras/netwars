import { MECHANICS, type Mechanics } from "../mechanics.ts";
import { DEFAULT_LOOK, shipGeometries } from "./player-ships.ts";
import { Ship, STRAFE_SPEED } from "./ship.ts";

/** A ship flown by a person: yours, or another pilot's in online play; the only kind that strafes, with modern mechanics */
export class PlayerShip extends Ship {
	/** @param look Which ship and colours (./player-ships.ts); all are the same size to hit */
	constructor(look = DEFAULT_LOOK, mechanics: Mechanics = "classic") {
		super();
		this.geometries = shipGeometries(look);
		if (MECHANICS[mechanics].strafing) { this.engine.strafe.limit = STRAFE_SPEED; }
	}
}
