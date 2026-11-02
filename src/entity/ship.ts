import { vec3 } from "gl-matrix";
import type { Pilot } from "../pilot.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

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

	/** @returns Whether the ship survives the hit */
	absorb(damage: number): boolean {
		this.shields.value = Math.max(0, this.shields.value - damage);
		return this.shields.value > 0;
	}

	override update(dt: number, world: World): void {
		this.pilot?.update(dt, this);

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
