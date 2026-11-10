import { vec3 } from "gl-matrix";
import { Entity } from "../entity/entity.ts";
import { Grapple } from "../entity/grapple.ts";
import { Gunship } from "../entity/gunship.ts";
import { Hunter } from "../entity/hunter.ts";
import { Missile } from "../entity/missile.ts";
import { Pirate } from "../entity/pirate.ts";
import { PlayerShip } from "../entity/player-ship.ts";
import { Pod } from "../entity/pod.ts";
import { Powerup, type PowerupKind } from "../entity/powerup.ts";
import { Raider } from "../entity/raider.ts";
import { Ship } from "../entity/ship.ts";
import { ENTITY_KINDS, powerupKind, type EntityKind } from "./protocol.ts";

/** What an entity is sent as, or null for entities not sent (shots and debris travel as events, spawners are unseen) */
export function kindOf(entity: Entity): EntityKind | null {
	if (entity instanceof Pod) { return "pod"; }
	if (entity instanceof Raider) { return "raider"; }
	if (entity instanceof Pirate) { return "pirate"; }
	if (entity instanceof Gunship) { return "gunship"; }
	if (entity instanceof Hunter) { return "hunter"; }
	if (entity instanceof PlayerShip) { return "player"; }
	if (entity instanceof Missile) { return (entity.owner instanceof PlayerShip ? "rocket" : "missile"); }
	if (entity instanceof Grapple) { return "grapple"; }
	if (entity instanceof Powerup) { return powerupKind(entity.kind); }
	return null;
}

export const kindIndex = (kind: EntityKind): number => ENTITY_KINDS.indexOf(kind);

/**
 * The number sent along with the position: shields of ships, length of grapples, for a pod the id of whoever is carrying it off (0: nobody)
 * @param idOf What an entity is sent as
 */
export function extraOf(entity: Entity, idOf: (entity: Entity) => number): number {
	if (entity instanceof Ship) { return Math.round(entity.shields.value); }
	if (entity instanceof Grapple) { return Math.round(entity.scale[1] * 100) / 100; }
	if (entity instanceof Pod) { return (entity.carrier && !entity.carrier.dead ? idOf(entity.carrier) : 0); }
	return 0;
}

export function applyExtra(entity: Entity, extra: number): void {
	if (entity instanceof PlayerShip) {
		entity.shields.value = extra;
	} else if (entity instanceof Ship) {
		/* enemies' shields only go down; a hit counted here already stays counted until the server's word on it arrives */
		entity.shields.value = Math.min(entity.shields.value, extra);
	}
	if (entity instanceof Grapple) { vec3.set(entity.scale, 1, extra, 1); }
}

/** Stand-ins for the references that copies of grapples and missiles need but never use */
let placeholders: { entity: Entity; pod: Pod } | null = null;

/**
 * A copy of an entity simulated on the server, to be placed from snapshots: it looks and counts as the real thing
 * (radar, rocket lock, collisions) but does not move by itself
 * @param look Which ship and colours, for another pilot's ship
 */
export function createCopy(kind: EntityKind, look?: number): Entity {
	placeholders ??= { entity: new Entity(), pod: new Pod() };
	const entity = ((): Entity => {
		switch (kind) {
			case "pod": return new Pod();
			case "pirate": return new Pirate([]);
			case "raider": return new Raider([]);
			case "hunter": return new Hunter([]);
			case "gunship": return new Gunship([]);
			case "missile":
			case "rocket": return new Missile(vec3.create(), vec3.fromValues(0, 0, -1), placeholders.entity, placeholders.entity);
			case "player": return new PlayerShip(look);
			case "grapple": return new Grapple(placeholders.entity, placeholders.pod);
			default: return new Powerup(kind.slice("powerup-".length) as PowerupKind, []);
		}
	})();
	entity.simulated = false;
	return entity;
}
