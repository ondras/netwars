import { vec3, type ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "./audio/sounds.ts";
import type { Difficulty } from "./difficulty.ts";
import type { Entity } from "./entity/entity.ts";
import type { Ship } from "./entity/ship.ts";

/** What entities may see of and do to the scene while it is being updated */
export interface World {
	/** All entities, including ones that died during the current step */
	readonly scene: readonly Entity[];
	/** The players' ships, dead or alive: whom enemies hunt and who collects powerups */
	readonly players: readonly Ship[];
	/** Settings of the difficulty being played */
	readonly difficulty: Difficulty;
	/** Explosions leave debris; off where nobody watches (the game server) */
	readonly debris: boolean;
	/**
	 * Where the world wraps around, the side of the cube it repeats in (m); otherwise null.
	 * Coordinates never wrap, so a ship leaving on one side never jumps: only distances do.
	 */
	readonly size: number | null;
	/** The copy of a point nearest another: where to aim for it, how far it is. Without wrapping, the point itself. */
	nearest(point: ReadonlyVec3, around: ReadonlyVec3): ReadonlyVec3;
	/** Add entities to the scene once the current simulation step finishes */
	spawn(...entities: Entity[]): void;
	/**
	 * Play a sound effect made at a point; without one, it is heard as if at the player (alerts).
	 * @param to Only the player flying this ship hears it
	 */
	sound(name: SoundName, at?: ReadonlyVec3, to?: Entity): void;
}

/** The copy of a point nearest another, in a world that repeats every `size` along each axis */
export function nearestCopy(point: ReadonlyVec3, around: ReadonlyVec3, size: number): vec3 {
	const copy = vec3.clone(point);
	for (let axis = 0; axis < 3; axis++) { copy[axis] -= size * Math.round((point[axis] - around[axis]) / size); }
	return copy;
}
