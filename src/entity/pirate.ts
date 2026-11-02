import { quat, vec3 } from "gl-matrix";
import type { World } from "../world.ts";
import { Grapple } from "./grapple.ts";
import { Missile } from "./missile.ts";
import { Pod } from "./pod.ts";
import { Ship } from "./ship.ts";

const MODEL = "internal/drone1";

/** Gap between bounding spheres at which a pod can be grabbed (m) */
const GRAB_GAP = 1.5;
/** Where a held pod's center is, in the pirate's local frame (m): just below the hull, so the two are hard to hit separately */
const CARGO_OFFSET = vec3.fromValues(0, -1.4, 0.3);
/** Where the grapple leaves the hull, local (m) */
const GRAPPLE_MOUNT = vec3.fromValues(0, -0.3, 0.3);
/** Time to pull a grabbed pod in (s) */
const REEL_TIME = 0.6;
/** Distance from the origin at which a pirate with a pod has escaped (m) */
export const ESCAPE_RADIUS = 100;
/** Distance kept from the player when there is nothing to steal (m) */
const HOLD_DISTANCE = 25;

/** Time between missiles, random within the range (s) */
const MISSILE_INTERVAL: readonly [number, number] = [4, 8];
/** Missiles are only fired at a player this close (m) */
const MISSILE_RANGE = 80;

const random = ([min, max]: readonly [number, number]) => min + (max - min) * Math.random();

/**
 * Flies to the nearest free pod, carries it away beyond ESCAPE_RADIUS (the pod is then lost)
 * and now and then fires a homing missile at the player.
 */
export class Pirate extends Ship {
	/** Pod being carried away */
	cargo: Pod | null = null;
	grapple: Grapple | null = null;

	private readonly player: Ship;
	private missileCooldown = random(MISSILE_INTERVAL);
	private readonly escapeTo = vec3.create();

	/** Reeling in: 0 at grab, 1 when held at CARGO_OFFSET */
	private reel = 0;
	/** Pod position (local) and orientation when grabbed */
	private readonly grabOffset = vec3.create();
	private readonly grabOrientation = quat.create();

	constructor(player: Ship) {
		super();
		this.player = player;
		this.fromNSH(MODEL);

		this.shields.value = this.shields.max = 50;
		Object.assign(this.engine.speed, { limit: 10, changeRate: 8 });
		this.engine.yaw.changeRate = this.engine.pitch.changeRate = 1.5;
	}

	override update(dt: number, world: World): void {
		this.think(dt, world);
		super.update(dt, world);
		this.holdCargo(dt);

		if (this.cargo && vec3.length(this.position) >= ESCAPE_RADIUS) { /* got away: all disappear */
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
			if (pod) {
				this.approach(pod, world);
			} else if (!this.player.dead) {
				this.steerTowards(this.player.position);
				const distance = vec3.distance(this.position, this.player.position);
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
		this.missileCooldown = Math.max(0, this.missileCooldown - dt);
		if (this.missileCooldown > 0 || this.player.dead) { return; }
		if (vec3.distance(this.position, this.player.position) > MISSILE_RANGE) { return; }

		/* launched towards the player, from just outside the hull */
		const direction = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), this.player.position, this.position));
		const position = vec3.scaleAndAdd(vec3.create(), this.position, direction, this.radius + 0.5);
		world.spawn(new Missile(position, direction, this, this.player));

		this.missileCooldown = random(MISSILE_INTERVAL);
	}
}
