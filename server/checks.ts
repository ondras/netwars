/*
 * What the server checks of the reports browsers send: enough to stop someone with the browser's developer tools
 * from teleporting, out-flying the physics, firing faster than the gun or scoring hits they never made.
 *
 * Reports that fail are not punished, only not believed: a bad connection can look just like cheating.
 * Aiming is out of reach: a script's steering looks the same as a person's.
 */
import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import { segmentHitsSphere } from "../src/collision.ts";
import { TUMBLE_SPIN, type Ship } from "../src/entity/ship.ts";
import { SHOT_RADIUS } from "../src/entity/shot.ts";
import { angleOffNose, LOCK_RANGE } from "../src/lock.ts";
import type { EntityRecord, Quat, ShotReport, Vec3 } from "../src/net/protocol.ts";
import { carriedVelocity, Weapon } from "../src/weapon.ts";
import type { World } from "../src/world.ts";

/** What players' guns do: the standard gun */
export const PLAYER_GUN = new Weapon().options;

/** Honest browsers stay within the physics; this much more is allowed, for clocks and rounding */
const MARGIN = 1.1;
/** Unused allowance adds up to this many seconds' worth at most, for reports that arrive late and all at once */
const BANK = 1;

/** How far a shot or rocket may start from the ship as last reported: the muzzle, and the flying since (m) */
const MUZZLE_REACH = 6;
/** How far a shot may point off the nose as last reported: the turning since (rad) */
const AIM_CONE = 0.3;
/** How much a shot's speed may differ from the gun's, relative to the ship's forward motion as last reported (m/s) */
const MUZZLE_SPEED_SLACK = 8;
/** A rocket's target must be roughly ahead (rad); it can have moved since the pilot locked on, and more so up close */
const ROCKET_CONE = Math.PI / 3;
/** A rocket's target may have moved this much further away since the pilot locked on */
const ROCKET_RANGE = LOCK_RANGE * 1.25;

/**
 * Hits are checked against what the shooter's screen showed, at most this long ago (s). A shooter's delay up to this
 * (the interpolation included) costs them nothing; a target can be hit this long after it dodged on its own screen.
 */
export const REWIND_LIMIT = 0.5;
/** How far a hit may be off the path of the shot, beyond touching (m): the target can be a snapshot late on that screen */
const HIT_SLACK = 0.5;
/** How far a hit may be off along the path of the shot, in time (s): screen clocks are estimates. Shot and target stay on course. */
const FLIGHT_SLACK = 0.06;

const axisOf = (ship: Ship) => vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);

/** The most a ship's reports can honestly ask of it, per second */
function rates(ship: Ship): { travel: number; turn: number; shots: number } {
	const { yaw, pitch } = ship.engine;
	return {
		travel: ship.topSpeed * MARGIN,
		turn: (Math.hypot(yaw.changeRate, pitch.changeRate) + TUMBLE_SPIN) * MARGIN,
		shots: 1 / PLAYER_GUN.reload * MARGIN,
	};
}

/**
 * What a pilot may still do, and where their browser last said their ship was. It fills up as real time passes
 * (the idea of Quake 2's time budget for client commands): reports arriving late and bunched up are fine, more than
 * the physics allows over time is not.
 */
export class Allowance {
	private travel = 0;
	private turn = 0;
	private shots = 0;
	/** Off while the connection is down: however far the browser flies meanwhile, it can only be that far */
	private capped = true;
	private readonly position = vec3.create();
	private readonly orientation = quat.create();

	constructor(ship: Ship) {
		this.restart(ship);
	}

	/** A ship starts flying: from where it is, with everything allowed that can be */
	restart(ship: Ship): void {
		vec3.copy(this.position, ship.position);
		quat.copy(this.orientation, ship.orientation);
		const { travel, turn, shots } = rates(ship);
		this.travel = travel * BANK;
		this.turn = turn * BANK;
		this.shots = shots * BANK;
		this.capped = true;
	}

	/** Real time passing (s) */
	refill(seconds: number, ship: Ship): void {
		const { travel, turn, shots } = rates(ship);
		const filled = (value: number, rate: number) => {
			const more = value + rate * seconds;
			return (this.capped ? Math.min(rate * BANK, more) : more);
		};
		this.travel = filled(this.travel, travel);
		this.turn = filled(this.turn, turn);
		this.shots = filled(this.shots, shots);
	}

	/** The connection dropped */
	release(): void {
		this.capped = false;
	}

	/**
	 * The ship goes where its browser says, as far as allowed: a ship past its limit just follows at top speed,
	 * and an honest browser that got ahead for a moment is caught up with
	 * @returns Whether it got all the way
	 */
	fly(ship: Ship, p: Vec3, q: Quat): boolean {
		const gap = vec3.distance(this.position, p);
		const moved = Math.min(gap, this.travel);
		vec3.lerp(this.position, this.position, p, gap > 0 ? moved / gap : 0);
		this.travel -= moved;

		const wanted = quat.normalize(quat.create(), q);
		const angle = 2 * Math.acos(Math.min(1, Math.abs(quat.dot(this.orientation, wanted))));
		const turned = Math.min(angle, this.turn);
		quat.slerp(this.orientation, this.orientation, wanted, angle > 0 ? turned / angle : 0);
		quat.normalize(this.orientation, this.orientation);
		this.turn -= turned;

		vec3.copy(ship.position, this.position);
		quat.copy(ship.orientation, this.orientation);
		if (!this.capped) { /* back: the time away is used up */
			this.capped = true;
			this.refill(0, ship);
		}
		return moved == gap && turned == angle;
	}

	/** @returns Whether the gun can have fired once more by now */
	takeShot(): boolean {
		if (this.shots < 1) { return false; }
		this.shots--;
		return true;
	}
}

/** Could this shot have come from this ship's gun? */
export function shotFits(ship: Ship, { p, v }: ShotReport): boolean {
	if (vec3.distance(ship.position, p) > MUZZLE_REACH) { return false; }

	const relative = vec3.subtract(vec3.create(), v, carriedVelocity(ship));
	const speed = vec3.length(relative);
	if (Math.abs(speed - PLAYER_GUN.muzzleSpeed) > MUZZLE_SPEED_SLACK) { return false; }
	return vec3.dot(relative, axisOf(ship)) / speed >= Math.cos(AIM_CONE);
}

/** Could this ship have locked on to a target there? */
export function rocketFits(ship: Ship, p: Vec3, target: ReadonlyVec3): boolean {
	return (vec3.distance(ship.position, p) <= MUZZLE_REACH
		&& vec3.distance(ship.position, target) <= ROCKET_RANGE
		&& angleOffNose(ship, target as vec3) <= ROCKET_CONE);
}

/** A shot the server has seen fired, waiting to hit something */
export interface FiredShot {
	/** The server time the pilot's screen was showing when it was fired */
	readonly t: number;
	readonly p: Vec3;
	readonly v: Vec3;
	/** Shield points it takes: decided here, by what powerups the server saw the ship collect */
	readonly damage: number;
}

/**
 * Did the shot's path touch a target at the time given, in the shooter's view of things?
 * @param at Where the target was then
 */
export function hitFits(shot: FiredShot, t: number, at: ReadonlyVec3, radius: number, world: Pick<World, "nearest">): boolean {
	const flown = t - shot.t;
	if (flown < -FLIGHT_SLACK || flown > PLAYER_GUN.lifetime + FLIGHT_SLACK) { return false; }

	const along = (time: number) => vec3.scaleAndAdd(vec3.create(), shot.p, shot.v, time);
	const from = along(Math.max(0, flown - FLIGHT_SLACK));
	const to = along(flown + FLIGHT_SLACK);
	return segmentHitsSphere(from, to, world.nearest(at, to), radius + SHOT_RADIUS + HIT_SLACK);
}

/** Where entities were in the snapshots of the last REWIND_LIMIT: what browsers were showing, moments later */
export class ViewHistory {
	private readonly frames: Array<{ t: number; byId: Map<number, EntityRecord> }> = [];

	add(t: number, records: readonly EntityRecord[]): void {
		this.frames.push({ t, byId: new Map(records.map(record => [record[0], record])) });
		/* the frame just before the limit stays: times after it lie between it and the next */
		while (this.frames.length > 1 && this.frames[1].t < t - REWIND_LIMIT) { this.frames.shift(); }
	}

	/** Where an entity was shown at the given time, between two snapshots the way browsers do it; null if it was not */
	positionAt(id: number, t: number): vec3 | null {
		const { frames } = this;
		let i = frames.length - 1;
		while (i >= 0 && frames[i].t > t) { i--; }

		const from = frames[i]?.byId.get(id);
		const after = frames[i + 1];
		const to = after?.byId.get(id);
		const place = ([, , x, y, z]: EntityRecord) => vec3.fromValues(x, y, z);

		if (from && to) { return vec3.lerp(vec3.create(), place(from), place(to), (t - frames[i].t) / (after.t - frames[i].t)); }
		return (from ?? to ? place((from ?? to)!) : null);
	}
}
