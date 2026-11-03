import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "../src/audio/sounds.ts";
import { resolveCollisions, resolveHits } from "../src/collision.ts";
import { DIFFICULTIES, type DifficultyLevel } from "../src/difficulty.ts";
import { explode } from "../src/entity/debris.ts";
import type { Entity } from "../src/entity/entity.ts";
import { Missile } from "../src/entity/missile.ts";
import { PlayerShip } from "../src/entity/player-ship.ts";
import { Pod } from "../src/entity/pod.ts";
import { Powerup } from "../src/entity/powerup.ts";
import { ROCKET_CAPACITY, Ship } from "../src/entity/ship.ts";
import { Shot } from "../src/entity/shot.ts";
import { EnemySpawner, PowerupSpawner } from "../src/entity/spawner.ts";
import { LEVELS, levelOutcome, POD_FIELD, type Outcome } from "../src/levels.ts";
import { Loop } from "../src/loop.ts";
import { extraOf, kindIndex, kindOf } from "../src/net/kinds.ts";
import {
	MAX_HIT_DAMAGE, MAX_PLAYERS, RECONNECT_GRACE, round, SNAPSHOT_STEPS,
	type ClientMessage, type EntityRecord, type GameEvent, type HitReport, type OutcomeMessage, type Quat, type RoomInfo, type RoomState,
	type ServerMessage, type StartMessage,
} from "../src/net/protocol.ts";
import type { Pilot } from "../src/pilot.ts";
import { cleanName } from "../src/scores.ts";
import { Weapon } from "../src/weapon.ts";

/** Someone in a room, as rooms see them; their connection may drop and come back */
export interface Member {
	readonly id: number;
	name: string;
	/** Secret that lets the same browser take its place back on a new connection */
	readonly token: string;
	/** Goes nowhere while their connection is down */
	send(message: ServerMessage): void;
}

type StateMessage = Extract<ClientMessage, { type: "state" }>;

/** Most shots, rockets and hits taken from one state report; a browser reports 30 times a second */
const MAX_SHOTS = 10;
const MAX_ROCKETS = 3;
const MAX_HITS = 20;
/** Players' ships stay within this distance of the centre (m); reports beyond are ignored */
const WORLD_LIMIT = 10000;
/** Gap between players' ships at the start, side by side (m) */
const START_GAP = 8;

/** What players' shots look like: the standard gun's */
const PLAYER_GUN = new Weapon().options;

/** Flies a player's ship between reports with the controls last reported; the ship does not fire (browsers do) */
class RemotePilot implements Pilot {
	target = 0;
	yaw = 0;
	pitch = 0;

	update(_dt: number, ship: Ship): void {
		ship.engine.speed.target = this.target;
		ship.engine.yaw.control = this.yaw;
		ship.engine.pitch.control = this.pitch;
		ship.trigger = false;
	}
}

interface Flyer {
	readonly member: Member;
	readonly ship: PlayerShip;
	readonly pilot: RemotePilot;
}

interface Level {
	/** Counts the room's levels */
	readonly run: number;
	readonly index: number;
	readonly difficulty: DifficultyLevel;
	readonly loop: Loop;
	readonly enemies: EnemySpawner;
	readonly pods: readonly Pod[];
	/** Member id → their ship */
	readonly flyers: Map<number, Flyer>;
	steps: number;
	outcome: Outcome | null;
	/** Sent when the level ended; again to a player who comes back after that */
	result: OutcomeMessage | null;
}

/** An event for everyone, for one member only (`to`), or for everyone but one (`except`) */
interface Queued {
	readonly event: GameEvent;
	readonly to?: number;
	readonly except?: number;
}

const finite = (value: unknown): value is number => typeof value == "number" && Number.isFinite(value);
const finiteList = (value: unknown, length: number): value is number[] =>
	Array.isArray(value) && value.length == length && value.every(finite);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const rounded = (v: ReadonlyVec3, digits = 2): [number, number, number] => [round(v[0], digits), round(v[1], digits), round(v[2], digits)];

/**
 * Up to MAX_PLAYERS people flying levels together. In the lobby the host picks the level and difficulty and starts;
 * during a level the room runs the simulation (everything but the players' own flying and shooting)
 * and sends each player a snapshot every SNAPSHOT_STEPS steps.
 */
export class Room {
	readonly code: string;
	readonly members: Member[] = [];
	host: number;
	levelIndex: number;
	difficulty: DifficultyLevel;
	state: RoomState = "lobby";

	private level: Level | null = null;
	/** Levels started so far */
	private runs = 0;
	/** Members whose connection dropped → how long ago (s); they keep their place for RECONNECT_GRACE */
	private readonly away = new Map<number, number>();
	private readonly ids = new WeakMap<Entity, number>();
	private readonly byId = new Map<number, Entity>();
	private nextId = 1;
	private queue: Queued[] = [];
	/** Shots already sent as events */
	private readonly announced = new WeakSet<Entity>();

	constructor(code: string, host: Member, levelIndex: number, difficulty: DifficultyLevel) {
		this.code = code;
		this.host = host.id;
		this.levelIndex = levelIndex;
		this.difficulty = difficulty;
		this.members.push(host);
	}

	info(): RoomInfo {
		return {
			code: this.code,
			host: this.host,
			players: this.members.map(({ id, name }) => ({ id, name, away: this.away.has(id) })),
			level: this.levelIndex,
			difficulty: this.difficulty,
			state: this.state,
		};
	}

	/** @returns Why the member cannot join, or null when they joined */
	join(member: Member): string | null {
		if (this.members.length >= MAX_PLAYERS) { return `Room ${this.code} is full: ${MAX_PLAYERS} pilots at most.`; }
		if (this.state == "playing") { return `Room ${this.code} is in the middle of a level. Try again when it ends.`; }
		this.members.push(member);
		this.welcome(member);
		this.broadcastRoom(member.id);
		return null;
	}

	/** The room as it is, to a member who just came in */
	welcome(member: Member): void {
		member.send({ type: "welcome", you: member.id, room: this.info(), token: member.token });
	}

	/** @returns Whether the room is empty now */
	leave(memberId: number): boolean {
		const index = this.members.findIndex(member => member.id == memberId);
		if (index < 0) { return this.members.length == 0; }
		this.members.splice(index, 1);
		this.away.delete(memberId);

		const flyer = this.level?.flyers.get(memberId);
		if (flyer) {
			flyer.ship.dead = true; /* gone quietly, not exploded */
			this.level!.flyers.delete(memberId);
		}

		if (!this.members.length) {
			this.level = null;
			return true;
		}
		this.pickHost();
		this.broadcastRoom();
		return false;
	}

	/** The member's connection dropped: they keep their place for RECONNECT_GRACE, their ship holding course */
	disconnected(memberId: number): void {
		if (!this.members.some(({ id }) => id == memberId)) { return; }
		this.away.set(memberId, 0);
		const flyer = this.level?.flyers.get(memberId);
		if (flyer) { flyer.pilot.yaw = flyer.pilot.pitch = 0; }
		this.pickHost();
		this.broadcastRoom();
	}

	/** The member is back on a new connection: they get the room, and the level as it is now if one is on */
	reconnected(memberId: number): void {
		const member = this.members.find(({ id }) => id == memberId);
		if (!member) { return; }
		this.away.delete(memberId);
		this.pickHost();
		this.welcome(member);

		const level = this.level;
		const flyer = level?.flyers.get(memberId);
		if (level && flyer) {
			if (this.state == "playing") { member.send(this.startMessage(level, flyer)); }
			if (this.state == "over" && level.result) { member.send(level.result); }
		}
		this.broadcastRoom(memberId);
	}

	rename(memberId: number, name: string): void {
		const member = this.members.find(({ id }) => id == memberId);
		if (!member) { return; }
		member.name = cleanName(name);
		this.broadcastRoom();
	}

	/** Host, between levels */
	setup(memberId: number, levelIndex: number, difficulty: DifficultyLevel): void {
		if (memberId != this.host || this.state == "playing") { return; }
		this.levelIndex = levelIndex;
		this.difficulty = difficulty;
		this.broadcastRoom();
	}

	/** Host: start a level (the one set up when not given) */
	start(memberId: number, levelIndex = this.levelIndex): void {
		if (memberId != this.host || this.state == "playing" || !LEVELS[levelIndex]) { return; }
		this.levelIndex = levelIndex;
		const level = this.level = this.createLevel(levelIndex);
		this.state = "playing";
		for (const flyer of level.flyers.values()) { flyer.member.send(this.startMessage(level, flyer)); }
	}

	/** Host, after a level: everyone back to the lobby */
	toLobby(memberId: number): void {
		if (memberId != this.host || this.state != "over") { return; }
		this.level = null;
		this.state = "lobby";
		this.broadcastRoom();
	}

	/** A player's browser reports its ship, and the shots, rockets and hits since the last report */
	report(memberId: number, { ship: state, shots, rockets, hits }: StateMessage): void {
		const level = this.level;
		const flyer = level?.flyers.get(memberId);
		if (!level || !flyer || flyer.ship.dead) { return; }
		const { ship, pilot } = flyer;

		if (finiteList(state?.p, 3) && finiteList(state.q, 4) && finiteList(state.v, 3) && vec3.length(state.p as vec3) < WORLD_LIMIT
			&& finite(state.speed) && finite(state.target) && finite(state.yaw) && finite(state.pitch)) {
			vec3.copy(ship.position, state.p as vec3);
			quat.normalize(ship.orientation, state.q as quat);
			vec3.copy(ship.velocity, state.v as vec3);
			ship.engine.speed.value = clamp(state.speed, -ship.topSpeed, ship.topSpeed);
			pilot.target = clamp(state.target, -ship.topSpeed, ship.topSpeed);
			pilot.yaw = clamp(state.yaw, -1, 1);
			pilot.pitch = clamp(state.pitch, -1, 1);
		}

		const t = this.time;
		const shipId = this.id(ship);
		for (const shot of (Array.isArray(shots) ? shots.slice(0, MAX_SHOTS) : [])) {
			if (!finiteList(shot?.p, 3) || !finiteList(shot.v, 3)) { continue; }
			const event: GameEvent = ["shot", t, ...rounded(shot.p as vec3), ...rounded(shot.v as vec3), PLAYER_GUN.color, PLAYER_GUN.lifetime, shipId, 0];
			this.queue.push({ event, except: memberId });
		}
		for (const rocket of (Array.isArray(rockets) ? rockets.slice(0, MAX_ROCKETS) : [])) {
			if (!finiteList(rocket?.p, 3) || !finiteList(rocket.v, 3) || !finite(rocket.target)) { continue; }
			const event: GameEvent = ["rocket", t, ...rounded(rocket.p as vec3), ...rounded(rocket.v as vec3), shipId, rocket.target];
			this.queue.push({ event, except: memberId });
			ship.rockets = Math.max(0, ship.rockets - 1); /* counted here too, for a player who comes back */
		}
		for (const hit of (Array.isArray(hits) ? hits.slice(0, MAX_HITS) : [])) { this.applyHit(memberId, hit); }
	}

	/**
	 * Run the level for the real time elapsed (s); members away longer than RECONNECT_GRACE leave
	 * @returns Whether the room is empty now
	 */
	advance(elapsed: number): boolean {
		this.level?.loop.advance(elapsed);
		for (const [id, time] of this.away) {
			if (time + elapsed < RECONNECT_GRACE) {
				this.away.set(id, time + elapsed);
			} else if (this.leave(id)) {
				return true;
			}
		}
		return false;
	}

	/** Simulation time of the level (s) */
	private get time(): number {
		const level = this.level;
		return (level ? round(level.steps * level.loop.step, 3) : 0);
	}

	/** The host stays while connected; otherwise the first member who is */
	private pickHost(): void {
		const present = (id: number) => this.members.some(member => member.id == id) && !this.away.has(id);
		if (present(this.host)) { return; }
		this.host = (this.members.find(({ id }) => present(id)) ?? this.members[0]).id;
	}

	/** The level, for one member: as it starts, or as it is now for one who comes back */
	private startMessage(level: Level, { ship }: Flyer): StartMessage {
		const ships: Record<number, number> = {};
		for (const [id, flyer] of level.flyers) { ships[id] = this.id(flyer.ship); }
		const q = ship.orientation;
		return {
			type: "start",
			run: level.run,
			level: level.index,
			difficulty: level.difficulty,
			ships,
			spawn: rounded(ship.position),
			facing: [round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4)] as Quat,
			rockets: ship.rockets,
			alive: !ship.dead,
			podsTotal: level.pods.length,
		};
	}

	private broadcastRoom(except?: number): void {
		const room = this.info();
		for (const member of this.members) {
			if (member.id != except) { member.send({ type: "room", room }); }
		}
	}

	private id(entity: Entity): number {
		let id = this.ids.get(entity);
		if (id === undefined) {
			id = this.nextId++;
			this.ids.set(entity, id);
			this.byId.set(id, entity);
		}
		return id;
	}

	private createLevel(index: number): Level {
		const config = LEVELS[index];
		const loop = new Loop();
		loop.debris = false; /* nobody watches here */
		loop.difficulty = DIFFICULTIES[this.difficulty];
		/* players' ships are moved by their browsers, which also handle their bumps */
		loop.rules = (scene, world) => {
			resolveHits(scene, world);
			resolveCollisions(scene.filter(entity => !(entity instanceof PlayerShip)), world);
		};

		const flyers = new Map<number, Flyer>();
		this.members.forEach((member, i) => {
			const ship = new PlayerShip();
			ship.position[0] = (i - (this.members.length - 1) / 2) * START_GAP;
			ship.rockets = ROCKET_CAPACITY; /* as the browsers start */
			const pilot = new RemotePilot();
			ship.setPilot(pilot);
			flyers.set(member.id, { member, ship, pilot });
			loop.players.push(ship);
		});

		const pods = Array.from({ length: config.pods }, () => {
			const pod = new Pod();
			vec3.set(pod.position, (Math.random() - 0.5) * 2 * POD_FIELD, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2 * POD_FIELD);
			return pod;
		});
		const enemies = new EnemySpawner(loop.players, config.enemies, { max: config.maxEnemies, interval: config.enemyInterval });
		loop.scene.push(...loop.players, ...pods, enemies);
		if (config.powerups) { loop.scene.push(new PowerupSpawner(loop.players, config.powerups)); }

		loop.onSound = (name, at, to) => this.onSound(name, at, to);
		loop.onRemove = entity => this.onRemove(entity);
		loop.onStep = () => this.afterStep();

		this.queue = [];
		return { run: ++this.runs, index, difficulty: this.difficulty, loop, enemies, pods, flyers, steps: 0, outcome: null, result: null };
	}

	private memberFlying(ship: Entity): number | undefined {
		for (const [id, flyer] of this.level?.flyers ?? []) {
			if (flyer.ship == ship) { return id; }
		}
		return undefined;
	}

	private onSound(name: SoundName, at?: ReadonlyVec3, to?: Entity): void {
		/* every browser plays these itself, along with the shot or explosion it shows */
		if (name == "cannon" || name == "explosion") { return; }

		const event: GameEvent = (at ? ["sound", this.time, name, ...rounded(at, 1)] : ["sound", this.time, name]);
		if (!to) {
			this.queue.push({ event });
			return;
		}
		const member = this.memberFlying(to);
		if (member !== undefined) { this.queue.push({ event, to: member }); }
	}

	private onRemove(entity: Entity): void {
		const id = this.ids.get(entity);
		if (id !== undefined) {
			if (entity.exploded) { this.queue.push({ event: ["explode", this.time, id] }); }
			this.byId.delete(id);
		}

		if (entity instanceof Powerup && entity.collector) {
			const member = this.memberFlying(entity.collector);
			if (member !== undefined) { this.queue.push({ event: ["powerup", this.time, entity.kind], to: member }); }
		}
	}

	/** A player's shot or rocket hit something on their screen: the hit counts (co-op: browsers are trusted) */
	private applyHit(memberId: number, hit: HitReport): void {
		const level = this.level;
		if (!level || !finite(hit?.id) || !finite(hit.damage)) { return; }
		const target = this.byId.get(hit.id);
		/* no friendly fire */
		if (!target || target.dead || !target.hittable || target instanceof PlayerShip) { return; }

		const damage = clamp(hit.damage, 0, MAX_HIT_DAMAGE);
		if (target instanceof Ship && target.absorb(damage)) {
			/* the shooter heard it already */
			const sound: SoundName = (damage > PLAYER_GUN.damage ? "impact" : "hit");
			this.queue.push({ event: ["sound", this.time, sound, ...rounded(target.position, 1)], except: memberId });
			return;
		}
		explode(target, level.loop);
	}

	private afterStep(): void {
		const level = this.level!;
		level.steps++;
		const t = this.time;

		/* enemy shots fly in a straight line: one event each is enough to show them */
		for (const entity of level.loop.scene) {
			if (!(entity instanceof Shot) || entity instanceof Missile || this.announced.has(entity)) { continue; }
			this.announced.add(entity);
			const owner = (entity.owner ? this.id(entity.owner) : 0);
			const event: GameEvent = [
				"shot", t, ...rounded(entity.position), ...rounded(entity.velocity), entity.color, round(entity.timeLeft, 2), owner,
				(entity.hitOnly ? 1 : 0),
			];
			this.queue.push({ event });
		}

		let ended = false;
		if (!level.outcome) {
			const podsLeft = level.pods.filter(pod => !pod.dead).length;
			const allDown = level.loop.players.every(ship => ship.dead);
			level.outcome = levelOutcome({ shipDead: allDown, podsLeft, enemiesLeft: level.enemies.remaining });
			ended = level.outcome !== null;
		}

		if (ended || level.steps % SNAPSHOT_STEPS == 0) { this.sendSnapshots(level, t); }

		if (ended) {
			this.state = "over";
			const result: OutcomeMessage = level.result = {
				type: "outcome",
				outcome: level.outcome!,
				podsLeft: level.pods.filter(pod => !pod.dead).length,
				podsTotal: level.pods.length,
				destroyed: { ...level.enemies.destroyed },
			};
			for (const { member } of level.flyers.values()) { member.send(result); }
			this.broadcastRoom();
		}
	}

	private sendSnapshots(level: Level, t: number): void {
		const records: EntityRecord[] = [];
		for (const entity of level.loop.scene) {
			const kind = kindOf(entity);
			if (!kind || entity.dead) { continue; }
			const [x, y, z] = rounded(entity.position);
			const q = entity.orientation;
			records.push([this.id(entity), kindIndex(kind), x, y, z, round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4), extraOf(entity)]);
		}

		const enemies = level.enemies.remaining;
		const pods = level.pods.filter(pod => !pod.dead).length;
		for (const { member, ship } of level.flyers.values()) {
			const ev = this.queue
				.filter(({ to, except }) => (to === undefined || to == member.id) && except != member.id)
				.map(({ event }) => event);
			member.send({ type: "snapshot", t, e: records, ev, enemies, pods, shields: Math.round(ship.shields.value) });
		}
		this.queue = [];
	}
}
