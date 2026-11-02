import type { Entity } from "./entity/entity.ts";

/** What entities may do to the scene while it is being updated */
export interface World {
	/** Add entities to the scene once the current simulation step finishes */
	spawn(...entities: Entity[]): void;
}
