import { vec3 } from "gl-matrix";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

export class Pod extends Entity {
	/** Entity carrying this pod away; while set, the carrier positions the pod */
	carrier: Entity | null = null;

	constructor() {
		super();

		this.hittable = true;
		this.fromNSH("internal/pod1");
		this.angularVelocity[1] = Math.PI; /* half a turn per second */
	}

	override update(dt: number, world: World): void {
		if (this.carrier?.dead) { /* dropped where it is */
			this.carrier = null;
			vec3.set(this.velocity, 0, 0, 0);
		}

		if (!this.carrier) { super.update(dt, world); }
	}
}
