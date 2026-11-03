import type { ReadonlyVec3 } from "gl-matrix";
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
	/** Add entities to the scene once the current simulation step finishes */
	spawn(...entities: Entity[]): void;
	/**
	 * Play a sound effect made at a point; without one, it is heard as if at the player (alerts).
	 * @param to Only the player flying this ship hears it
	 */
	sound(name: SoundName, at?: ReadonlyVec3, to?: Entity): void;
}
