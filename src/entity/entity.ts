import { mat4, quat, vec3 } from "gl-matrix";
import type { Geometry } from "../geometry.ts";
import { loadNSH } from "../nsh.ts";

export class Entity {
	readonly position = vec3.create();
	readonly velocity = vec3.create();
	readonly orientation = quat.create();
	/** Angular velocity: rotation applied per second */
	readonly rotation = quat.create();
	readonly scale = vec3.fromValues(1, 1, 1);
	geometries: Geometry[] = [];
	dead = false;

	/** Entities spawned when this one dies (see die()) */
	private spawnOnDeath: Entity[] | null = null;

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

	/**
	 * Advance the simulation by dt seconds.
	 * @returns New entities to be added to the scene
	 */
	update(dt: number): Entity[] | undefined {
		if (this.dead && this.spawnOnDeath) {
			const spawned = this.spawnOnDeath;
			this.spawnOnDeath = null;
			return spawned;
		}

		vec3.scaleAndAdd(this.position, this.position, this.velocity, dt);

		const tmp = quat.multiply(quat.create(), this.orientation, this.rotation);
		quat.slerp(this.orientation, this.orientation, tmp, dt);
		quat.normalize(this.orientation, this.orientation);

		return undefined;
	}

	/** Mark as dead; the given entities are added to the scene on the next update */
	die(spawn: Entity[] = []): void {
		this.dead = true;
		this.spawnOnDeath = spawn;
	}
}
