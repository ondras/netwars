import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";
import { Pirate } from "./entity/pirate.ts";
import { PlayerShip } from "./entity/player-ship.ts";
import { Pod } from "./entity/pod.ts";
import { Powerup } from "./entity/powerup.ts";
import { ROCKET_CAPACITY, Ship } from "./entity/ship.ts";
import { angleOffNose, TargetLock } from "./lock.ts";
import type { Pilot } from "./pilot.ts";
import { RADAR_REACH, senseFade, SIGHT_REACH } from "./senses.ts";
import { Weapon } from "./weapon.ts";
import type { World } from "./world.ts";

/**
 * How a bot flies and shoots. It has only what a person has: the same stick, throttle, trigger and rocket lock,
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
	/** How long it holds the trigger once pulled, on average (s); it keeps firing while its aim drifts off */
	readonly burst: number;
	/** How long after a rocket lock it launches (s) */
	readonly rocketDelay: number;

	/* Flying */
	/** How fast it moves the stick from one side to the middle (full deflections per second) */
	readonly stickRate: number;
	/** Stick deflection per radian it wants to turn */
	readonly steerGain: number;
	/** The farthest it pushes the stick, 0..1 */
	readonly maxStick: number;
	/** How fast it changes the speed it asks for (m/s per second); a held W or S does 12.5 */
	readonly throttleRate: number;
	/** Speed it flies at, as a share of top speed */
	readonly cruise: number;
	/** Veers off rather than fly into a target this close (m) */
	readonly standoff: number;
	/** How close another ship has to be for it to leave what it is doing and fight (m) */
	readonly engageRange: number;
	/** How readily it turns out of the way of a ship on its tail, 0..1 */
	readonly evasion: number;
	/** How well it uses its speed, 0..1: holds a steady range behind a target, slows down to turn tighter */
	readonly positioning: number;
}

const mix = (from: number, to: number, share: number) => from + (to - from) * share;
/** Skill 0 is poor, 0.5 is the person in the recordings this bot was tuned from, 1 is better than that person */
const scale = (poor: number, person: number, good: number, skill: number) =>
	(skill < 0.5 ? mix(poor, person, 2 * skill) : mix(person, good, 2 * skill - 1));

/** @param aim How well it aims, 0..1 @param flying How well it flies, 0..1 */
export function botTraits(aim = 0.5, flying = 0.5): BotTraits {
	return {
		reaction: scale(0.45, 0.3, 0.15, aim),
		wobble: scale(0.2, 0.05, 0.01, aim),
		lead: scale(0.4, 0.7, 1, aim),
		fireCone: scale(0.25, 0.15, 0.05, aim),
		fireRange: scale(100, 180, 180, aim),
		burst: scale(2, 2, 1, aim),
		rocketDelay: scale(1.5, 0.4, 0.15, aim),

		stickRate: scale(2.5, 4, 8, flying),
		steerGain: scale(1, 1.5, 4, flying),
		maxStick: scale(0.7, 0.9, 1, flying),
		throttleRate: scale(6, 9, 12.5, flying),
		cruise: scale(0.75, 1, 1, flying),
		standoff: scale(6, 10, 14, flying),
		engageRange: scale(100, 170, 200, flying),
		evasion: scale(0, 0, 0.8, flying),
		positioning: scale(0, 0, 1, flying),
	};
}

/** How long it flies on after veering off (s) */
const BREAK_TIME = 0.8;
/** Closing on a target at least this fast is what it veers off from (m/s) */
const RAM_SPEED = 3;
/** Once fighting, a ship has to be this much farther than engageRange for it to go back to what it was doing */
const DISENGAGE_FACTOR = 1.2;
/** How long it turns away from a ship with its nose on it (s) */
const EVADE_TIME = 1.2;
/** How often it decides whether to; and for how long after turning away it does not (s) */
const EVADE_CHECK = 0.25;
const EVADE_REST = 1.5;
/** A ship's nose this close to it (rad), from this close (m), makes it want to get out of the way */
const THREAT_CONE = 0.25;
const THREAT_RANGE = 110;
/** It only does with that ship this far off its own nose (rad): closer than that, it can shoot back, and a ship moves where it points */
const CANNOT_REPLY_ANGLE = 1;
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
/** Slows down the same way for a powerup this far off its nose (rad) and this close (m), not to circle it for ever */
const COLLECT_ANGLE = 0.8;
const COLLECT_RANGE = 15;
/** How often it gets a chance to notice a ship fading in and out of sight (s) */
const NOTICE_TIME = 0.25;

/** How sharply the chance of noticing a ship rises as it comes out of the fade: 3 gives 2% 5 m into it, 13% halfway, 42% 15 m in */
const NOTICE_STEEPNESS = 3;

/**
 * The chance of noticing a ship this far away (m) at a glance: certain in full view, never out of sight,
 * and slim until well into the fade, where a person sees no more than a few dim pixels
 */
export const noticeChance = (distance: number): number => senseFade(distance, SIGHT_REACH) ** NOTICE_STEEPNESS;

/** How often it looks again for whom to fight and what to collect (s); it knows of what its radar shows, within RADAR_REACH */
const RETARGET_TIME = 1.5;
/** How long it keeps going where a ship it was after got off its radar, the way it was heading (s) */
const PURSUIT_TIME = 5;
/** With nothing on its radar: how long it keeps to one heading (s), and how far ahead it means to go (m) */
const SEARCH_TIME = 10;
const SEARCH_AHEAD = 300;
/**
 * Co-op: it goes after what threatens the pods first. A pod thief counts as this share of how far it is,
 * one carrying a pod off as the second.
 */
const THIEF_WEIGHT = 0.6;
const CARRIER_WEIGHT = 0.3;
/** Co-op: an enemy a teammate is closer to counts as this many times as far: the teammate will see to it */
const TEAMMATE_WEIGHT = 2.5;
/** Co-op, with no enemy about: it heads for points this far around the middle of the pods (m), a new one this often (s) */
const PATROL_RADIUS = 40;
const PATROL_TIME = 8;
/** It starts firing somewhere between this share of fireRange and all of it, differently every fight */
const FIRE_NEAREST = 0.7;
/** The shortest a burst lasts, and the pause before the next (s) */
const BURST_MIN = 0.3;
const BURST_REST = 0.4;
/** How long after a launch it waits to see what the rocket does (s) */
const ROCKET_REST = 2;
/** The stick stays where it is unless it should be this much elsewhere: a hand rests */
const HAND_REST = 0.004;
/** Muzzle speed of the gun it has, the same as anyone's, and how far its shots go (m) */
const SHOT_SPEED = new Weapon().options.muzzleSpeed;
const GUN_REACH = SHOT_SPEED * new Weapon().options.lifetime;
/** Co-op: it does not fire with a pod this close to its line of fire (m, besides the pod's size), ahead within the gun's reach */
export const POD_CLEARANCE = 3;

interface Seen {
	readonly time: number;
	readonly position: vec3;
	readonly velocity: vec3;
}

const clamp = (value: number, limit = 1) => Math.max(-limit, Math.min(limit, value));

/** Whether a powerup would do this ship any good right now */
function wants({ kind }: Powerup, ship: Ship): boolean {
	switch (kind) {
		case "shields": return ship.shields.value < ship.shields.max;
		case "rockets": return ship.rockets < ROCKET_CAPACITY;
		default: return true;
	}
}

export interface BotOptions {
	/** Fights the enemies alongside the players, rather than the players */
	readonly coop?: boolean;
	readonly random?: () => number;
}

/**
 * Flies a ship like a person might: collects powerups until another ship comes close, then fights it,
 * nose on it and gun blazing, with rockets when it gets a lock, and veers off only rather than ram it.
 * In a deathmatch it knows only what its radar shows; with nothing there, it goes looking.
 * In co-op it knows of every enemy, as the radar shows them all, goes after pod thieves first and otherwise keeps near the pods.
 */
export class BotPilot implements Pilot {
	private readonly traits: BotTraits;
	private readonly coop: boolean;
	private readonly random: () => number;
	private time = 0;
	private target: Ship | null = null;
	private powerup: Powerup | null = null;
	private sinceLook = Infinity;
	private engaged = false;
	/** What it saw of the target, oldest first; it acts on the entry `reaction` old */
	private readonly seen: Seen[] = [];
	private breakLeft = 0;
	private readonly breakTo = vec3.create();
	private sinceEvadeCheck = 0;
	private evadeRest = 0;
	private throttleSteps = 0;
	private burstLeft = 0;
	private burstRest = 0;
	private lockedFor = 0;
	private rocketRest = 0;
	/** Where it is going with nothing to fight or collect, and for how long more (s) */
	private readonly headFor = vec3.create();
	private headLeft = 0;
	/** Going after a ship that got off its radar, rather than just looking */
	private pursuing = false;
	/** How far off it starts firing in this fight: not always as soon as it could */
	private fireFrom = 0;
	/** It has seen the ship it is after, and keeps its eyes on it while it is within sight */
	private noticed = false;
	private sinceGlance = 0;
	/** Phases of its aim's wandering */
	private readonly phases: readonly number[];

	constructor(traits: BotTraits, { coop = false, random = Math.random }: BotOptions = {}) {
		this.traits = traits;
		this.coop = coop;
		this.random = random;
		this.phases = [0, 1, 2, 3].map(() => random() * 2 * Math.PI);
	}

	/** Flying a new ship: nothing left of the last flight */
	reset(): void {
		this.target = this.powerup = null;
		this.sinceLook = Infinity;
		this.engaged = false;
		this.seen.length = 0;
		this.breakLeft = this.evadeRest = this.throttleSteps = this.burstLeft = this.burstRest = this.lockedFor = this.rocketRest = this.headLeft = 0;
		this.pursuing = this.noticed = false;
	}

	update(dt: number, ship: Ship, world: World): void {
		this.time += dt;
		this.look(dt, ship, world);
		this.breakLeft = Math.max(0, this.breakLeft - dt);
		this.evadeRest = Math.max(0, this.evadeRest - dt);

		const { target } = this;
		if (!target) {
			const collect = (this.powerup && !this.pursuing ? vec3.clone(world.nearest(this.powerup.position, ship.position)) : null);
			this.setSpeed(dt, ship, this.collectSpeed(ship, collect));
			this.steerTowards(dt, ship, collect ?? this.search(dt, ship, world));
			this.burstLeft = 0; /* nothing in sight to shoot at */
			this.pullTrigger(dt, ship, false);
			return;
		}
		this.pursuing = false;

		const at = vec3.clone(world.nearest(target.position, ship.position));
		const distance = vec3.distance(ship.position, at);
		this.notice(dt, distance);
		const engaged = distance < this.traits.engageRange * (this.engaged ? DISENGAGE_FACTOR : 1);
		if (engaged && !this.engaged) { this.fireFrom = this.traits.fireRange * (FIRE_NEAREST + (1 - FIRE_NEAREST) * this.random()); }
		this.engaged = engaged;
		const offItsNose = angleOffNose(target, world.nearest(ship.position, target.position));
		const collect = (this.powerup && !this.engaged ? vec3.clone(world.nearest(this.powerup.position, ship.position)) : null);

		this.setSpeed(dt, ship, this.wantedSpeed(ship, target, distance, angleOffNose(ship, at), offItsNose, collect));
		if (this.engaged) { this.considerEvading(dt, ship, at, distance, offItsNose); }

		let fire = false;
		if (this.breakLeft > 0) {
			this.steerTowards(dt, ship, this.breakTo);
		} else if (!this.engaged) {
			this.steerTowards(dt, ship, collect ?? at);
		} else if (distance < this.traits.standoff && this.closingOn(ship, target, at) > RAM_SPEED) {
			this.veerOff(ship);
		} else if (!this.noticed) {
			/* only on its radar, or not made out yet: it turns towards the contact, with nothing to lead or shoot at yet */
			this.steerTowards(dt, ship, vec3.clone(world.nearest(this.seen[0].position, ship.position)));
		} else {
			const off = this.steerTowards(dt, ship, this.aimPoint(ship, world));
			fire = (distance <= this.fireFrom && off <= this.traits.fireCone);
		}

		if (!this.noticed) { this.burstLeft = 0; } /* what it does not see it does not shoot at, not even to finish a burst */
		if (this.coop && (fire || this.burstLeft > 0) && this.podInLine(ship, world)) { /* not through the pods it defends */
			fire = false;
			this.burstLeft = 0;
		}
		this.pullTrigger(dt, ship, fire);
		this.launchRockets(dt, ship);
	}

	/** Whether it sees the ship it is after: once noticed, it keeps it in sight within SIGHT_REACH; fading in and out of sight, now and then it may notice it */
	private notice(dt: number, distance: number): void {
		if (distance > SIGHT_REACH) {
			this.noticed = false;
			return;
		}
		this.sinceGlance += dt;
		const chance = noticeChance(distance);
		if (this.noticed || (chance < 1 && this.sinceGlance < NOTICE_TIME)) { return; }
		this.sinceGlance = 0;
		this.noticed = this.random() < chance;
	}

	/** The speed it wants: full ahead, unless it needs to turn tighter or knows how to use speed to hold a tail */
	private wantedSpeed(ship: Ship, target: Ship, distance: number, offMyNose: number, offItsNose: number, collect: vec3 | null): number {
		const top = ship.engine.speed.limit;
		const cruise = this.traits.cruise * top;
		if (this.breakLeft > 0) { return cruise; }

		if (collect) { return this.collectSpeed(ship, collect); }

		let best = cruise;
		if (offItsNose > FLEEING_ANGLE && offMyNose < TURN_ANGLE && distance < CHASE_REACH) {
			best = Math.max(0, Math.min(top, vec3.length(target.velocity) + (distance - CHASE_RANGE) * CHASE_GAIN));
		} else if (offMyNose > TURN_ANGLE && distance < TURN_RANGE) {
			best = TURN_SPEED * top;
		}
		return mix(cruise, best, this.traits.positioning);
	}

	/** Its usual speed, slowing down to turn for a powerup close by, not to circle it for ever */
	private collectSpeed(ship: Ship, collect: vec3 | null): number {
		const top = ship.engine.speed.limit;
		const close = (collect !== null && vec3.distance(ship.position, collect) < COLLECT_RANGE && angleOffNose(ship, collect) > COLLECT_ANGLE);
		return (close ? TURN_SPEED : this.traits.cruise) * top;
	}

	/** Where to, with nothing on its radar: where a ship it was after went, for a while; otherwise on, turning now and then */
	private search(dt: number, ship: Ship, world: World): vec3 {
		this.headLeft -= dt;
		if (this.headLeft <= 0 && this.coop) {
			this.patrol(world);
		} else if (this.headLeft <= 0) {
			this.pursuing = false;
			/* a new heading, more ahead than behind: one looking around sweeps on rather than turn back */
			const z = 2 * this.random() - 1;
			const around = 2 * Math.PI * this.random();
			const across = Math.sqrt(1 - z * z);
			const heading = vec3.fromValues(across * Math.cos(around), across * Math.sin(around), z);
			vec3.add(heading, heading, vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation));
			if (vec3.length(heading) < 1e-3) { vec3.set(heading, 0, 1, 0); }
			vec3.normalize(heading, heading);
			vec3.scaleAndAdd(this.headFor, ship.position, heading, SEARCH_AHEAD);
			this.headLeft = SEARCH_TIME;
		}
		return vec3.clone(world.nearest(this.headFor, ship.position));
	}

	/** Co-op, with no enemy about: somewhere around the pods still there, to be close when the next thief comes */
	private patrol(world: World): void {
		const pods = world.scene.filter((entity): entity is Pod => entity instanceof Pod && !entity.dead && !entity.carrier);
		const center = vec3.create();
		for (const pod of pods) { vec3.scaleAndAdd(center, center, pod.position, 1 / pods.length); }
		const around = 2 * Math.PI * this.random();
		vec3.add(this.headFor, center, vec3.fromValues(PATROL_RADIUS * Math.cos(around), (this.random() - 0.5) * 20, PATROL_RADIUS * Math.sin(around)));
		this.headLeft = PATROL_TIME;
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

	/** With a ship on its tail, it may turn to fly across that ship's guns, the shorter way round */
	private considerEvading(dt: number, ship: Ship, at: ReadonlyVec3, distance: number, offItsNose: number): void {
		this.sinceEvadeCheck += dt;
		if (this.sinceEvadeCheck < EVADE_CHECK) { return; }
		this.sinceEvadeCheck = 0;
		if (this.breakLeft > 0 || this.evadeRest > 0 || distance > THREAT_RANGE || offItsNose > THREAT_CONE || angleOffNose(ship, at) < CANNOT_REPLY_ANGLE
			|| this.random() >= this.traits.evasion) { return; }

		const toward = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), at, ship.position));
		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const across = vec3.scaleAndAdd(vec3.create(), nose, toward, -vec3.dot(nose, toward));
		if (vec3.length(across) < 0.05) { vec3.cross(across, toward, vec3.random(vec3.create())); } /* head on: either side will do */
		vec3.normalize(across, across);
		vec3.scaleAndAdd(this.breakTo, ship.position, across, 80);
		this.breakLeft = EVADE_TIME;
		this.evadeRest = EVADE_TIME + EVADE_REST;
	}

	/** Who to fight and what to collect, looked at again from time to time, not all the time; and what the one it fights is doing */
	private look(dt: number, ship: Ship, world: World): void {
		this.sinceLook += dt;
		const stale = (!this.target || this.target.dead || this.sinceLook >= RETARGET_TIME);
		if (stale) {
			this.sinceLook = 0;
			/* in co-op the radar shows every contact, those beyond its range at its edge */
			const onRadar = (entity: Entity) => this.coop || vec3.distance(ship.position, world.nearest(entity.position, ship.position)) <= RADAR_REACH;
			const nearest = (this.coop
				? this.mostUrgent(ship, world)
				: this.nearest(ship, world, world.players.filter(other => other != ship && !other.dead && onRadar(other))));
			if (!nearest && this.target && !this.target.dead) { this.pursue(ship, world); }
			if (nearest != this.target) {
				this.seen.length = 0;
				this.noticed = false;
			}
			this.target = nearest;
			const powerups = world.scene.filter((entity): entity is Powerup => entity instanceof Powerup && !entity.dead && wants(entity, ship) && onRadar(entity));
			this.powerup = this.nearest(ship, world, powerups);
		} else if (this.powerup?.dead) {
			this.powerup = null;
		}

		const { target, seen } = this;
		if (!target) { return; }
		if (!this.coop && vec3.distance(ship.position, world.nearest(target.position, ship.position)) > RADAR_REACH) {
			/* off its radar now: all it knows is where it last saw it going */
			this.pursue(ship, world);
			this.target = null;
			seen.length = 0;
			return;
		}
		seen.push({ time: this.time, position: vec3.clone(target.position), velocity: vec3.clone(target.velocity) });
		while (seen.length > 1 && seen[1].time <= this.time - this.traits.reaction) { seen.shift(); }
	}

	/** The ship it was after got off its radar: it heads on for where that was going, as far as it saw */
	private pursue(ship: Ship, world: World): void {
		const last = this.seen.at(-1);
		if (!last) { return; }
		vec3.copy(this.headFor, world.nearest(last.position, ship.position));
		vec3.scaleAndAdd(this.headFor, this.headFor, last.velocity, PURSUIT_TIME);
		this.headLeft = PURSUIT_TIME;
		this.pursuing = true;
	}

	/** Co-op: a pod where a shot fired now could go, missing or not; the one its target carries is worth the risk */
	private podInLine(ship: Ship, world: World): boolean {
		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const cargo = (this.target instanceof Pirate ? this.target.cargo : null);
		for (const entity of world.scene) {
			if (!(entity instanceof Pod) || entity.dead || entity == cargo) { continue; }
			const to = vec3.subtract(vec3.create(), entity.position, ship.position);
			const along = vec3.dot(to, nose);
			if (along <= 0 || along > GUN_REACH) { continue; }
			if (Math.sqrt(Math.max(0, vec3.squaredLength(to) - along * along)) < POD_CLEARANCE + entity.radius) { return true; }
		}
		return false;
	}

	/** Co-op: the enemy to fight first, by how far it is, whether it is after the pods and whether a teammate is closer to it */
	private mostUrgent(ship: Ship, world: World): Ship | null {
		const teammates = world.players.filter(other => other != ship && !other.dead);
		let best: Ship | null = null;
		let bestScore = Infinity;
		for (const entity of world.scene) {
			if (!(entity instanceof Ship) || entity instanceof PlayerShip || entity.dead) { continue; }
			const distance = vec3.distance(ship.position, entity.position);
			const theirs = teammates.some(other => vec3.distance(other.position, entity.position) < distance);
			const weight = (entity instanceof Pirate ? (entity.cargo ? CARRIER_WEIGHT : THIEF_WEIGHT) : 1) * (theirs ? TEAMMATE_WEIGHT : 1);
			const score = distance * weight;
			if (score < bestScore) {
				best = entity;
				bestScore = score;
			}
		}
		return best;
	}

	private nearest<T extends Ship | Powerup>(ship: Ship, world: World, candidates: readonly T[]): T | null {
		let nearest: T | null = null;
		let best = Infinity;
		for (const candidate of candidates) {
			const distance = vec3.distance(ship.position, world.nearest(candidate.position, ship.position));
			if (distance < best) {
				best = distance;
				nearest = candidate;
			}
		}
		return nearest;
	}

	private closingOn(ship: Ship, target: Ship, at: ReadonlyVec3): number {
		const toward = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), at, ship.position));
		const relative = vec3.subtract(vec3.create(), ship.velocity, target.velocity);
		return vec3.dot(relative, toward);
	}

	/** Where it wants its nose: where the target is by now, as far as it can tell, and ahead of that by as much as the shot takes to get there */
	private aimPoint(ship: Ship, world: World): vec3 {
		const seen = this.seen[0];
		const { lead } = this.traits;
		const late = this.time - seen.time;
		const at = vec3.clone(world.nearest(seen.position, ship.position));
		const flight = vec3.distance(ship.position, at) / SHOT_SPEED;
		/* the shot leaves with the ship's own velocity, so for the flight only the difference counts */
		vec3.scaleAndAdd(at, at, seen.velocity, (late + flight) * lead);
		vec3.scaleAndAdd(at, at, ship.velocity, -flight * lead);
		return at;
	}

	/** Slow, irregular: two waves on each axis. A person's aim drifts off and back rather than shakes. */
	private wander(): [number, number] {
		const { time, phases, traits: { wobble } } = this;
		return [
			wobble * (Math.sin(0.6 * time + phases[0]) + Math.sin(1.1 * time + phases[1])) / 2,
			wobble * (Math.sin(0.5 * time + phases[2]) + Math.sin(0.9 * time + phases[3])) / 2,
		];
	}

	/**
	 * Turns the nose towards a point, as well as it can
	 * @returns How far off it is, by what the bot can tell (rad)
	 */
	private steerTowards(dt: number, ship: Ship, point: ReadonlyVec3): number {
		const local = vec3.subtract(vec3.create(), point, ship.position);
		vec3.transformQuat(local, local, quat.conjugate(quat.create(), ship.orientation));
		/* positive yaw turns left, positive pitch raises the nose */
		const [wanderYaw, wanderPitch] = this.wander();
		const yaw = Math.atan2(-local[0], -local[2]) + wanderYaw;
		const pitch = Math.atan2(local[1], Math.hypot(local[0], local[2])) + wanderPitch;
		this.steerTo(dt, ship, yaw, pitch);
		return Math.hypot(yaw, pitch);
	}

	/** Moves the stick towards what it wants, as fast as a hand can */
	private steerTo(dt: number, ship: Ship, yaw: number, pitch: number): void {
		const { steerGain, stickRate, maxStick } = this.traits;
		const reach = stickRate * dt;
		const move = (axis: Ship["engine"]["yaw"], turn: number) => {
			const gap = clamp(turn * steerGain, maxStick) - axis.control;
			if (Math.abs(gap) >= HAND_REST) { axis.control += clamp(gap, reach); }
		};
		move(ship.engine.yaw, yaw);
		move(ship.engine.pitch, pitch);
	}

	/** Once pulled, the trigger stays pulled for a while, whatever the aim does meanwhile */
	private pullTrigger(dt: number, ship: Ship, fire: boolean): void {
		if (this.burstLeft > 0) {
			this.burstLeft -= dt;
			if (this.burstLeft <= 0) { this.burstRest = BURST_REST; }
		} else {
			this.burstRest = Math.max(0, this.burstRest - dt);
			if (fire && this.burstRest <= 0) { this.burstLeft = BURST_MIN - this.traits.burst * Math.log(1 - this.random()); }
		}
		ship.trigger = this.burstLeft > 0;
	}

	/** With a target locked and rockets left, it launches a moment later, then waits to see what the rocket does */
	private launchRockets(dt: number, ship: Ship): void {
		ship.targetLock ??= new TargetLock(entity => entity instanceof Ship && entity != ship && !(this.coop && entity instanceof PlayerShip));
		this.rocketRest = Math.max(0, this.rocketRest - dt);
		this.lockedFor = (ship.targetLock.locked ? this.lockedFor + dt : 0);
		if (this.lockedFor >= this.traits.rocketDelay && this.rocketRest <= 0 && ship.rockets > 0) {
			ship.launch = true;
			this.lockedFor = 0;
			this.rocketRest = ROCKET_REST;
		}
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
