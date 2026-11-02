import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { Pilot } from "../pilot.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

/** Control deflection per radian of heading error in steerTowards() */
const STEER_GAIN = 2;

interface Throttle {
	/** Current speed (m/s); negative is reverse */
	value: number;
	/** Speed the engine accelerates or brakes towards (m/s), -limit..limit */
	target: number;
	/** Acceleration and braking (m/s^2) */
	changeRate: number;
	/** Top speed, forward and reverse (m/s) */
	limit: number;
}

interface Shields {
	value: number;
	max: number;
}

interface Axis {
	/** rad/s at full deflection */
	changeRate: number;
	/** -1..1 */
	control: number;
}

export interface Engine {
	speed: Throttle;
	yaw: Axis;
	pitch: Axis;
}

export class Ship extends Entity {
	readonly engine: Engine = {
		speed: { value: 0, target: 0, changeRate: 15, limit: 15 },
		yaw: { changeRate: 3.5, control: 0 },
		pitch: { changeRate: 3.5, control: 0 },
	};

	/** Absorb hits; the ship is destroyed when they are depleted */
	readonly shields: Shields = { value: 100, max: 100 };

	/** Fire whenever the weapon is ready */
	trigger = false;

	private pilot: Pilot | null = null;
	private readonly weapon = new Weapon();

	constructor() {
		super();
		this.hittable = true;
	}

	setPilot(pilot: Pilot): this {
		this.pilot = pilot;
		return this;
	}

	/**
	 * Set yaw and pitch controls to turn the nose towards a point
	 * @returns Angle between the nose and the point (rad)
	 */
	steerTowards(point: ReadonlyVec3): number {
		const local = vec3.subtract(vec3.create(), point, this.position);
		vec3.transformQuat(local, local, quat.conjugate(quat.create(), this.orientation));

		/* local axes: +X right, +Y up, -Z ahead; positive yaw turns left, positive pitch raises the nose */
		const yaw = Math.atan2(-local[0], -local[2]);
		const pitch = Math.atan2(local[1], Math.hypot(local[0], local[2]));
		this.engine.yaw.control = Math.max(-1, Math.min(1, yaw * STEER_GAIN));
		this.engine.pitch.control = Math.max(-1, Math.min(1, pitch * STEER_GAIN));

		const distance = vec3.length(local);
		return (distance ? Math.acos(Math.max(-1, Math.min(1, -local[2] / distance))) : 0);
	}

	/** @returns Whether the ship survives the hit */
	absorb(damage: number): boolean {
		this.shields.value = Math.max(0, this.shields.value - damage);
		return this.shields.value > 0;
	}

	override update(dt: number, world: World): void {
		this.pilot?.update(dt, this, world);

		this.weapon.update(dt);
		if (this.trigger) {
			const shot = this.weapon.fire(this);
			if (shot) { world.spawn(shot); }
		}

		const { yaw, pitch } = this.engine;
		vec3.set(this.angularVelocity, pitch.changeRate * pitch.control, yaw.changeRate * yaw.control, 0);

		this.updateSpeed(dt);

		super.update(dt, world);
	}

	private updateSpeed(dt: number): void {
		const speed = this.engine.speed;

		const target = Math.min(speed.limit, Math.max(-speed.limit, speed.target));
		const maxChange = speed.changeRate * dt;
		speed.value += Math.max(-maxChange, Math.min(maxChange, target - speed.value));

		vec3.set(this.velocity, 0, 0, -speed.value); /* -Z is the default model orientation */
		vec3.transformQuat(this.velocity, this.velocity, this.orientation);
	}
}
