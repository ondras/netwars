import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { Ship } from "./entity/ship.ts";
import { angleOffNose } from "./lock.ts";
import type { Pilot } from "./pilot.ts";
import { Weapon } from "./weapon.ts";
import type { World } from "./world.ts";

/**
 * How a bot flies and shoots. It has only what a person has: the same stick, throttle and trigger,
 * and it sees things late and imperfectly. Aiming and flying are separate, so that a bot can be good at one and poor at the other.
 */
export interface BotTraits {
	/* Aiming */
	/** How old what it sees is (s) */
	readonly reaction: number;
	/** How far its aim wanders off what it means to aim at, at most (rad) */
	readonly wobble: number;
	/** How much of the lead a moving target needs it allows for, 0..1 */
	readonly lead: number;
	/** Pulls the trigger with its aim this close to where it wants it (rad) */
	readonly fireCone: number;
	/** Fires at targets this close (m); the gun reaches 180 m */
	readonly fireRange: number;

	/* Flying */
	/** How fast it moves the stick from one side to the middle (full deflections per second) */
	readonly stickRate: number;
	/** Stick deflection per radian it wants to turn */
	readonly steerGain: number;
	/** How fast it changes the speed it asks for (m/s per second); a held W or S does 12.5 */
	readonly throttleRate: number;
	/** Speed it flies at, as a share of top speed */
	readonly cruise: number;
	/** Veers off rather than fly into a target this close (m) */
	readonly standoff: number;
	/** How readily it turns out of the way of a ship whose nose is on it, 0..1: a ship moves where it points, so this costs it its own aim */
	readonly evasion: number;
	/** How well it uses its speed, 0..1: holds a steady range behind a target, slows down to turn tighter */
	readonly positioning: number;
}

const mix = (poor: number, good: number, skill: number) => poor + (good - poor) * skill;

/** @param aim How well it aims, 0..1 @param flying How well it flies, 0..1 */
export function botTraits(aim = 0.5, flying = 0.5): BotTraits {
	return {
		reaction: mix(0.45, 0.15, aim),
		wobble: mix(0.06, 0.015, aim),
		lead: mix(0.45, 0.95, aim),
		fireCone: mix(0.12, 0.03, aim),
		fireRange: mix(70, 120, aim),

		stickRate: mix(2, 8, flying),
		steerGain: mix(2.5, 5, flying),
		throttleRate: mix(6, 12.5, flying),
		cruise: mix(0.8, 1, flying),
		standoff: mix(10, 15, flying),
		evasion: mix(0, 0.8, flying),
		positioning: flying,
	};
}

/** How long it flies on after veering off (s) */
const BREAK_TIME = 2;
/** How long it turns away from a ship with its nose on it (s) */
const EVADE_TIME = 1.2;
/** How often it decides whether to; and for how long after turning away it does not (s) */
const EVADE_CHECK = 0.25;
const EVADE_REST = 1.5;
/** A ship's nose this close to it (rad), from this close (m), makes it want to get out of the way */
const THREAT_CONE = 0.25;
const THREAT_RANGE = 110;
/** A target whose nose is this far off it is flying away from it (rad) */
const FLEEING_ANGLE = 2;
/** The range it likes behind a target (m), and how much speed it gives for being off that (m/s per m) */
const CHASE_RANGE = 45;
const CHASE_GAIN = 0.5;
const CHASE_REACH = 100;
/** Slows down to this share of top speed to turn hard, with a target this far off its nose (rad) and this close (m) */
const TURN_SPEED = 0.4;
const TURN_ANGLE = 1;
const TURN_RANGE = 60;
/** How often it looks again for whom to fight (s) */
const RETARGET_TIME = 1.5;
/** Muzzle speed of the gun it has, the same as anyone's */
const SHOT_SPEED = new Weapon().options.muzzleSpeed;

interface Seen {
	readonly time: number;
	readonly position: vec3;
	readonly velocity: vec3;
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Flies a ship like a person might: picks a fight with the nearest other ship, keeps at it, veers off rather than ram, and gets out of the way of guns */
export class BotPilot implements Pilot {
	private readonly traits: BotTraits;
	private readonly random: () => number;
	private time = 0;
	private target: Ship | null = null;
	private sinceLook = Infinity;
	/** What it saw of the target, oldest first; it acts on the entry `reaction` old */
	private readonly seen: Seen[] = [];
	private breakLeft = 0;
	private readonly breakTo = vec3.create();
	private sinceEvadeCheck = 0;
	private evadeRest = 0;
	private throttleSteps = 0;
	/** Phases of its aim's wandering */
	private readonly phases: readonly number[];

	constructor(traits: BotTraits, random: () => number = Math.random) {
		this.traits = traits;
		this.random = random;
		this.phases = [0, 1, 2, 3].map(() => random() * 2 * Math.PI);
	}

	/** Flying a new ship: nothing left of the last flight */
	reset(): void {
		this.target = null;
		this.sinceLook = Infinity;
		this.seen.length = 0;
		this.breakLeft = this.evadeRest = this.throttleSteps = 0;
	}

	update(dt: number, ship: Ship, world: World): void {
		this.time += dt;
		this.pickTarget(dt, ship, world);

		ship.trigger = false;
		this.breakLeft = Math.max(0, this.breakLeft - dt);
		this.evadeRest = Math.max(0, this.evadeRest - dt);

		if (!this.target) {
			this.setSpeed(dt, ship, 0);
			this.steer(dt, ship, 0, 0);
			return;
		}

		this.look();
		const seen = this.seen[0];
		const { target } = this;
		const at = world.nearest(target.position, ship.position);
		const distance = vec3.distance(ship.position, at);
		const offItsNose = angleOffNose(target, vec3.clone(world.nearest(ship.position, target.position)));
		this.setSpeed(dt, ship, this.wantedSpeed(ship, target, distance, angleOffNose(ship, vec3.clone(at)), offItsNose));
		this.considerEvading(dt, ship, at, distance, offItsNose);

		if (this.breakLeft > 0) {
			const [yaw, pitch] = this.errors(ship, this.breakTo);
			this.steer(dt, ship, yaw, pitch);
			return;
		}

		if (distance < this.traits.standoff) {
			this.veerOff(ship);
			return;
		}

		const aim = this.aimPoint(ship, seen, world);
		const wander = this.wander();
		const [yaw, pitch] = this.errors(ship, aim);
		const [wantYaw, wantPitch] = [yaw + wander[0], pitch + wander[1]];
		this.steer(dt, ship, wantYaw, wantPitch);

		ship.trigger = (distance <= this.traits.fireRange && Math.hypot(wantYaw, wantPitch) <= this.traits.fireCone);
	}

	/** The speed it wants: its usual one, unless it knows how to use speed to hold a tail or turn tighter */
	private wantedSpeed(ship: Ship, target: Ship, distance: number, offMyNose: number, offItsNose: number): number {
		const top = ship.topSpeed;
		const cruise = this.traits.cruise * top;
		if (this.breakLeft > 0) { return cruise; }

		let best = cruise;
		if (offItsNose > FLEEING_ANGLE && offMyNose < TURN_ANGLE && distance < CHASE_REACH) {
			best = Math.max(0, Math.min(top, vec3.length(target.velocity) + (distance - CHASE_RANGE) * CHASE_GAIN));
		} else if (offMyNose > TURN_ANGLE && distance < TURN_RANGE) {
			best = TURN_SPEED * top;
		}
		return mix(cruise, best, this.traits.positioning);
	}

	/** Like a person on the keys: the speed asked for goes up and down in steps of one, as fast as its hand does that */
	private setSpeed(dt: number, ship: Ship, wanted: number): void {
		const { speed } = ship.engine;
		const goal = Math.round(wanted);
		if (speed.target == goal) {
			this.throttleSteps = 0;
			return;
		}
		this.throttleSteps += this.traits.throttleRate * dt;
		const steps = Math.floor(this.throttleSteps);
		if (!steps) { return; }
		this.throttleSteps -= steps;
		speed.target += Math.sign(goal - speed.target) * Math.min(steps, Math.abs(goal - speed.target));
	}

	/** With a ship's nose on it, it may turn to fly across that ship's guns, the shorter way round */
	private considerEvading(dt: number, ship: Ship, at: ReadonlyVec3, distance: number, offItsNose: number): void {
		this.sinceEvadeCheck += dt;
		if (this.sinceEvadeCheck < EVADE_CHECK) { return; }
		this.sinceEvadeCheck = 0;
		if (this.breakLeft > 0 || this.evadeRest > 0 || distance > THREAT_RANGE || offItsNose > THREAT_CONE || this.random() >= this.traits.evasion) { return; }

		const toward = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), at, ship.position));
		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const across = vec3.scaleAndAdd(vec3.create(), nose, toward, -vec3.dot(nose, toward));
		if (vec3.length(across) < 0.05) { vec3.cross(across, toward, vec3.random(vec3.create())); } /* head on: either side will do */
		vec3.normalize(across, across);
		vec3.scaleAndAdd(this.breakTo, ship.position, across, 80);
		this.breakLeft = EVADE_TIME;
		this.evadeRest = EVADE_TIME + EVADE_REST;
	}

	/** The nearest other ship; it looks again from time to time, not all the time */
	private pickTarget(dt: number, ship: Ship, world: World): void {
		this.sinceLook += dt;
		if (this.target && !this.target.dead && this.sinceLook < RETARGET_TIME) { return; }
		this.sinceLook = 0;

		let nearest: Ship | null = null;
		let best = Infinity;
		for (const other of world.players) {
			if (other == ship || other.dead) { continue; }
			const distance = vec3.distance(ship.position, world.nearest(other.position, ship.position));
			if (distance < best) {
				best = distance;
				nearest = other;
			}
		}
		if (nearest != this.target) { this.seen.length = 0; }
		this.target = nearest;
	}

	private look(): void {
		const { target, seen } = this;
		seen.push({ time: this.time, position: vec3.clone(target!.position), velocity: vec3.clone(target!.velocity) });
		while (seen.length > 1 && seen[1].time <= this.time - this.traits.reaction) { seen.shift(); }
	}

	/** Where it wants its nose: where the target is by now, as far as it can tell, and ahead of that by as much as the shot takes to get there */
	private aimPoint(ship: Ship, seen: Seen, world: World): vec3 {
		const { lead } = this.traits;
		const late = this.time - seen.time;
		const at = vec3.clone(world.nearest(seen.position, ship.position));
		const flight = vec3.distance(ship.position, at) / SHOT_SPEED;
		/* the shot leaves with the ship's own velocity, so for the flight only the difference counts */
		vec3.scaleAndAdd(at, at, seen.velocity, (late + flight) * lead);
		vec3.scaleAndAdd(at, at, ship.velocity, -flight * lead);
		return at;
	}

	/** Slow, irregular: two waves on each axis */
	private wander(): [number, number] {
		const { time, phases, traits: { wobble } } = this;
		return [
			wobble * (Math.sin(1.7 * time + phases[0]) + Math.sin(3.1 * time + phases[1])) / 2,
			wobble * (Math.sin(1.3 * time + phases[2]) + Math.sin(2.7 * time + phases[3])) / 2,
		];
	}

	/** How much to turn to face a point (rad): positive yaw turns left, positive pitch raises the nose */
	private errors(ship: Ship, point: ReadonlyVec3): [number, number] {
		const local = vec3.subtract(vec3.create(), point, ship.position);
		vec3.transformQuat(local, local, quat.conjugate(quat.create(), ship.orientation));
		return [Math.atan2(-local[0], -local[2]), Math.atan2(local[1], Math.hypot(local[0], local[2]))];
	}

	/** Moves the stick towards what it wants, as fast as a hand can */
	private steer(dt: number, ship: Ship, wantYaw: number, wantPitch: number): void {
		const { steerGain, stickRate } = this.traits;
		const yaw = clamp(wantYaw * steerGain);
		const pitch = clamp(wantPitch * steerGain);

		const reach = stickRate * dt;
		const { engine } = ship;
		engine.yaw.control += Math.max(-reach, Math.min(reach, yaw - engine.yaw.control));
		engine.pitch.control += Math.max(-reach, Math.min(reach, pitch - engine.pitch.control));
	}

	/** Flies on past the target, off to a random side */
	private veerOff(ship: Ship): void {
		const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const angle = this.random() * 2 * Math.PI;
		const side = vec3.transformQuat(vec3.create(), vec3.fromValues(30 * Math.cos(angle), 30 * Math.sin(angle), 0), ship.orientation);
		vec3.scaleAndAdd(this.breakTo, ship.position, forward, 60);
		vec3.add(this.breakTo, this.breakTo, side);
		this.breakLeft = BREAK_TIME;
	}
}
