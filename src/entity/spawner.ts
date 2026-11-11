import { quat, vec3 } from "gl-matrix";
import { ENEMY_KINDS, type EnemyKind } from "../levels.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import { Gunship } from "./gunship.ts";
import { Hunter } from "./hunter.ts";
import { Pirate } from "./pirate.ts";
import { Pod } from "./pod.ts";
import { Powerup, type PowerupKind } from "./powerup.ts";
import { Raider } from "./raider.ts";
import type { Ship } from "./ship.ts";
import { toList } from "./targets.ts";

const ENEMIES: Record<EnemyKind, (players: readonly Ship[]) => Ship> = {
	pirate: players => new Pirate(players),
	raider: players => new Raider(players),
	hunter: players => new Hunter(players),
	gunship: players => new Gunship(players),
};

/**
 * Where a pirate comes from: beyond the pods as seen by the player (so the pods are in the line of fire),
 * from the player's left or right, or from behind them; the last two out of the player's view
 */
export type Approach = "beyond-pods" | "side" | "behind";

export interface EnemySpawnerOptions {
	/** Most enemies present at once */
	max: number;
	/** Before the first enemy (s) */
	firstDelay: number;
	/** Between enemies, counted while below max (s); with groups, how long after a whole group came the next comes anyway, per enemy in it */
	interval: number;
	/** Enemies that come together, BURST_GAP apart; 1: one at a time, every `interval` */
	group: number;
	/** With groups: the pause after every enemy is gone, before the next group (s): time to collect powerups */
	rest: number;
	/** Enemies never appear closer than this to the player, horizontally (m) */
	minDistance: number;
	/** How far beyond the far edge of the pod field pirates appear (m) */
	behind: number;
	/** Random deviation from the line player → pods → pirate, either way (rad) */
	spread: number;
	/** Relative chances of each pirate approach */
	approaches: Record<Approach, number>;
}

const ENEMY_DEFAULTS: EnemySpawnerOptions = {
	max: 2,
	firstDelay: 5,
	interval: 20,
	group: 1,
	rest: 20,
	minDistance: 120,
	behind: 40,
	spread: 0.35,
	approaches: { "beyond-pods": 0.45, side: 0.4, behind: 0.15 },
};

/** Between the arrivals of a group's enemies (s) */
export const BURST_GAP = 1.5;

const degrees = (angle: number) => angle * Math.PI / 180;

/*
 * Horizontal angles from the player's heading. With the camera's 45° vertical field of view the screen reaches
 * 36° to either side at 16:9 and 56° at 32:9, so 60° and more is out of view.
 */
export const APPROACH_ANGLES: Record<Exclude<Approach, "beyond-pods">, readonly [number, number]> = {
	side: [degrees(60), degrees(120)],
	behind: [degrees(120), degrees(180)],
};

/**
 * Invisible scene member that sends in a level's enemies in order: one at a time, or in groups (`group` > 1) of enemies
 * BURST_GAP apart (waiting for room when `max` are about), the next group `rest` after every enemy is gone, or, if some are
 * still about, `interval` per enemy of the group after the whole group came, as soon as there is room.
 * Pirates take one of the approaches at random and head for the pods;
 * hunters arrive anywhere at minDistance from the player, facing them.
 * With several players, each enemy is placed by one of them still alive, picked at random.
 */
export class EnemySpawner extends Entity {
	private readonly options: EnemySpawnerOptions;
	private readonly players: readonly Ship[];
	/** The player the enemy being placed is placed by */
	private player: Ship;
	private readonly queue: EnemyKind[];
	/** Every enemy sent in so far, dead or alive */
	private readonly sent: Array<{ kind: EnemyKind; ship: Ship }> = [];
	private timer: number;
	/**
	 * Groups: enemies of the group still to come and the time to the next of them (s); the pause before the next group, once
	 * every enemy is gone, or null while some are about (s); and the time before the next group comes anyway (s)
	 */
	private readonly groups = { left: 0, gap: 0, rest: null as number | null, fallback: 0 };
	/** Groups that came while enemies of the one before were still about */
	fallbacks = 0;

	/** @param players One ship or a list kept up to date by the caller */
	constructor(players: Ship | readonly Ship[], enemies: readonly EnemyKind[], options: Partial<EnemySpawnerOptions> = {}) {
		super();
		this.players = toList(players);
		this.player = this.players[0];
		this.queue = [...enemies];
		this.options = { ...ENEMY_DEFAULTS, ...options };
		this.timer = this.options.firstDelay;
		this.groups.rest = this.options.firstDelay; /* the first group after firstDelay, as if after a pause */
	}

	/** Enemies not yet sent in plus those still present */
	get remaining(): number {
		return this.queue.length + this.present;
	}

	/** Enemies shot down so far (pirates that got away do not count) */
	get destroyed(): Record<EnemyKind, number> {
		const destroyed = Object.fromEntries(ENEMY_KINDS.map(kind => [kind, 0])) as Record<EnemyKind, number>;
		for (const { kind, ship } of this.sent) {
			if (ship.dead && !(ship instanceof Pirate && ship.escaped)) { destroyed[kind]++; }
		}
		return destroyed;
	}

	private get present(): number {
		return this.sent.filter(({ ship }) => !ship.dead).length;
	}

	override update(dt: number, world: World): void {
		if (this.options.group > 1) {
			this.updateGroups(dt, world);
			return;
		}
		if (!this.queue.length || this.present >= this.options.max) { return; }

		this.timer -= dt;
		if (this.timer > 0) { return; }
		this.timer = this.options.interval;

		if (!this.players.some(player => !player.dead)) { return; }
		this.send(world);
	}

	private updateGroups(dt: number, world: World): void {
		const { groups, options } = this;
		if (!this.queue.length || !this.players.some(player => !player.dead)) { return; } /* nobody to send them at: everything waits */

		if (groups.left > 0) { /* the group still coming: one by one, as there is room */
			groups.gap -= dt;
			if (groups.gap <= 0 && this.present < options.max) {
				this.send(world);
				groups.left--;
				groups.gap = BURST_GAP;
			}
			return;
		}

		if (!this.present) { /* all gone: a pause, then the next group */
			groups.rest ??= options.rest;
			groups.rest -= dt;
			if (groups.rest <= 0) { this.startGroup(); }
			return;
		}
		groups.rest = null;
		groups.fallback -= dt;
		if (groups.fallback <= 0 && this.present < options.max) { /* some still about, and too long: the next comes anyway */
			this.fallbacks++;
			this.startGroup();
		}
	}

	private startGroup(): void {
		const { groups, options } = this;
		Object.assign(groups, { left: Math.min(options.group, this.queue.length), gap: 0, rest: null, fallback: options.interval * options.group });
	}

	/** The next enemy in the queue, placed by one of the players still alive */
	private send(world: World): void {
		const alive = this.players.filter(player => !player.dead);
		this.player = alive[Math.floor(Math.random() * alive.length)];

		const kind = this.queue.shift()!;
		const enemy = ENEMIES[kind](this.players);
		const pods = world.scene.filter((entity): entity is Pod => entity instanceof Pod && !entity.dead && !entity.carrier);
		/* pod thieves (pirates, raiders) take one of the approaches; dogfighters (hunters, gunships) come at the player */
		const lookAt = (enemy instanceof Pirate ? this.placePirate(enemy.position, pods) : this.placeAroundPlayer(enemy.position));
		face(enemy, lookAt);

		this.sent.push({ kind, ship: enemy });
		world.spawn(enemy);
	}

	/** @returns Point to face: the center of the pod field */
	private placePirate(position: vec3, pods: readonly Pod[]): vec3 {
		if (!pods.length) { return this.placeAroundPlayer(position); }

		const approach = pickWeighted(this.options.approaches);
		if (approach == "beyond-pods") { return this.placeBehindPods(position, pods); }

		this.placeOffHeading(position, APPROACH_ANGLES[approach]);
		return podCenter(pods);
	}

	/** At minDistance, turned away from the player's horizontal heading by an angle in the range, to the left or right */
	private placeOffHeading(position: vec3, [min, max]: readonly [number, number]): void {
		const player = this.player;
		const heading = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), player.orientation);
		heading[1] = 0;
		if (vec3.length(heading) < 1e-3) { vec3.copy(heading, randomHorizontal()); } /* looking straight up or down */
		vec3.normalize(heading, heading);

		const angle = (min + (max - min) * Math.random()) * (Math.random() < 0.5 ? -1 : 1);
		vec3.rotateY(heading, heading, vec3.create(), angle);
		vec3.scaleAndAdd(position, player.position, heading, this.options.minDistance);
		position[1] = player.position[1] + (Math.random() - 0.5) * 10;
	}

	/** @returns Point to face */
	private placeAroundPlayer(position: vec3): vec3 {
		const player = this.player.position;
		vec3.scaleAndAdd(position, player, randomHorizontal(), this.options.minDistance);
		position[1] += (Math.random() - 0.5) * 10;
		return vec3.clone(player);
	}

	/** @returns Point to face: the center of the pod field */
	private placeBehindPods(position: vec3, pods: readonly Pod[]): vec3 {
		if (!pods.length) { return this.placeAroundPlayer(position); }

		const { minDistance, behind, spread } = this.options;
		const player = this.player.position;

		/* pod field: center and horizontal radius */
		const center = podCenter(pods);
		const radius = Math.max(...pods.map(pod => Math.hypot(pod.position[0] - center[0], pod.position[2] - center[2])));

		/* away from the player, through the center */
		const direction = vec3.fromValues(center[0] - player[0], 0, center[2] - player[2]);
		if (vec3.length(direction) < 1) { vec3.copy(direction, randomHorizontal()); }
		vec3.normalize(direction, direction);
		vec3.rotateY(direction, direction, vec3.create(), (2 * Math.random() - 1) * spread);

		let distance = radius + behind;
		for (let i = 0; i < 10; i++) { /* push further out until far enough from the player */
			vec3.scaleAndAdd(position, center, direction, distance);
			const shortBy = minDistance - Math.hypot(position[0] - player[0], position[2] - player[2]);
			if (shortBy <= 0) { break; }
			distance += shortBy;
		}

		position[1] = center[1] + (Math.random() - 0.5) * 10;
		return center;
	}
}

export interface PowerupSpawnerOptions {
	/** Between powerups, counted while below max (s) */
	interval: number;
	/** Most powerups waiting to be collected at once */
	max: number;
	/** Horizontal distance from the center of the pods within which powerups appear (m) */
	radius: number;
}

const POWERUP_KINDS: readonly PowerupKind[] = ["shields", "power", "boost", "rockets"];

/** Invisible scene member that places random powerups around the pod field, or anywhere in a world that wraps around */
export class PowerupSpawner extends Entity {
	private readonly options: PowerupSpawnerOptions;
	private readonly players: readonly Ship[];
	private readonly waiting: Powerup[] = [];
	private timer: number;

	/** @param players Who can collect them: one ship or a list kept up to date by the caller */
	constructor(players: Ship | readonly Ship[], options: Partial<PowerupSpawnerOptions> = {}) {
		super();
		this.players = toList(players);
		this.options = { interval: 20, max: 2, radius: 50, ...options };
		this.timer = this.options.interval;
	}

	override update(dt: number, world: World): void {
		for (let i = this.waiting.length - 1; i >= 0; i--) {
			if (this.waiting[i].dead) { this.waiting.splice(i, 1); }
		}

		if (this.waiting.length >= this.options.max) { return; }

		this.timer -= dt;
		if (this.timer > 0) { return; }
		this.timer = this.options.interval;

		const kind = POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
		const powerup = new Powerup(kind, this.players);
		this.waiting.push(powerup);
		world.spawn(powerup);

		if (world.size !== null) {
			for (let axis = 0; axis < 3; axis++) { powerup.position[axis] = (Math.random() - 0.5) * world.size; }
			return;
		}

		const pods = world.scene.filter(entity => entity instanceof Pod && !entity.dead);
		const center = vec3.create();
		for (const pod of pods) { vec3.add(center, center, pod.position); }
		if (pods.length) { vec3.scale(center, center, 1 / pods.length); }

		const distance = this.options.radius * Math.sqrt(Math.random()); /* uniform over the disc */
		vec3.scaleAndAdd(powerup.position, center, randomHorizontal(), distance);
		powerup.position[1] = center[1] + (Math.random() - 0.5) * 10;
	}
}

function podCenter(pods: readonly Pod[]): vec3 {
	const center = vec3.create();
	for (const pod of pods) { vec3.add(center, center, pod.position); }
	return vec3.scale(center, center, 1 / pods.length);
}

/** A key picked with probability proportional to its weight */
export function pickWeighted<K extends string>(weights: Record<K, number>): K {
	const entries = Object.entries(weights) as [K, number][];
	let left = Math.random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
	for (const [key, weight] of entries) {
		left -= weight;
		if (left < 0) { return key; }
	}
	return entries.filter(([, weight]) => weight > 0).at(-1)![0];
}

function randomHorizontal(): vec3 {
	const angle = 2 * Math.PI * Math.random();
	return vec3.fromValues(Math.cos(angle), 0, Math.sin(angle));
}

function face(entity: Entity, point: vec3): void {
	const heading = vec3.subtract(vec3.create(), point, entity.position);
	if (vec3.length(heading) > 1) {
		quat.rotationTo(entity.orientation, vec3.fromValues(0, 0, -1), vec3.normalize(heading, heading));
	}
}
