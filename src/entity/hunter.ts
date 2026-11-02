import { vec3 } from "gl-matrix";
import { difficulty } from "../difficulty.ts";
import { Weapon } from "../weapon.ts";
import type { World } from "../world.ts";
import { Ship } from "./ship.ts";

const MODEL = "internal/fighter1";

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

	constructor(player: Ship) {
		super();
		this.player = player;
		this.fromNSH(MODEL);

		this.shields.value = this.shields.max = 75;
		Object.assign(this.engine.speed, { limit: 13, changeRate: 10 });
		this.engine.yaw.changeRate = this.engine.pitch.changeRate = 2.2;

		this.shotTarget = player; /* its shots cannot hit pods or other enemies */
		this.weapon = new Weapon({
			reload: 0.35,
			muzzleSpeed: 90,
			lifetime: 1.2,
			damage: difficulty().hunterDamage,
			muzzle: [0, 0, -1.5],
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
