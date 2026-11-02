import { vec3 } from "gl-matrix";
import { difficulty } from "../difficulty.ts";
import type { Geometry } from "../geometry.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { hunterShape } from "./shapes.ts";
import { Ship } from "./ship.ts";

export interface HunterOptions {
	shape: () => Geometry[];
	shields: number;
	/** Top speed (m/s) */
	speed: number;
	/** m/s² */
	acceleration: number;
	/** rad/s */
	turnRate: number;
	/** Time between shots (s) */
	reload: number;
	/** Shot damage as a multiple of the difficulty's hunterDamage */
	damageFactor: number;
	/** Where shots leave the hull, local (m) */
	muzzle: [number, number, number];
}

export const HUNTER: HunterOptions = {
	shape: hunterShape, shields: 75, speed: 13, acceleration: 10, turnRate: 2.2, reload: 0.35, damageFactor: 1, muzzle: [0, 0, -1.5],
};

/** Fires only at a player this close (m) … */
export const FIRE_RANGE = 70;
/** … and this close to straight ahead (rad) */
const FIRE_CONE = 0.12;
/** Breaks off the attack when this close to the player (m) … */
const BREAK_DISTANCE = 18;
/** … and flies away for this long before turning back (s) */
const EVADE_TIME = 2.5;

/**
 * Dogfighter: ignores the pods and attacks the player with guns,
 * breaking away after each close pass so that it does not ram or circle the player.
 */
export class Hunter extends Ship {
	private readonly player: Ship;
	private mode: "attack" | "evade" = "attack";
	private modeTime = 0;
	private readonly evadeTo = vec3.create();

	constructor(player: Ship, options: HunterOptions = HUNTER) {
		super();
		this.player = player;
		this.geometries = options.shape();

		this.shields.value = this.shields.max = options.shields;
		Object.assign(this.engine.speed, { limit: options.speed, changeRate: options.acceleration });
		this.engine.yaw.changeRate = this.engine.pitch.changeRate = options.turnRate;

		this.shotTarget = player; /* its shots cannot hit pods or other enemies */
		this.weapon = new Weapon({
			reload: options.reload,
			muzzleSpeed: 90,
			lifetime: 1.2,
			damage: difficulty().hunterDamage * options.damageFactor,
			muzzle: options.muzzle,
			color: 0xff5544,
		});
	}

	override update(dt: number, world: World): void {
		this.think(dt);
		super.update(dt, world);
	}

	private think(dt: number): void {
		const { player } = this;
		this.trigger = false;

		if (player.dead) {
			this.engine.speed.target = 0;
			return;
		}

		this.modeTime += dt;
		this.engine.speed.target = this.engine.speed.limit;
		const distance = vec3.distance(this.position, player.position);

		if (this.mode == "evade") {
			this.steerTowards(this.evadeTo);
			if (this.modeTime >= EVADE_TIME) { this.setMode("attack"); }
			return;
		}

		const angle = this.steerTowards(player.position);
		this.trigger = (distance <= FIRE_RANGE && angle <= FIRE_CONE);

		if (distance < BREAK_DISTANCE) {
			/* fly on past the player, veering off to a random side */
			const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), this.orientation);
			const side = vec3.random(vec3.create(), 30);
			vec3.scaleAndAdd(this.evadeTo, this.position, forward, 60);
			vec3.add(this.evadeTo, this.evadeTo, side);
			this.setMode("evade");
		}
	}

	private setMode(mode: Hunter["mode"]): void {
		this.mode = mode;
		this.modeTime = 0;
	}
}
