import type { Entity } from "./entity/entity.ts";

/** What entities may see of and do to the scene while it is being updated */
export interface World {
	/** All entities, including ones that died during the current step */
	readonly scene: readonly Entity[];
	/** Add entities to the scene once the current simulation step finishes */
	spawn(...entities: Entity[]): void;
}
