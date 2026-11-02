import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { circle } from "../geometry.ts";
import type { World } from "../world.ts";
import type { Entity } from "./entity.ts";
import { Shot } from "./shot.ts";

export interface MissileOptions {
	/** m/s */
	speed: number;
	/** How fast it can turn towards the target (rad/s) */
	turnRate: number;
	/** s */
	lifetime: number;
	/** Shield points taken on hit */
	damage: number;
}

/*
 * Turning radius is speed / turnRate = 15 m: targets closer than that to either side of the missile
 * cannot be reached; the player (15 m/s, 3.5 rad/s: ~4 m) can out-turn it.
 */
const DEFAULTS: MissileOptions = {
	speed: 30,
	turnRate: 2,
	lifetime: 5,
	damage: 25,
};

const RADIUS = 0.3;

/** Homing shot that can only hit its target; a sharp enough turn makes it miss */
export class Missile extends Shot {
	private readonly turnRate: number;

	constructor(position: ReadonlyVec3, direction: ReadonlyVec3, owner: Entity, target: Entity, options: Partial<MissileOptions> = {}) {
		const { speed, turnRate, lifetime, damage } = { ...DEFAULTS, ...options };
		const velocity = vec3.scaleAndAdd(vec3.create(), owner.velocity, vec3.normalize(vec3.create(), direction), speed);
		super(vec3.clone(position), velocity, owner, lifetime, damage);

		this.target = target;
		this.turnRate = turnRate;
		this.geometries = [circle(vec3.create(), RADIUS, new Color(0xff8800))];
	}

	override update(dt: number, world: World): void {
		if (this.target && !this.target.dead) { this.turnTowards(this.target.position, this.turnRate * dt); }
		super.update(dt, world);
	}

	/** Rotate the velocity towards a point by at most maxAngle, keeping the speed */
	private turnTowards(point: ReadonlyVec3, maxAngle: number): void {
		const speed = vec3.length(this.velocity);
		if (!speed) { return; }

		const current = vec3.scale(vec3.create(), this.velocity, 1 / speed);
		const desired = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), point, this.position));
		const angle = Math.acos(Math.max(-1, Math.min(1, vec3.dot(current, desired))));
		if (angle < 1e-6) { return; }

		const axis = vec3.cross(vec3.create(), current, desired);
		if (vec3.length(axis) < 1e-9) { vec3.set(axis, current[1], -current[0], 0); } /* exactly behind: any perpendicular axis */
		if (vec3.length(axis) < 1e-9) { vec3.set(axis, 1, 0, 0); }
		vec3.normalize(axis, axis);

		const rotation = quat.setAxisAngle(quat.create(), axis, Math.min(angle, maxAngle));
		vec3.transformQuat(current, current, rotation);
		vec3.scale(this.velocity, current, speed);
	}
}
