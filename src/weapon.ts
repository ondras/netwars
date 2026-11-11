import { vec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";
import { Shot } from "./entity/shot.ts";

export interface WeaponOptions {
	/** Time between shots (s) */
	reload: number;
	/** Shot speed relative to the firing entity's motion along its nose (m/s) */
	muzzleSpeed: number;
	/** Shot life span (s) */
	lifetime: number;
	/** Shield points a hit takes from a ship */
	damage: number;
	/**
	 * Where shots appear, in the firing entity's local frame (m; -Z is ahead).
	 * Shots fly parallel to the forward axis, so an offset below it keeps them from covering the aim point.
	 */
	muzzle: readonly [number, number, number];
	/** Shot color, 0xRRGGBB */
	color: number;
}

const DEFAULTS: WeaponOptions = {
	reload: 0.15,
	muzzleSpeed: 120,
	lifetime: 1.5,
	damage: 25,
	muzzle: [0, -0.3, -3],
	color: 0xffffff,
};

/**
 * What a shot keeps of the firing entity's velocity: only the part along its nose, so a shot fired while strafing
 * still goes where the nose points
 */
export function carriedVelocity(owner: Pick<Entity, "orientation" | "velocity">): vec3 {
	const axis = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), owner.orientation); /* -Z is the default model orientation */
	return vec3.scale(axis, axis, vec3.dot(owner.velocity, axis));
}

export class Weapon {
	readonly options: WeaponOptions;
	/** Time until the next shot is possible (s) */
	private cooldown = 0;

	constructor(options: Partial<WeaponOptions> = {}) {
		this.options = { ...DEFAULTS, ...options };
	}

	update(dt: number): void {
		this.cooldown = Math.max(0, this.cooldown - dt);
	}

	/**
	 * @param load What this shot does differently from the weapon's usual ones
	 * @returns The fired shot, or null while reloading
	 */
	fire(owner: Entity, load: Partial<Pick<WeaponOptions, "damage" | "color">> = {}): Shot | null {
		if (this.cooldown > 0) { return null; }
		this.cooldown = this.options.reload;

		const { muzzle, muzzleSpeed } = this.options;

		/* -Z is the default model orientation */
		const direction = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), owner.orientation);
		const offset = vec3.transformQuat(vec3.create(), vec3.fromValues(...muzzle), owner.orientation);

		const position = vec3.add(vec3.create(), owner.position, offset);
		const velocity = vec3.scaleAndAdd(vec3.create(), carriedVelocity(owner), direction, muzzleSpeed);

		const { lifetime, damage, color } = { ...this.options, ...load };
		return new Shot(position, velocity, owner, lifetime, damage, color);
	}
}
