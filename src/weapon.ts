import { vec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";
import { Shot } from "./entity/shot.ts";

export interface WeaponOptions {
	/** Time between shots (s) */
	reload: number;
	/** Shot speed relative to the firing entity (m/s) */
	muzzleSpeed: number;
	/** Shot life span (s) */
	lifetime: number;
	/**
	 * Where shots appear, in the firing entity's local frame (m; -Z is ahead).
	 * Shots fly parallel to the forward axis, so an offset below it keeps them from covering the aim point.
	 */
	muzzle: readonly [number, number, number];
}

const DEFAULTS: WeaponOptions = {
	reload: 0.15,
	muzzleSpeed: 120,
	lifetime: 1.5,
	muzzle: [0, -0.3, -3],
};

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

	/** @returns The fired shot, or null while reloading */
	fire(owner: Entity): Shot | null {
		if (this.cooldown > 0) { return null; }
		this.cooldown = this.options.reload;

		const { muzzle, muzzleSpeed } = this.options;

		/* -Z is the default model orientation */
		const direction = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), owner.orientation);
		const offset = vec3.transformQuat(vec3.create(), vec3.fromValues(...muzzle), owner.orientation);

		const position = vec3.add(vec3.create(), owner.position, offset);
		const velocity = vec3.scaleAndAdd(vec3.create(), owner.velocity, direction, muzzleSpeed);

		return new Shot(position, velocity, owner, this.options.lifetime);
	}
}
