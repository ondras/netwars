import { mat4, quat, vec3 } from "gl-matrix";
import { boundingRadius, type Geometry } from "../geometry.ts";
import { loadNSH } from "../nsh.ts";
import type { World } from "../world.ts";

export class Entity {
	readonly position = vec3.create();
	readonly velocity = vec3.create();
	readonly orientation = quat.create();
	/** Rotation speed (rad/s) around the entity's local axes */
	readonly angularVelocity = vec3.create();
	readonly scale = vec3.fromValues(1, 1, 1);
	dead = false;
	/** Died by explode(), as opposed to leaving quietly (expired, collected, got away) */
	exploded = false;
	/** Moved by its own update(); false for copies of entities simulated elsewhere (online play) */
	simulated = true;
	/** Can be destroyed by shots */
	hittable = false;
	/** Drawn by the scene renderer */
	visible = true;

	#geometries: readonly Geometry[] = [];
	#radius = 0;

	get geometries(): readonly Geometry[] { return this.#geometries; }

	set geometries(geometries: readonly Geometry[]) {
		this.#geometries = geometries;
		this.#radius = boundingRadius(geometries);
	}

	/** Bounding sphere radius in world units */
	get radius(): number {
		return this.#radius * Math.max(this.scale[0], this.scale[1], this.scale[2]);
	}

	/** Asynchronously replaces geometries with a loaded model */
	fromNSH(name: string): this {
		loadNSH(name).then(geometries => { this.geometries = geometries; });
		return this;
	}

	getModelMatrix(): mat4 {
		const result = mat4.create();
		mat4.fromRotationTranslation(result, this.orientation, this.position);
		mat4.scale(result, result, this.scale);
		return result;
	}

	/** Advance the simulation by dt seconds */
	update(dt: number, _world: World): void {
		vec3.scaleAndAdd(this.position, this.position, this.velocity, dt);

		const angle = vec3.length(this.angularVelocity) * dt;
		if (angle > 0) {
			const axis = vec3.normalize(vec3.create(), this.angularVelocity);
			const delta = quat.setAxisAngle(quat.create(), axis, angle);
			quat.multiply(this.orientation, this.orientation, delta); /* local axes: apply on the right */
			quat.normalize(this.orientation, this.orientation);
		}
	}
}
