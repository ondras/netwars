import { playerShape } from "./shapes.ts";
import { Ship } from "./ship.ts";

/** A ship flown by a person: yours, or a teammate's in online play */
export class PlayerShip extends Ship {
	constructor() {
		super();
		this.geometries = playerShape();
	}
}
