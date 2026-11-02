import { Entity } from "./entity.ts";

export class Pod extends Entity {
	constructor() {
		super();

		this.hittable = true;
		this.fromNSH("internal/pod1");
		this.angularVelocity[1] = Math.PI; /* half a turn per second */
	}
}
