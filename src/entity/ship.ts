import { vec3 } from "gl-matrix";
import type { Pilot } from "../pilot.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

interface Throttle {
	value: number;
	/** m/s^2 */
	changeRate: number;
	limit: number;
	/** -1..1 */
	control: number;
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
		speed: { value: 0, changeRate: 15, limit: 15, control: 0 },
		yaw: { changeRate: 3.5, control: 0 },
		pitch: { changeRate: 3.5, control: 0 },
	};

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

		const sign = Math.sign(speed.value);
		let diff = speed.changeRate * dt;

		if (speed.control) { /* force */
			diff *= speed.control;
			if (Math.abs(speed.value + diff) > speed.limit) { diff = sign * speed.limit - speed.value; }
		} else if (sign) { /* decay */
			diff *= -sign;
			if (diff / speed.value < -1) { diff = -speed.value; }
		} else {
			return;
		}

		speed.value += diff;

		vec3.set(this.velocity, 0, 0, -1); /* cardinal direction corresponding to default model orientation */
		vec3.scale(this.velocity, this.velocity, speed.value);
		vec3.transformQuat(this.velocity, this.velocity, this.orientation);
	}
}
