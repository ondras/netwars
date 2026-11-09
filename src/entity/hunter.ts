import { vec3 } from "gl-matrix";
import type { Geometry } from "../geometry.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { hunterShape } from "./shapes.ts";
import { Ship } from "./ship.ts";
import { nearestAlive, toList } from "./targets.ts";

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
/** … or, once it has stopped gaining on them, this close: about as far as its shots carry at a pilot backing away (m) … */
export const LONG_FIRE_RANGE = 100;
/** … and this close to straight ahead (rad) */
const FIRE_CONE = 0.12;
/** How long it chases a player, nose on them, without gaining on them before it takes long shots (s) */
export const LONG_SHOT_DELAY = 2.5;
/** Gaining on a player: getting this much closer than it has been since the nose came on them (m) */
const GAIN = 3;
/** Breaks off the attack when this close to the player (m) … */
const BREAK_DISTANCE = 18;
/** … and flies away for this long before turning back (s) */
const EVADE_TIME = 2.5;

/**
 * Dogfighter: ignores the pods and attacks the nearest player with guns,
 * breaking away after each close pass so that it does not ram or circle them.
 */
export class Hunter extends Ship {
	private readonly players: readonly Ship[];
	private readonly damageFactor: number;
	/** Player being attacked; picked again after each pass */
	private target: Ship | null = null;
	private mode: "attack" | "evade" = "attack";
	private modeTime = 0;
	private readonly evadeTo = vec3.create();
	/** Nearest it has come to the target since its nose came on them (m), and how long since it last gained on them (s) */
	private closest = Infinity;
	private stalled = 0;

	/** @param players Whom it hunts: one ship or a list kept up to date by the caller */
	constructor(players: Ship | readonly Ship[], options: HunterOptions = HUNTER) {
		super();
		this.players = toList(players);
		this.damageFactor = options.damageFactor;
		this.geometries = options.shape();

		this.shields.value = this.shields.max = options.shields;
		Object.assign(this.engine.speed, { limit: options.speed, changeRate: options.acceleration });
		this.engine.yaw.changeRate = this.engine.pitch.changeRate = options.turnRate;

		this.shotTargets = this.players; /* its shots cannot hit pods or other enemies */
		this.weapon = new Weapon({
			reload: options.reload,
			muzzleSpeed: 90,
			lifetime: 1.2,
			damage: 0, /* set from the difficulty on update */
			muzzle: options.muzzle,
			color: 0xff5544,
		});
	}

	override update(dt: number, world: World): void {
		this.weapon.options.damage = world.difficulty.hunterDamage * this.damageFactor;
		this.think(dt);
		super.update(dt, world);
	}

	private think(dt: number): void {
		this.trigger = false;
		if (!this.target || this.target.dead) { this.chase(nearestAlive(this, this.players)); }

		const player = this.target;
		if (!player) {
			this.engine.speed.target = 0;
			return;
		}

		this.modeTime += dt;
		this.engine.speed.target = this.engine.speed.limit;
		const distance = vec3.distance(this.position, player.position);

		if (this.mode == "evade") {
			this.steerTowards(this.evadeTo);
			if (this.modeTime >= EVADE_TIME) {
				this.setMode("attack");
				this.chase(nearestAlive(this, this.players)); /* whoever is closest now */
			}
			return;
		}

		const angle = this.steerTowards(player.position);
		if (angle > FIRE_CONE || distance < this.closest - GAIN) {
			this.closest = distance;
			this.stalled = 0;
		} else {
			this.stalled += dt;
		}
		const range = (this.stalled >= LONG_SHOT_DELAY ? LONG_FIRE_RANGE : FIRE_RANGE);
		this.trigger = (distance <= range && angle <= FIRE_CONE);

		if (distance < BREAK_DISTANCE) {
			/* fly on past the player, veering off to a random side */
			const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), this.orientation);
			const side = vec3.random(vec3.create(), 30);
			vec3.scaleAndAdd(this.evadeTo, this.position, forward, 60);
			vec3.add(this.evadeTo, this.evadeTo, side);
			this.setMode("evade");
		}
	}

	private chase(target: Ship | null): void {
		this.target = target;
		this.closest = Infinity;
		this.stalled = 0;
	}

	private setMode(mode: Hunter["mode"]): void {
		this.mode = mode;
		this.modeTime = 0;
	}
}
