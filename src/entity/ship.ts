import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { TargetLock } from "../lock.ts";
import type { Pilot } from "../pilot.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import { Missile, type MissileOptions } from "./missile.ts";

/** Control deflection per radian of heading error in steerTowards() */
const STEER_GAIN = 2;

/** Weapon reload speed-up while the rapid fire effect lasts */
export const RAPID_FIRE_FACTOR = 2;
/** Top speed multiplier while the boost effect lasts */
export const BOOST_FACTOR = 1.5;

/** Share of the speed kept after bumping into something */
export const BUMP_SPEED_KEPT = 0.3;
/** How long a ship spins after a bump (s) */
export const TUMBLE_TIME = 1;
/** Spin rate right after a bump (rad/s); it fades to nothing over TUMBLE_TIME, turning the ship about 45° */
export const TUMBLE_SPIN = 1.5;

/** Most rockets a ship carries */
export const ROCKET_CAPACITY = 3;
/** The player's homing rockets: faster and more agile than pirate missiles; one destroys a pirate */
export const ROCKET: MissileOptions = { speed: 35, turnRate: 3, lifetime: 5, damage: 50 };
/** Where rockets leave the hull, local (m): below the line of sight, like the gun */
const ROCKET_MOUNT = vec3.fromValues(0, -0.6, -1.5);

/** Remaining time of timed effects (s); 0 when inactive */
export interface Effects {
	rapid: number;
	boost: number;
}

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
	/** If set, shots fired can only hit these entities */
	shotTargets: readonly Entity[] | null = null;

	/** Homing rockets left */
	rockets = 0;
	/** Set by the pilot to launch a rocket at the locked target; handled and cleared on update */
	launch = false;
	/** Finds targets for the rockets; only the player's ship has one */
	targetLock: TargetLock | null = null;

	readonly effects: Effects = { rapid: 0, boost: 0 };

	/** Whose shot or rocket hit this ship last */
	lastHitBy: Entity | null = null;

	private pilot: Pilot | null = null;
	protected weapon = new Weapon();

	/** Spin after a bump (rad/s, local) added to the steering, and its remaining time (s) */
	private readonly tumble = { spin: vec3.create(), time: 0 };

	constructor() {
		super();
		this.hittable = true;
	}

	setPilot(pilot: Pilot): this {
		this.pilot = pilot;
		return this;
	}

	/** Speed limit including the boost effect (m/s), forward and reverse */
	get topSpeed(): number {
		return this.engine.speed.limit * (this.effects.boost > 0 ? BOOST_FACTOR : 1);
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

	/** Whole again after being destroyed: full shields and rockets, at a standstill, nothing left of the last flight */
	revive(): void {
		this.dead = false;
		this.exploded = false;
		this.shields.value = this.shields.max;
		this.rockets = ROCKET_CAPACITY;
		this.launch = false;
		this.lastHitBy = null;
		this.effects.rapid = this.effects.boost = 0;
		this.tumble.time = 0;
		this.engine.speed.value = this.engine.speed.target = 0;
	}

	get tumbling(): boolean {
		return this.tumble.time > 0;
	}

	/**
	 * Knocked off course by bumping into something: most of the speed is lost and the ship spins for a moment.
	 * The spin is a random mix of yaw and pitch, never roll, since there is no roll control to undo it.
	 * @returns false, changing nothing, while the ship still spins from the previous bump
	 */
	bump(): boolean {
		if (this.tumbling) { return false; }

		this.engine.speed.value *= BUMP_SPEED_KEPT;
		const direction = 2 * Math.PI * Math.random();
		vec3.set(this.tumble.spin, TUMBLE_SPIN * Math.cos(direction), TUMBLE_SPIN * Math.sin(direction), 0);
		this.tumble.time = TUMBLE_TIME;
		return true;
	}

	override update(dt: number, world: World): void {
		this.pilot?.update(dt, this, world);

		if (this.targetLock) {
			if (this.rockets > 0) { this.targetLock.update(dt, this, world.scene); } else { this.targetLock.clear(); }
		}
		if (this.launch) {
			this.launch = false;
			this.launchRocket(world);
		}

		const { effects } = this;
		effects.rapid = Math.max(0, effects.rapid - dt);
		effects.boost = Math.max(0, effects.boost - dt);

		this.weapon.update(dt * (effects.rapid > 0 ? RAPID_FIRE_FACTOR : 1));
		if (this.trigger) {
			const shot = this.weapon.fire(this);
			if (shot) {
				shot.hitOnly = this.shotTargets;
				world.spawn(shot);
				world.sound("cannon", this.position);
			}
		}

		const { yaw, pitch } = this.engine;
		vec3.set(this.angularVelocity, pitch.changeRate * pitch.control, yaw.changeRate * yaw.control, 0);
		if (this.tumbling) {
			vec3.scaleAndAdd(this.angularVelocity, this.angularVelocity, this.tumble.spin, this.tumble.time / TUMBLE_TIME);
			this.tumble.time = Math.max(0, this.tumble.time - dt);
		}

		this.updateSpeed(dt);

		super.update(dt, world);
	}

	/** At the locked target, if there is one and a rocket is left */
	private launchRocket(world: World): void {
		const target = (this.targetLock?.locked ? this.targetLock.target : null);
		if (!target || this.rockets <= 0) { return; }

		this.rockets--;
		const position = vec3.transformQuat(vec3.create(), ROCKET_MOUNT, this.orientation);
		vec3.add(position, position, this.position);
		const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), this.orientation);
		world.spawn(new Missile(position, forward, this, target, ROCKET));
		world.sound("launch", position);
	}

	private updateSpeed(dt: number): void {
		const speed = this.engine.speed;

		const limit = this.topSpeed;
		const target = Math.min(limit, Math.max(-limit, speed.target));
		const maxChange = speed.changeRate * dt;
		speed.value += Math.max(-maxChange, Math.min(maxChange, target - speed.value));

		vec3.set(this.velocity, 0, 0, -speed.value); /* -Z is the default model orientation */
		vec3.transformQuat(this.velocity, this.velocity, this.orientation);
	}
}
