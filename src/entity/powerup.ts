import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { box } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import type { Ship } from "./ship.ts";

export type PowerupKind = "shields" | "rapid" | "boost";

/** Shield points restored by a shields powerup */
export const SHIELD_BONUS = 40;
/** Duration of the timed powerups (s) */
export const EFFECT_TIME = 15;

export const POWERUPS: Record<PowerupKind, { readonly label: string; readonly color: number }> = {
	shields: { label: "Shields", color: 0x44ee66 },
	rapid: { label: "Rapid fire", color: 0xffdd33 },
	boost: { label: "Boost", color: 0x4499ff },
};

const HALF_SIZE = 0.45;
/** Collected within this gap between the bounding spheres (m) */
const PICKUP_GAP = 1;

/** Spinning cube, collected by flying through it */
export class Powerup extends Entity {
	readonly kind: PowerupKind;
	private readonly player: Ship;

	constructor(kind: PowerupKind, player: Ship) {
		super();
		this.kind = kind;
		this.player = player;
		this.geometries = box(HALF_SIZE, new Color(POWERUPS[kind].color));
		vec3.set(this.angularVelocity, 0.8, 1.6, 0);
	}

	override update(dt: number, world: World): void {
		super.update(dt, world);

		const { player } = this;
		if (player.dead) { return; }
		if (vec3.distance(this.position, player.position) <= this.radius + player.radius + PICKUP_GAP) {
			applyPowerup(this.kind, player);
			this.dead = true;
		}
	}
}

export function applyPowerup(kind: PowerupKind, ship: Ship): void {
	switch (kind) {
		case "shields": ship.shields.value = Math.min(ship.shields.max, ship.shields.value + SHIELD_BONUS); break;
		case "rapid": ship.effects.rapid = EFFECT_TIME; break;
		case "boost": ship.effects.boost = EFFECT_TIME; break;
	}
}
