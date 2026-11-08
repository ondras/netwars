import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "../src/audio/sounds.ts";
import { BotPilot, botTraits, type BotTraits } from "../src/bot.ts";
import { resolveCollisions, resolveHits } from "../src/collision.ts";
import { DIFFICULTIES, type DifficultyLevel } from "../src/difficulty.ts";
import { explode } from "../src/entity/debris.ts";
import type { Entity } from "../src/entity/entity.ts";
import { Missile } from "../src/entity/missile.ts";
import { Pirate } from "../src/entity/pirate.ts";
import { PlayerShip } from "../src/entity/player-ship.ts";
import { LOOK_COUNT } from "../src/entity/player-ships.ts";
import { Pod } from "../src/entity/pod.ts";
import { Powerup } from "../src/entity/powerup.ts";
import { POWER_SHOT, ROCKET, ROCKET_CAPACITY, Ship } from "../src/entity/ship.ts";
import { Shot } from "../src/entity/shot.ts";
import { EnemySpawner, PowerupSpawner } from "../src/entity/spawner.ts";
import { ENEMY_KINDS, enemyWaves, LEVELS, levelOutcome, POD_FIELD, type EnemyKind, type Outcome } from "../src/levels.ts";
import { Loop } from "../src/loop.ts";
import { extraOf, kindIndex, kindOf } from "../src/net/kinds.ts";
import {
	arenaSizeFor, DEFAULT_FRAG_LIMIT, DEFAULT_TIME_LIMIT, MAX_PLAYERS, MIN_ARENA_SIZE, RECONNECT_GRACE, RESPAWN_DELAY, round, SNAPSHOT_STEPS,
	type ClientMessage, type EntityRecord, type GameEvent, type GameMode, type HitReport, type MatchResult, type OutcomeMessage, type Quat,
	type RocketReport, type RoomInfo, type RoomSetup, type RoomState, type ServerMessage, type ShipState, type ShotReport, type StartMessage,
} from "../src/net/protocol.ts";
import type { Pilot } from "../src/pilot.ts";
import { cleanName } from "../src/scores.ts";
import { Allowance, hitFits, PLAYER_GUN, REWIND_LIMIT, rocketFits, shotFits, ViewHistory, type FiredShot } from "./checks.ts";
import type { LogEntry, MatchLog, MatchLogs } from "./match-log.ts";

/** Someone in a room, as rooms see them; their connection may drop and come back */
export interface Member {
	readonly id: number;
	name: string;
	/** Secret that lets the same browser take its place back on a new connection */
	readonly token: string;
	/** Which ship and colours they fly (src/entity/player-ships.ts) */
	look: number;
	/** Not a person but a bot flown here, this way */
	bot?: BotTraits;
	/** Goes nowhere while their connection is down */
	send(message: ServerMessage): void;
}

const BOT_NAMES = ["Ada", "Bix", "Cato", "Dot", "Echo", "Finn", "Gus", "Hex"];

type StateMessage = Extract<ClientMessage, { type: "state" }>;

/** Most shots, rockets and hits taken from one state report; a browser reports 30 times a second */
const MAX_SHOTS = 10;
const MAX_ROCKETS = 3;
const MAX_HITS = 20;
/** Gap between players' ships at the start of a co-op level, side by side (m) */
const START_GAP = 8;
/** Deathmatch: places tried for a ship to start from, the one farthest from the others is taken */
const SPAWN_TRIES = 12;
/** Deathmatch: powerups in a cube of a side of size (m): as many to the cubic metre as in the smallest one, coming as often */
function arenaPowerups(size: number): { interval: number; max: number } {
	const volume = (size / MIN_ARENA_SIZE) ** 3;
	return { interval: 12 / volume, max: Math.round(4 * volume) };
}

/** A player's ship, or a rocket one launched: what is on the players' side */
const isFriendly = (target: Entity): boolean => target instanceof PlayerShip || (target instanceof Missile && target.owner instanceof PlayerShip);
/** Co-op: a player's shot passes through teammates and their rockets */
const spareTeammates = (shot: Shot, target: Entity): boolean => shot.owner instanceof PlayerShip && isFriendly(target);

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

	/** Flying a new ship: hands off until the browser says otherwise */
	reset(): void {
		this.target = this.yaw = this.pitch = 0;
	}
}

interface Flyer {
	readonly member: Member;
	/** The ship they fly now; destroyed in a deathmatch, a new one takes its place */
	ship: PlayerShip;
	readonly pilot: RemotePilot | BotPilot;
	readonly allowance: Allowance;
	/** Shots accepted that have not hit anything yet, by ShotReport.n, oldest first */
	readonly shots: Map<number, FiredShot>;
	/** Deathmatch: time until they fly again (s); null while flying */
	respawn: number | null;
	/** Their ship's shields when last looked at, for the recording */
	shields: number;
}

/** Deathmatch: what ends it, and how it stands */
interface Match {
	readonly fragLimit: number;
	timeLeft: number;
	/** Member id → frags */
	readonly frags: Map<number, number>;
}

interface Level {
	/** Counts the room's levels */
	readonly run: number;
	readonly index: number;
	readonly difficulty: DifficultyLevel;
	readonly loop: Loop;
	/** Null in a deathmatch */
	readonly enemies: EnemySpawner | null;
	readonly pods: readonly Pod[];
	/** Member id → their ship */
	readonly flyers: Map<number, Flyer>;
	steps: number;
	outcome: Outcome | null;
	/** Sent when the level ended; again to a player who comes back after that */
	result: OutcomeMessage | null;
	readonly history: ViewHistory;
	/** Null in co-op */
	readonly match: Match | null;
	/** The recording; null when not recording, or once it is over */
	log: MatchLog | null;
	/** Co-op, recording: every enemy that has arrived, with its shields when last looked at and whether it had a pod */
	readonly enemiesSeen: Map<Ship, { shields: number; carrying: boolean }>;
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
const validShip = (state: ShipState | undefined): state is ShipState => (finiteList(state?.p, 3) && finiteList(state.q, 4)
	&& Math.hypot(...state.q) > 0.5 && finite(state.speed) && finite(state.target) && finite(state.yaw) && finite(state.pitch));
const noneDestroyed = () => Object.fromEntries(ENEMY_KINDS.map(kind => [kind, 0])) as Record<EnemyKind, number>;

/**
 * Up to MAX_PLAYERS people flying together. In the lobby the host picks the mode with its settings and starts;
 * during a level or match the room runs the simulation (everything but the players' own flying and shooting),
 * checks what browsers report (./checks.ts) and sends each player a snapshot every SNAPSHOT_STEPS steps.
 */
export class Room {
	readonly code: string;
	readonly members: Member[] = [];
	host: number;
	levelIndex: number;
	difficulty: DifficultyLevel;
	mode: GameMode = "coop";
	fragLimit: number = DEFAULT_FRAG_LIMIT;
	timeLimit: number = DEFAULT_TIME_LIMIT;
	state: RoomState = "lobby";
	/** Reports not believed so far: nothing happens to whoever sent them, but it shows when the limits are too tight */
	readonly refused = { moves: 0, shots: 0, rockets: 0, hits: 0 };

	private level: Level | null = null;
	/** Levels started so far */
	private runs = 0;
	/** Members whose connection dropped → how long ago (s); they keep their place for RECONNECT_GRACE */
	private readonly away = new Map<number, number>();
	/** Ships, also destroyed ones → who flies them */
	private readonly pilots = new WeakMap<Entity, number>();
	private readonly ids = new WeakMap<Entity, number>();
	private readonly byId = new Map<number, Entity>();
	private nextId = 1;
	private queue: Queued[] = [];
	/** Shots already sent as events */
	private readonly announced = new WeakSet<Entity>();
	/** Ships flown here rather than by a browser */
	private readonly flownHere = new WeakSet<Entity>();
	/** People whose pause menu is open */
	private readonly pausedMembers = new Set<number>();
	private readonly logs: MatchLogs | null;

	constructor(code: string, host: Member, levelIndex: number, difficulty: DifficultyLevel, logs: MatchLogs | null = null) {
		this.code = code;
		this.logs = logs;
		this.host = host.id;
		this.levelIndex = levelIndex;
		this.difficulty = difficulty;
		this.members.push(host);
	}

	info(): RoomInfo {
		return {
			code: this.code,
			host: this.host,
			players: this.members.map(({ id, name, look, bot }) => ({ id, name, look, away: this.away.has(id), ...(bot ? { bot: true } : {}) })),
			mode: this.mode,
			level: this.levelIndex,
			difficulty: this.difficulty,
			fragLimit: this.fragLimit,
			timeLimit: this.timeLimit,
			state: this.state,
		};
	}

	/** @returns Why the member cannot join, or null when they joined */
	join(member: Member): string | null {
		if (this.state == "playing") { return `Room ${this.code} is in the middle of a level. Try again when it ends.`; }
		if (this.members.length >= MAX_PLAYERS) {
			/* a person takes the place of a bot */
			const lastBot = this.members.filter(({ bot }) => bot).at(-1);
			if (!lastBot) { return `Room ${this.code} is full: ${MAX_PLAYERS} pilots at most.`; }
			this.members.splice(this.members.indexOf(lastBot), 1);
		}
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
		this.pausedMembers.delete(memberId);

		const flyer = this.level?.flyers.get(memberId);
		if (flyer) {
			flyer.ship.dead = true; /* gone quietly, not exploded */
			this.level!.flyers.delete(memberId);
			this.level!.match?.frags.delete(memberId);
		}

		if (!this.members.some(({ bot }) => !bot)) { /* nobody left but bots */
			this.logRefused();
			this.closeLog();
			this.level = null;
			this.members.length = 0;
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
		this.pausedMembers.delete(memberId);
		const flyer = this.level?.flyers.get(memberId);
		if (flyer) {
			if (flyer.pilot instanceof RemotePilot) { flyer.pilot.yaw = flyer.pilot.pitch = 0; }
			flyer.allowance.release();
		}
		this.pickHost();
		this.broadcastRoom();
	}

	/** The member is back on a new connection: they get the room, and the level as it is now if one is on */
	reconnected(memberId: number): void {
		const member = this.members.find(({ id }) => id == memberId);
		if (!member) { return; }
		this.away.delete(memberId);
		this.pausedMembers.delete(memberId);
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

	/** Between levels: a ship in flight keeps its looks */
	setLook(memberId: number, look: number): void {
		const member = this.members.find(({ id }) => id == memberId);
		if (!member || this.state == "playing") { return; }
		member.look = look;
		this.broadcastRoom();
	}

	/** Host, between levels */
	setup(memberId: number, { mode, level, difficulty, fragLimit, timeLimit }: RoomSetup): void {
		if (memberId != this.host || this.state == "playing") { return; }
		this.mode = mode;
		this.levelIndex = level;
		this.difficulty = difficulty;
		this.fragLimit = fragLimit;
		this.timeLimit = timeLimit;
		this.broadcastRoom();
	}

	/**
	 * Host, between levels: a bot joins, to fight the others in a deathmatch or alongside them in co-op
	 * @param id A member id nobody else has
	 */
	addBot(memberId: number, id: number, traits: BotTraits = botTraits()): void {
		if (memberId != this.host || this.state == "playing" || this.members.length >= MAX_PLAYERS) { return; }
		const taken = new Set(this.members.map(({ name }) => name));
		const name = BOT_NAMES.find(candidate => !taken.has(candidate)) ?? "Bot";
		/* an empty token cannot be resumed; what it is sent goes nowhere */
		this.members.push({ id, name, token: "", look: Math.floor(Math.random() * LOOK_COUNT), bot: traits, send() {} });
		this.broadcastRoom();
	}

	/** Host, between levels */
	removeBot(memberId: number, id: number): void {
		if (memberId != this.host || this.state == "playing") { return; }
		const index = this.members.findIndex(member => member.id == id && member.bot);
		if (index < 0) { return; }
		this.members.splice(index, 1);
		this.broadcastRoom();
	}

	/** Host: start a level (the one set up when not given) */
	start(memberId: number, levelIndex = this.levelIndex): void {
		if (memberId != this.host || this.state == "playing" || !LEVELS[levelIndex]) { return; }
		this.levelIndex = levelIndex;
		const level = this.level = this.createLevel(levelIndex);
		this.state = "playing";
		this.pausedMembers.clear();
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
		if (!level || !flyer) { return; }

		if (!flyer.ship.dead) {
			if (validShip(state) && flyer.pilot instanceof RemotePilot) { this.fly(flyer, flyer.pilot, state); }
			for (const shot of (Array.isArray(shots) ? shots.slice(0, MAX_SHOTS) : [])) { this.fired(flyer, shot); }
			for (const rocket of (Array.isArray(rockets) ? rockets.slice(0, MAX_ROCKETS) : [])) { this.launched(level, flyer, rocket); }
		}
		/* a ship destroyed a moment ago may still have shots on their way */
		for (const hit of (Array.isArray(hits) ? hits.slice(0, MAX_HITS) : [])) { this.claimed(level, flyer, hit); }
	}

	/**
	 * Run the level for the real time elapsed (s); members away longer than RECONNECT_GRACE leave
	 * @returns Whether the room is empty now
	 */
	advance(elapsed: number): boolean {
		if (!this.frozen) {
			for (const { allowance, ship } of this.level?.flyers.values() ?? []) { allowance.refill(elapsed, ship); }
			this.level?.loop.advance(elapsed);
		}
		for (const [id, time] of this.away) {
			if (time + elapsed < RECONNECT_GRACE) {
				this.away.set(id, time + elapsed);
			} else if (this.leave(id)) {
				return true;
			}
		}
		return false;
	}

	/** A person's pause menu opened or closed */
	setPaused(memberId: number, paused: boolean): void {
		if (this.state != "playing" || !this.members.some(({ id, bot }) => id == memberId && !bot)) { return; }
		if (paused) {
			this.pausedMembers.add(memberId);
		} else {
			this.pausedMembers.delete(memberId);
		}
	}

	/** Every person here has their pause menu open: nobody but bots would play on, so the level stands still, its clock too */
	private get frozen(): boolean {
		const present = this.members.filter(({ id, bot }) => !bot && !this.away.has(id));
		return present.length > 0 && present.every(({ id }) => this.pausedMembers.has(id));
	}

	/** Simulation time of the level (s) */
	private get time(): number {
		const level = this.level;
		return (level ? round(level.steps * level.loop.step, 3) : 0);
	}

	/** The host stays while connected; otherwise the first member who is */
	private pickHost(): void {
		const people = this.members.filter(({ bot }) => !bot);
		const present = (id: number) => people.some(member => member.id == id) && !this.away.has(id);
		if (present(this.host)) { return; }
		this.host = (people.find(({ id }) => present(id)) ?? people[0]).id;
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
			arena: (level.match ? { size: level.loop.size!, fragLimit: level.match.fragLimit } : null),
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

	/** A ship ready to fly, not in the scene yet */
	private createShip(memberId: number, pilot: RemotePilot | BotPilot): PlayerShip {
		const ship = new PlayerShip();
		ship.rockets = ROCKET_CAPACITY; /* as the browsers start */
		ship.setPilot(pilot);
		this.pilots.set(ship, memberId);
		if (pilot instanceof BotPilot) { this.flownHere.add(ship); }
		return ship;
	}

	private createLevel(index: number): Level {
		const deathmatch = this.mode == "deathmatch";
		const config = LEVELS[index];
		const loop = new Loop();
		loop.debris = false; /* nobody watches here */
		loop.difficulty = DIFFICULTIES[this.difficulty];
		if (deathmatch) { loop.size = arenaSizeFor(this.members.length); }
		/* players' ships are moved by their browsers, which also handle their bumps */
		loop.rules = (scene, world) => {
			resolveHits(scene, world, (deathmatch ? undefined : spareTeammates));
			if (deathmatch) {
				resolveCollisions(scene, world, ship => !(ship instanceof PlayerShip) || this.flownHere.has(ship)); /* bots bump into the ships of people, who stay put here */
			} else {
				resolveCollisions(scene.filter(entity => !(entity instanceof PlayerShip)), world);
			}
		};

		const flyers = new Map<number, Flyer>();
		this.members.forEach(member => {
			const pilot = (member.bot ? new BotPilot(member.bot, { coop: !deathmatch }) : new RemotePilot());
			const ship = this.createShip(member.id, pilot);
			if (deathmatch) {
				this.placeInArena(ship, loop);
			} else {
				this.placeAtStart(ship, member.id);
			}
			flyers.set(member.id, { member, ship, pilot, allowance: new Allowance(ship), shots: new Map(), respawn: null, shields: ship.shields.value });
			loop.players.push(ship);
		});

		loop.onSound = (name, at, to) => this.onSound(name, at, to);
		loop.onRemove = entity => this.onRemove(entity);
		loop.onStep = () => this.afterStep();
		this.queue = [];
		const run = ++this.runs;
		const log = this.logs?.(this.code, run) ?? null;
		log?.write({
			k: "start", time: new Date().toISOString(), room: this.code, run, mode: this.mode, size: loop.size,
			pilots: this.members.map(({ id, name, bot, look }) => ({ id, name, bot: Boolean(bot), look })),
		});
		const level = {
			run, index, difficulty: this.difficulty, loop, flyers, steps: 0, outcome: null, result: null, history: new ViewHistory(), log, enemiesSeen: new Map(),
		};

		if (deathmatch) {
			loop.scene.push(...loop.players, new PowerupSpawner(loop.players, arenaPowerups(loop.size!)));
			const frags = new Map(this.members.map(({ id }) => [id, 0]));
			return { ...level, enemies: null, pods: [], match: { fragLimit: this.fragLimit, timeLeft: this.timeLimit * 60, frags } };
		}

		const pods = Array.from({ length: config.pods }, () => {
			const pod = new Pod();
			vec3.set(pod.position, (Math.random() - 0.5) * 2 * POD_FIELD, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 2 * POD_FIELD);
			return pod;
		});
		const waves = enemyWaves(config, this.members.length, DIFFICULTIES[this.difficulty].thieves);
		const enemies = new EnemySpawner(loop.players, waves.enemies, { max: waves.max, interval: waves.interval });
		loop.scene.push(...loop.players, ...pods, enemies);
		if (config.powerups) { loop.scene.push(new PowerupSpawner(loop.players, config.powerups)); }
		return { ...level, enemies, pods, match: null };
	}

	/** Co-op: by the pods, side by side with the others, facing the way the level starts */
	private placeAtStart(ship: PlayerShip, memberId: number): void {
		const i = Math.max(0, this.members.findIndex(({ id }) => id == memberId));
		vec3.set(ship.position, (i - (this.members.length - 1) / 2) * START_GAP, 0, 0);
		quat.identity(ship.orientation);
	}

	/** Deathmatch: somewhere in the cube, level, far from the other ships */
	private placeInArena(ship: PlayerShip, loop: Loop): void {
		const others = loop.players.filter(other => other != ship && !other.dead);
		const size = loop.size!;
		const candidate = vec3.create();
		let farthest = -1;
		for (let i = 0; i < SPAWN_TRIES; i++) {
			vec3.set(candidate, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size, (Math.random() - 0.5) * size);
			const gap = Math.min(Infinity, ...others.map(other => vec3.distance(candidate, loop.nearest(other.position, candidate))));
			if (gap > farthest) {
				farthest = gap;
				vec3.copy(ship.position, candidate);
			}
		}
		quat.setAxisAngle(ship.orientation, vec3.fromValues(0, 1, 0), 2 * Math.PI * Math.random());
	}

	/** Deathmatch: back in the fight with a new ship; for everyone else it is just another ship appearing */
	private respawn(level: Level, flyer: Flyer): void {
		const { loop } = level;
		const ship = this.createShip(flyer.member.id, flyer.pilot);
		loop.players[loop.players.indexOf(flyer.ship)] = ship;
		if (level.match) {
			this.placeInArena(ship, loop);
		} else {
			this.placeAtStart(ship, flyer.member.id);
		}
		flyer.pilot.reset();
		flyer.allowance.restart(ship);
		this.log({ k: "spawn", t: this.time, by: flyer.member.id });
		flyer.ship = ship;
		flyer.respawn = null;
		loop.spawn(ship);
	}

	/** The ship goes where the browser says, if it can have flown there */
	private fly({ ship, allowance }: Flyer, pilot: RemotePilot, state: ShipState): void {
		if (!allowance.fly(ship, state.p, state.q)) { this.refused.moves++; }
		const { limit } = ship.engine.speed;
		ship.engine.speed.value = clamp(state.speed, -limit, limit);
		vec3.transformQuat(ship.velocity, vec3.fromValues(0, 0, -ship.engine.speed.value * ship.thrust), ship.orientation);
		pilot.target = clamp(state.target, -limit, limit);
		pilot.yaw = clamp(state.yaw, -1, 1);
		pilot.pitch = clamp(state.pitch, -1, 1);
	}

	/** A shot the ship can have fired is shown to the others, and can hit something later */
	private fired(flyer: Flyer, shot: ShotReport): void {
		if (!finiteList(shot?.p, 3) || !finiteList(shot.v, 3) || !finite(shot.n) || !finite(shot.t)) { return; }
		const { ship, shots } = flyer;
		if (!flyer.allowance.takeShot() || !shotFits(ship, shot)) {
			this.refused.shots++;
			return;
		}

		const now = this.time;
		const oldest = shots.keys().next().value;
		if (oldest !== undefined && now - shots.get(oldest)!.t > 2 * PLAYER_GUN.lifetime) { shots.delete(oldest); }
		const { damage, color } = (ship.effects.power > 0 ? POWER_SHOT : PLAYER_GUN);
		ship.effects.power = Math.max(0, ship.effects.power - 1);
		shots.set(shot.n, { t: clamp(shot.t, now - REWIND_LIMIT, now), p: shot.p, v: shot.v, damage });

		const event: GameEvent = ["shot", now, ...rounded(shot.p as vec3), ...rounded(shot.v as vec3), color, PLAYER_GUN.lifetime, this.id(ship), 0];
		this.queue.push({ event, except: flyer.member.id });
		this.log({ k: "shot", t: now, by: flyer.member.id, p: shot.p, v: shot.v });
	}

	/** A rocket the ship has and can have aimed flies here, like any other missile; the pilot's browser shows its own */
	private launched(level: Level, { ship, member }: Flyer, rocket: RocketReport): void {
		if (!finiteList(rocket?.p, 3) || !finite(rocket.target)) { return; }
		if (ship.rockets <= 0) {
			this.refused.rockets++;
			return;
		}
		ship.rockets--;

		const target = this.byId.get(rocket.target);
		if (!target || target.dead) { return; } /* gone just now: the rocket misses */
		const fair = target instanceof Ship && target != ship && (level.match !== null || !(target instanceof PlayerShip));
		if (!fair || !rocketFits(ship, rocket.p, level.loop.nearest(target.position, ship.position))) {
			this.refused.rockets++;
			return;
		}

		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const missile = new Missile(rocket.p as vec3, nose, ship, target, ROCKET);
		level.loop.spawn(missile);
		this.log({ k: "rocket", t: this.time, by: member.id });
		this.queue.push({ event: ["sound", this.time, "launch", ...rounded(missile.position, 1)], except: member.id });
	}

	/** A player's shot hit something on their screen: it counts if the shot can have been there, and the target then */
	private claimed(level: Level, flyer: Flyer, hit: HitReport): void {
		if (!finite(hit?.shot) || !finite(hit.id) || !finite(hit.t)) { return; }
		const shot = flyer.shots.get(hit.shot);
		flyer.shots.delete(hit.shot); /* a shot hits once */

		const target = this.byId.get(hit.id);
		if (!target || target.dead) { return; } /* gone just now: someone else got there first */

		const friendly = isFriendly(target);
		const at = (hit.t >= this.time - REWIND_LIMIT && hit.t <= this.time ? level.history.positionAt(hit.id, hit.t) : null);
		if (!shot || !at || !target.hittable || target == flyer.ship || (level.match === null && friendly)
			|| (target instanceof Missile && target.owner == flyer.ship)
			|| !hitFits(shot, hit.t, at, target.radius, level.loop)) {
			this.refused.hits++;
			return;
		}

		if (target instanceof Ship || target instanceof Pod) { target.lastHitBy = flyer.ship; }
		if (target instanceof Ship) {
			if (target.absorb(shot.damage)) {
				/* the shooter heard it already */
				this.queue.push({ event: ["sound", this.time, "hit", ...rounded(target.position, 1)], except: flyer.member.id });
				return;
			}
		}
		explode(target, level.loop);
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
			if (member !== undefined) {
				this.queue.push({ event: ["powerup", this.time, entity.kind], to: member });
				this.log({ k: "powerup", t: this.time, by: member, kind: entity.kind });
			}
		}

		if (entity instanceof PlayerShip && entity.exploded) { this.onShipDestroyed(entity); }
		if (this.level?.log && !this.level.match) { this.logRemoved(entity); }
	}

	/** Co-op, recording: an enemy destroyed or gone with a pod, or a pod destroyed by a pilot's fire */
	private logRemoved(entity: Entity): void {
		const t = this.time;
		if (entity instanceof Pirate && entity.escaped) {
			this.log({ k: "escaped", t, on: this.id(entity) });
		} else if (entity instanceof Ship && !(entity instanceof PlayerShip) && entity.exploded) {
			this.log({ k: "downed", t, by: this.shooter(entity), on: this.id(entity) });
		} else if (entity instanceof Pod && entity.exploded) {
			this.log({ k: "podShot", t, by: this.shooter(entity) });
		}
	}

	/** The pilot whose shot or rocket hit it last, if any */
	private shooter(entity: Ship | Pod): number | null {
		return (entity.lastHitBy ? this.pilots.get(entity.lastHitBy) ?? null : null);
	}

	/** Its pilot flies again soon; in a deathmatch, a frag for whoever hit the ship last */
	private onShipDestroyed(ship: PlayerShip): void {
		const level = this.level;
		if (!level || level.outcome) { return; }
		const victim = this.pilots.get(ship)!;
		const flyer = level.flyers.get(victim);
		if (flyer) { flyer.respawn = RESPAWN_DELAY; }
		const match = level.match;
		if (!match) {
			this.log({ k: "kill", t: this.time, by: null, on: victim });
			return;
		}

		const killer = (ship.lastHitBy ? this.pilots.get(ship.lastHitBy) : undefined);
		const counts = (killer !== undefined && killer != victim && level.flyers.has(killer));
		this.log({ k: "kill", t: this.time, by: (counts ? killer! : null), on: victim });
		if (!counts) { return; }
		match.frags.set(killer!, (match.frags.get(killer!) ?? 0) + 1);
		this.queue.push({ event: ["frag", this.time, killer, victim] });
	}

	private afterStep(): void {
		const level = this.level!;
		level.steps++;
		const t = this.time;

		/* enemy shots fly in a straight line: one event each is enough to show them */
		for (const entity of level.loop.scene) {
			if (!(entity instanceof Shot) || this.announced.has(entity)) { continue; }
			this.announced.add(entity);
			const shooter = (entity.owner ? this.pilots.get(entity.owner) : undefined);
			if (entity instanceof Missile) { /* a person's rocket was logged when reported; a missile is shown as an entity anyway */
				if (shooter !== undefined && this.flownHere.has(entity.owner!)) { this.log({ k: "rocket", t, by: shooter }); }
				continue;
			}
			if (shooter !== undefined) { this.log({ k: "shot", t, by: shooter, p: rounded(entity.position), v: rounded(entity.velocity) }); }
			const owner = (entity.owner ? this.id(entity.owner) : 0);
			const event: GameEvent = [
				"shot", t, ...rounded(entity.position), ...rounded(entity.velocity), entity.color, round(entity.timeLeft, 2), owner,
				(entity.hitOnly ? 1 : 0),
			];
			this.queue.push({ event });
		}

		if (level.log) { this.logHits(level, t); }
		if (level.log && !level.match) { this.logEnemies(level, t); }

		let matchResult: MatchResult | undefined;
		let ended = false;
		if (!level.outcome) {
			this.bringBack(level);
			if (level.match) {
				matchResult = this.runMatch(level, level.match);
				if (matchResult) { level.outcome = "match-over"; }
			} else {
				const podsLeft = level.pods.filter(pod => !pod.dead).length;
				level.outcome = levelOutcome({ podsLeft, enemiesLeft: level.enemies!.remaining });
			}
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
				destroyed: (level.enemies ? { ...level.enemies.destroyed } : noneDestroyed()),
				...(matchResult ? { match: matchResult } : {}),
			};
			for (const { member } of level.flyers.values()) { member.send(result); }
			this.broadcastRoom();
			this.logRefused();
			this.log({
				k: "end", t, reason: matchResult?.reason ?? level.outcome!,
				...(level.match ? {} : { pods: [result.podsLeft, result.podsTotal], destroyed: result.destroyed }),
			});
			this.closeLog();
		}
	}

	/** Destroyed ships fly again once their time is up */
	private bringBack(level: Level): void {
		for (const flyer of level.flyers.values()) {
			if (flyer.respawn === null) { continue; }
			flyer.respawn -= level.loop.step;
			if (flyer.respawn <= 0) { this.respawn(level, flyer); }
		}
	}

	/** One step of a deathmatch: the clock runs. @returns How it ended, if it did */
	private runMatch(level: Level, match: Match): MatchResult | undefined {
		match.timeLeft -= level.loop.step;
		const limitReached = Math.max(0, ...match.frags.values()) >= match.fragLimit;
		if (!limitReached && match.timeLeft > 0) { return undefined; }

		const standings = [...level.flyers.values()]
			.map(({ member: { id, name } }) => ({ id, name, frags: match.frags.get(id) ?? 0 }))
			.sort((a, b) => b.frags - a.frags);
		return { reason: (limitReached ? "frags" : "time"), standings };
	}

	/** To the server's log: a browser refused without cheating means the limits in ./checks.ts are too tight */
	private logRefused(): void {
		const { moves, shots, rockets, hits } = this.refused;
		if (moves + shots + rockets + hits) { console.info(`Room ${this.code}: refused ${moves} moves, ${shots} shots, ${rockets} rockets, ${hits} hits`); }
	}

	private log(entry: LogEntry): void {
		this.level?.log?.write(entry);
	}

	private closeLog(): void {
		if (!this.level) { return; }
		this.level.log?.close();
		this.level.log = null;
	}

	/** Shields lost since the last step, and to whom */
	private logHits(level: Level, t: number): void {
		for (const [id, flyer] of level.flyers) {
			const { ship } = flyer;
			const shields = ship.shields.value;
			if (shields < flyer.shields) {
				const by = (ship.lastHitBy ? this.pilots.get(ship.lastHitBy) : undefined) ?? null;
				this.log({ k: "hit", t, by, on: id, damage: flyer.shields - shields });
			}
			flyer.shields = shields;
		}
	}

	/** Co-op: enemies arriving, the shields they lose and to whom, and pods they grab */
	private logEnemies(level: Level, t: number): void {
		for (const entity of level.loop.scene) {
			if (!(entity instanceof Ship) || entity instanceof PlayerShip || entity.dead) { continue; }
			let seen = level.enemiesSeen.get(entity);
			if (!seen) {
				seen = { shields: entity.shields.value, carrying: false };
				level.enemiesSeen.set(entity, seen);
				this.log({ k: "enemy", t, id: this.id(entity), kind: kindOf(entity) ?? "enemy" });
			}
			if (entity.shields.value < seen.shields) {
				this.log({ k: "struck", t, by: this.shooter(entity), on: this.id(entity), damage: round(seen.shields - entity.shields.value, 1) });
			}
			seen.shields = entity.shields.value;
			const carrying = (entity instanceof Pirate && entity.cargo !== null);
			if (carrying && !seen.carrying) { this.log({ k: "grab", t, by: this.id(entity) }); }
			seen.carrying = carrying;
		}
	}

	/** Where every ship is and how it is being flown, the same for people and bots */
	private logFrame(level: Level, t: number): void {
		const s: number[][] = [];
		for (const [id, { ship }] of level.flyers) {
			if (ship.dead) { continue; }
			const { speed, yaw, pitch } = ship.engine;
			const q = ship.orientation;
			s.push([
				id, ...rounded(ship.position), round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4),
				Math.round(ship.shields.value), round(speed.value * ship.thrust, 2), round(speed.target, 2), round(yaw.control, 3), round(pitch.control, 3),
			]);
		}
		if (level.match) {
			this.log({ k: "f", t, s });
			return;
		}
		const e: number[][] = [];
		for (const entity of level.loop.scene) {
			if (!(entity instanceof Ship) || entity instanceof PlayerShip || entity.dead) { continue; }
			e.push([this.id(entity), ...rounded(entity.position), Math.round(entity.shields.value), (entity instanceof Pirate && entity.cargo ? 1 : 0)]);
		}
		this.log({ k: "f", t, s, e });
	}

	private sendSnapshots(level: Level, t: number): void {
		if (level.log) { this.logFrame(level, t); }
		const records: EntityRecord[] = [];
		/** Rockets in flight → who launched them: a browser shows its own by itself */
		const rockets = new Map<number, number | undefined>();
		for (const entity of level.loop.scene) {
			const kind = kindOf(entity);
			if (!kind || entity.dead) { continue; }
			const id = this.id(entity);
			const [x, y, z] = rounded(entity.position);
			const q = entity.orientation;
			records.push([id, kindIndex(kind), x, y, z, round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4), extraOf(entity)]);
			if (kind == "rocket") { rockets.set(id, this.pilots.get((entity as Missile).owner!)); }
		}
		level.history.add(t, records);

		const enemies = level.enemies?.remaining ?? 0;
		const pods = level.pods.filter(pod => !pod.dead).length;
		const match = (level.match ? { match: { left: Math.max(0, round(level.match.timeLeft, 1)), frags: Object.fromEntries(level.match.frags) } } : {});
		const looks = Object.fromEntries([...level.flyers.values()].map(({ member, ship }) => [this.id(ship), member.look]));
		for (const { member, ship } of level.flyers.values()) {
			const ev = this.queue
				.filter(({ to, except }) => (to === undefined || to == member.id) && except != member.id)
				.map(({ event }) => event);
			const e = (rockets.size ? records.filter(([id]) => rockets.get(id) != member.id) : records);
			member.send({ type: "snapshot", t, e, ev, enemies, pods, shields: Math.round(ship.shields.value), ship: this.id(ship), looks, ...match });
		}
		this.queue = [];
	}
}
