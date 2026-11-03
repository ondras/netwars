import { quat, vec3 } from "gl-matrix";
import type { Geometry } from "../geometry.ts";
import type { World } from "../world.ts";
import { Grapple } from "./grapple.ts";
import { Missile } from "./missile.ts";
import { Pod } from "./pod.ts";
import { pirateShape } from "./shapes.ts";
import { Ship } from "./ship.ts";
import { nearestAlive, toList } from "./targets.ts";

export interface PirateOptions {
	shape: () => Geometry[];
	shields: number;
	/** Top speed (m/s) */
	speed: number;
	/** m/s² */
	acceleration: number;
	/** rad/s */
	turnRate: number;
	/** Fires homing missiles at the player */
	missiles: boolean;
}

export const PIRATE: PirateOptions = { shape: pirateShape, shields: 50, speed: 10, acceleration: 8, turnRate: 1.5, missiles: true };

/** Gap between bounding spheres at which a pod can be grabbed (m) */
const GRAB_GAP = 1.5;
/** Where a held pod's center is, in the pirate's local frame (m): just below the hull, so the two are hard to hit separately */
const CARGO_OFFSET = vec3.fromValues(0, -1.4, 0.3);
/** Where the grapple leaves the hull, local (m): the underside of the flat hull */
const GRAPPLE_MOUNT = vec3.fromValues(0, -0.03, 0.3);
/** Time to pull a grabbed pod in (s) */
const REEL_TIME = 0.6;
/** Distance from the origin at which a pirate with a pod has escaped (m); beyond the radar range when near the pods */
export const ESCAPE_RADIUS = 150;
/** Distance kept from the player when there is nothing to steal (m) */
const HOLD_DISTANCE = 25;

/** Missiles are only fired at a player this close (m); interval, damage and turn rate depend on the difficulty */
export const MISSILE_RANGE = 80;

const random = ([min, max]: readonly [number, number]) => min + (max - min) * Math.random();

/**
 * Flies to the nearest free pod, carries it away beyond ESCAPE_RADIUS (the pod is then lost)
 * and now and then fires a homing missile at the nearest player.
 */
export class Pirate extends Ship {
	/** Pod being carried away */
	cargo: Pod | null = null;
	grapple: Grapple | null = null;
	/** Got away with a pod (it is then dead, but not destroyed) */
	escaped = false;

	private readonly players: readonly Ship[];
	private readonly missiles: boolean;
	/** Time to the next missile (s); drawn from the difficulty's interval on the first update */
	private missileCooldown: number | null = null;
	private readonly escapeTo = vec3.create();

	/** Reeling in: 0 at grab, 1 when held at CARGO_OFFSET */
	private reel = 0;
	/** Pod position (local) and orientation when grabbed */
	private readonly grabOffset = vec3.create();
	private readonly grabOrientation = quat.create();

	/** @param players Whom it fires at and keeps an eye on: one ship or a list kept up to date by the caller */
	constructor(players: Ship | readonly Ship[], options: PirateOptions = PIRATE) {
		super();
		this.players = toList(players);
		this.missiles = options.missiles;
		this.geometries = options.shape();

		this.shields.value = this.shields.max = options.shields;
		Object.assign(this.engine.speed, { limit: options.speed, changeRate: options.acceleration });
		this.engine.yaw.changeRate = this.engine.pitch.changeRate = options.turnRate;
	}

	override update(dt: number, world: World): void {
		this.think(dt, world);
		super.update(dt, world);
		this.holdCargo(dt);

		if (this.cargo && vec3.length(this.position) >= ESCAPE_RADIUS) { /* got away: all disappear */
			this.escaped = true;
			this.dead = true;
			this.cargo.dead = true;
			if (this.grapple) { this.grapple.dead = true; }
		}
	}

	private think(dt: number, world: World): void {
		if (this.cargo?.dead) { /* shot while held */
			this.cargo = null;
			this.grapple = null; /* removes itself */
		}

		if (this.cargo) {
			this.steerTowards(this.escapeTo);
			this.engine.speed.target = this.engine.speed.limit;
		} else {
			const pod = this.nearestFreePod(world.scene);
			const player = nearestAlive(this, this.players);
			if (pod) {
				this.approach(pod, world);
			} else if (player) {
				this.steerTowards(player.position);
				const distance = vec3.distance(this.position, player.position);
				this.engine.speed.target = (distance > HOLD_DISTANCE ? this.engine.speed.limit : 0);
			} else {
				this.engine.speed.target = 0;
			}
		}

		this.fireMissiles(dt, world);
	}

	private nearestFreePod(scene: World["scene"]): Pod | null {
		let best: Pod | null = null;
		let bestDistance = Infinity;

		for (const entity of scene) {
			if (!(entity instanceof Pod) || entity.dead || entity.carrier) { continue; }
			const distance = vec3.squaredDistance(this.position, entity.position);
			if (distance < bestDistance) {
				best = entity;
				bestDistance = distance;
			}
		}

		return best;
	}

	/** Slow down when close so that the turning circle is small enough to reach the pod */
	private approach(pod: Pod, world: World): void {
		this.steerTowards(pod.position);

		const gap = vec3.distance(this.position, pod.position) - this.radius - pod.radius;
		this.engine.speed.target = Math.max(2, Math.min(this.engine.speed.limit, gap));

		if (gap <= GRAB_GAP && this.radius && pod.radius) { this.grab(pod, world); }
	}

	private grab(pod: Pod, world: World): void {
		this.cargo = pod;
		pod.carrier = this;

		/* reel in from where the pod is now */
		this.reel = 0;
		vec3.subtract(this.grabOffset, pod.position, this.position);
		vec3.transformQuat(this.grabOffset, this.grabOffset, quat.conjugate(quat.create(), this.orientation));
		quat.copy(this.grabOrientation, pod.orientation);

		this.grapple = new Grapple(this, pod);
		world.spawn(this.grapple);
		world.sound("grabbed"); /* an alert, as loud wherever it happens */

		/* flee outwards, horizontally away from the center (or straight ahead when at the center) */
		vec3.set(this.escapeTo, this.position[0], 0, this.position[2]);
		if (vec3.length(this.escapeTo) < 1) { vec3.transformQuat(this.escapeTo, vec3.fromValues(0, 0, -1), this.orientation); }
		vec3.normalize(this.escapeTo, this.escapeTo);
		vec3.scale(this.escapeTo, this.escapeTo, 2 * ESCAPE_RADIUS); /* beyond the radius, so it never arrives and stops */
	}

	/** Move the held pod (reeling it in at first) and the grapple along with the hull */
	private holdCargo(dt: number): void {
		const pod = this.cargo;
		if (!pod) { return; }

		this.reel = Math.min(1, this.reel + dt / REEL_TIME);
		const t = this.reel * this.reel * (3 - 2 * this.reel); /* smoothstep */

		const local = vec3.lerp(vec3.create(), this.grabOffset, CARGO_OFFSET, t);
		vec3.add(pod.position, this.position, vec3.transformQuat(local, local, this.orientation));
		quat.slerp(pod.orientation, this.grabOrientation, this.orientation, t);
		vec3.copy(pod.velocity, this.velocity); /* inherited by debris if it explodes */

		const mount = vec3.transformQuat(vec3.create(), GRAPPLE_MOUNT, this.orientation);
		this.grapple?.stretch(vec3.add(mount, mount, this.position), pod.position);
	}

	private fireMissiles(dt: number, world: World): void {
		if (!this.missiles) { return; }
		const { missileDamage, missileTurnRate, missileInterval } = world.difficulty;
		this.missileCooldown = Math.max(0, (this.missileCooldown ?? random(missileInterval)) - dt);
		if (this.missileCooldown > 0) { return; }

		const player = nearestAlive(this, this.players);
		if (!player || vec3.distance(this.position, player.position) > MISSILE_RANGE) { return; }

		/* launched towards the player, from just outside the hull */
		const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), player.position, this.position));
		const position = vec3.scaleAndAdd(vec3.create(), this.position, direction, this.radius + 0.5);
		world.spawn(new Missile(position, direction, this, player, { damage: missileDamage, turnRate: missileTurnRate }));
		world.sound("launch", position);
		world.sound("warning", undefined, player); /* only its target is warned */

		this.missileCooldown = random(missileInterval);
	}
}
