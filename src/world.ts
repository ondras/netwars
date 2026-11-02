import type { ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "./audio/sounds.ts";
import type { Entity } from "./entity/entity.ts";

/** What entities may see of and do to the scene while it is being updated */
export interface World {
	/** All entities, including ones that died during the current step */
	readonly scene: readonly Entity[];
	/** Add entities to the scene once the current simulation step finishes */
	spawn(...entities: Entity[]): void;
	/** Play a sound effect made at a point; without one, it is heard as if at the player (alerts) */
	sound(name: SoundName, at?: ReadonlyVec3): void;
}
