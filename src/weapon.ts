import { vec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";
import { Shot } from "./entity/shot.ts";

export class Weapon {
	private lastFired = 0;

	/** @returns The fired shot, or nothing while reloading */
	fire(ship: Entity): Entity[] | undefined {
		const now = Date.now();
		if (now - this.lastFired < 150) { return undefined; } /* FIXME */
		this.lastFired = now;

		const velocity = vec3.fromValues(0, 0, -1);
		vec3.transformQuat(velocity, velocity, ship.orientation);

		const position = vec3.clone(ship.position);
		vec3.scaleAndAdd(position, position, velocity, 1);

		vec3.scale(velocity, velocity, 50); /* fixme */

		return [new Shot(position, velocity)];
	}
}
