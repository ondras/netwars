import { mat4, quat, vec3 } from "gl-matrix";
import { SoundPlayer } from "./audio/player.ts";
import { Camera } from "./camera.ts";
import { difficulty, difficultyLevel, difficultyOf, type DifficultyLevel } from "./difficulty.ts";
import type { Entity } from "./entity/entity.ts";
import { Hunter } from "./entity/hunter.ts";
import { Pirate } from "./entity/pirate.ts";
import { PlayerShip } from "./entity/player-ship.ts";
import { Pod } from "./entity/pod.ts";
import { ROCKET_CAPACITY, type Ship } from "./entity/ship.ts";
import { EnemySpawner, PowerupSpawner } from "./entity/spawner.ts";
import { enemyWaves, LEVELS, levelOutcome, POD_FIELD, type EnemyKind, type Outcome } from "./levels.ts";
import { TargetLock } from "./lock.ts";
import { DEFAULT_RULES, Loop } from "./loop.ts";
import { mechanics, type Mechanics } from "./mechanics.ts";
import { RESPAWN_DELAY, type ClientMessage, type MatchResult, type OutcomeMessage, type PlayerInfo, type Snapshot, type StartMessage } from "./net/protocol.ts";
import { OnlineSession } from "./net/session.ts";
import { IdlePilot, PlayerPilot, type Pilot } from "./pilot.ts";
import { HUD, type Label } from "./render/hud.ts";
import { WebGLRenderer } from "./render/webgl.ts";
import { SIGHT_REACH, senseFade } from "./senses.ts";
import { effectsVolume, namesShown, shipLook } from "./settings.ts";

/** Camera turn rate while no level is running, and after one ends (rad/s) */
const IDLE_TURN = 0.015;
/** Where the camera follows a teammate from once your ship is gone (m, in their frame: behind and above) */
const SPECTATE_OFFSET = vec3.fromValues(0, 2.5, 10);

/** How long the news of who destroyed whom stays on screen (s) */
const NOTICE_TIME = 3;

/** Rockets lock onto enemy ships only */
export const isRocketTarget = (entity: Entity): boolean => entity instanceof Pirate || entity instanceof Hunter;
/** In a deathmatch that is the other pilots' ships; your own is the one not drawn */
const isOpponent = (entity: Entity): boolean => entity instanceof PlayerShip && entity.visible;

/** Holds course and speed: an online level goes on while its pause menu is open */
const HOLD: Pilot = {
	update(_dt, ship) {
		ship.engine.yaw.control = 0;
		ship.engine.pitch.control = 0;
		ship.trigger = false;
	},
};

export interface LevelResult {
	level: number;
	outcome: Outcome;
	podsLeft: number;
	podsTotal: number;
	destroyed: Record<EnemyKind, number>;
	/** Shield points left */
	shields: number;
	difficulty: DifficultyLevel;
	mechanics: Mechanics;
	/** Played online, with others */
	online: boolean;
	/** How a deathmatch ended */
	match?: MatchResult;
}

interface Session {
	level: number;
	difficulty: DifficultyLevel;
	mechanics: Mechanics;
	ship: Ship;
	outcome: Outcome | null;
	/** Playing alone: the level's enemies and pods are here */
	local: { enemies: EnemySpawner; pods: Pod[] } | null;
	/** Playing online: the server runs the level */
	online: OnlineSession | null;
}

/** Runs levels: builds the scene, tracks the outcome; with no level running, the camera slowly turns among the stars */
export class Game {
	/** Called once per level, when it is won or lost (the scene keeps running) */
	onOutcome: ((result: LevelResult) => void) | null = null;
	/** Who is in the room: names for what the HUD says during a deathmatch */
	pilots: readonly PlayerInfo[] = [];

	private readonly loop = new Loop();
	private readonly camera = new Camera();
	private readonly scene = new WebGLRenderer(this.camera);
	private readonly hud = new HUD(this.camera);
	private readonly sounds = new SoundPlayer(effectsVolume());
	private readonly pilot: PlayerPilot;
	private session: Session | null = null;
	/** An online level's pause menu is open */
	private held = false;
	/** An online level stands still while its pause menu is open: nobody else but bots plays in it */
	private frozen = false;
	/** Followed by the camera once your ship is gone in an online level */
	private watching: Ship | null = null;
	/** Single player: until your destroyed ship flies again (s, of the level's time) */
	private respawnIn: number | null = null;
	/** This player's id, online */
	private me: number | null = null;
	/** Who destroyed whom, and until when (s) that is on screen */
	private notice: { text: string; until: number } | null = null;
	/** When your ship flies again (s), as far as can be told here */
	private backAt: number | null = null;

	constructor(container: HTMLElement) {
		this.pilot = new PlayerPilot(container);

		this.hud.node.className = "hud";
		container.append(this.scene.node, this.hud.node);
		this.loop.renderers.push(this.scene, this.hud);

		this.loop.onStep = () => this.step();
		this.loop.onSound = (name, at, to) => {
			if (!to || to == this.session?.ship) { this.sounds.play(name, at); }
		};
		this.loop.start();
	}

	/** Level being played or just finished */
	get level(): number | null {
		return this.session?.level ?? null;
	}

	/** A level is under way: started, not yet won or lost (it may be paused) */
	get playing(): boolean {
		return this.session !== null && this.session.outcome === null;
	}

	get online(): boolean {
		return this.session?.online != null;
	}

	/** The pause menu is open; alone the level is frozen, online it goes on */
	get paused(): boolean {
		return this.loop.paused || this.held;
	}

	/** @param alone Online, nobody else but bots plays: the server stops the level too, so it stands still here as well */
	pause(alone = false): void {
		if (!this.playing) { return; }
		if (this.session!.online && !alone) {
			this.held = true;
			this.session!.ship.setPilot(HOLD);
		} else {
			this.loop.paused = true;
			this.frozen = this.session!.online !== null;
		}
	}

	resume(): void {
		this.pilot.reset(); /* drop clicks and key presses made while paused */
		if (this.frozen) { this.session?.online?.resync(); }
		this.loop.paused = false;
		if (this.held && this.playing) { this.session!.ship.setPilot(this.pilot); }
		this.held = this.frozen = false;
	}

	/** 0..1 */
	setEffectsVolume(volume: number): void {
		this.sounds.setVolume(volume);
	}

	/** A cannon shot at the current volume; call from an input handler, so that audio may start */
	playTestSound(): void {
		this.sounds.unlock();
		this.sounds.play("cannon");
	}

	/** Call from a click or key press handler: that is when browsers let audio start */
	unlockAudio(): void {
		this.sounds.unlock();
	}

	/** Call from a click or key press handler: that is when browsers let audio start */
	start(level: number): void {
		this.stop();
		this.sounds.unlock();
		const config = LEVELS[level];
		const ship = this.createShip(mechanics());

		const pods = Array.from({ length: config.pods }, () => {
			const pod = new Pod();
			pod.position[0] = (Math.random() - 0.5) * 2 * POD_FIELD;
			pod.position[1] = (Math.random() - 0.5) * 5;
			pod.position[2] = (Math.random() - 0.5) * 2 * POD_FIELD;
			return pod;
		});

		const { scene, players } = this.loop;
		this.loop.difficulty = difficulty();
		const { thieves, burst } = difficulty();
		const waves = enemyWaves(config, 1, thieves, burst);
		const enemies = new EnemySpawner(players, waves.enemies, { max: waves.max, interval: waves.interval, group: waves.group, rest: waves.rest });

		scene.push(ship, ...pods, enemies);
		if (config.powerups) { scene.push(new PowerupSpawner(players, config.powerups)); }

		this.begin({ level, difficulty: difficultyLevel(), mechanics: mechanics(), ship, outcome: null, local: { enemies, pods }, online: null });
	}

	/** Which of the room's levels is being played online (StartMessage.run), if one is */
	get onlineRun(): number | null {
		return this.session?.online?.run ?? null;
	}

	/**
	 * An online level the server has started, or one already under way (after a reload, or a connection
	 * that came back too late for the level it dropped in); the server's snapshots go to receive()
	 */
	startOnline(send: (message: ClientMessage) => void, start: StartMessage, me: number): void {
		this.stop();
		this.sounds.unlock();
		this.me = me;
		this.loop.size = start.arena?.size ?? null;
		this.scene.limitedSight = this.hud.limitedRadar = this.sounds.limitedHearing = start.arena !== null;
		this.scene.dust = start.arena !== null;
		const ship = this.createShip(start.mechanics, start.arena ? isOpponent : isRocketTarget);
		vec3.set(ship.position, ...start.spawn);
		quat.set(ship.orientation, ...start.facing);
		ship.rockets = start.rockets;
		this.loop.difficulty = difficultyOf(start.difficulty, start.mechanics);
		if (start.alive) {
			this.loop.scene.push(ship);
		} else {
			ship.dead = true; /* destroyed while away: watch the others */
		}

		const online = new OnlineSession(this.loop, send, start, me, ship);
		online.onFrag = (killer, victim) => this.tellFrag(killer, victim);
		this.loop.rules = online.rules;
		this.begin({ level: start.level, difficulty: start.difficulty, mechanics: start.mechanics, ship, outcome: null, local: null, online });
	}

	receive(snapshot: Snapshot): void {
		this.session?.online?.receive(snapshot);
	}

	/** The server says the online level is over */
	endOnline({ outcome, podsLeft, podsTotal, destroyed, match }: OutcomeMessage): void {
		if (this.session?.online && !this.session.outcome) { this.finish(this.session, outcome, podsLeft, podsTotal, destroyed, match); }
	}

	/** End the level (if any) and clear the scene */
	stop(): void {
		this.loop.clear();
		this.loop.paused = false;
		this.loop.rules = DEFAULT_RULES;
		this.loop.size = null;
		this.scene.limitedSight = this.hud.limitedRadar = this.sounds.limitedHearing = false;
		this.scene.dust = false;
		this.held = false;
		this.watching = null;
		this.notice = null;
		this.backAt = null;
		this.respawnIn = null;
		this.session = null;
		this.camera.follow(null);
		this.sounds.listener = null;
		this.hud.ship = null;
		this.hud.status = null;
		this.hud.lines = null;
		this.hud.notices = null;
		this.hud.labels = null;
	}

	/** Your ship: flown from the cockpit, so never drawn */
	private createShip(mechanics: Mechanics, isTarget: (entity: Entity) => boolean = isRocketTarget): PlayerShip {
		const ship = new PlayerShip(shipLook(), mechanics);
		ship.visible = false;
		ship.setPilot(this.pilot);
		ship.rockets = ROCKET_CAPACITY; /* a full rack every level */
		ship.targetLock = new TargetLock(isTarget);
		this.pilot.reset();
		this.loop.players.push(ship);
		return ship;
	}

	private begin(session: Session): void {
		this.session = session;
		this.camera.follow(session.ship);
		this.sounds.listener = session.ship;
		this.hud.ship = session.ship;
		this.hud.status = () => this.status();
		this.hud.notices = () => this.matchNotices();
		if (session.online) { this.hud.labels = () => this.nameLabels(); }
		if (session.online?.arena) { this.hud.lines = () => this.matchScores(); }
	}

	private status(): string {
		const { level, local, online } = this.session!;
		if (online?.arena) {
			const left = Math.ceil(online.match?.left ?? 0);
			const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
			return `DEATHMATCH · ${clock} · FIRST TO ${online.arena.fragLimit}`;
		}
		const name = `LEVEL ${level + 1} ${LEVELS[level].name.toUpperCase()}`;
		if (online) {
			const flying = online.players.filter(ship => !ship.dead).length;
			return `${name} · ENEMIES ${online.enemies} · PODS ${online.pods}/${online.podsTotal} · PILOTS ${flying}`;
		}
		const podsLeft = local!.pods.filter(pod => !pod.dead).length;
		return `${name} · ENEMIES ${local!.enemies.remaining} · PODS ${podsLeft}/${local!.pods.length}`;
	}

	/** The other pilots' names over their ships, unless turned off; in a deathmatch they fade out with the ships */
	private nameLabels(): Label[] {
		const online = this.session?.online;
		if (!online || !namesShown()) { return []; }
		return online.players.flatMap(ship => {
			const pilot = online.pilotOf(ship);
			if (ship == online.ship || ship.dead || pilot === undefined) { return []; }
			const fade = (this.scene.limitedSight ? senseFade(vec3.distance(ship.position, this.camera.position), SIGHT_REACH) : 1);
			return (fade > 0 ? [{ at: ship.position, text: this.pilotName(pilot), fade }] : []);
		});
	}

	private pilotName(id: number): string {
		return this.pilots.find(pilot => pilot.id == id)?.name ?? "Someone";
	}

	/** Most frags first */
	private matchScores(): string[] {
		const frags = this.session?.online?.match?.frags ?? {};
		return this.pilots
			.map(({ id, name }) => ({ name: (id == this.me ? "YOU" : name.toUpperCase()), frags: frags[id] ?? 0 }))
			.sort((a, b) => b.frags - a.frags)
			.map(({ name, frags }) => `${frags} ${name}`);
	}

	private tellFrag(killer: number, victim: number): void {
		const text = (killer == this.me
			? `You destroyed ${this.pilotName(victim)}`
			: victim == this.me ? `Destroyed by ${this.pilotName(killer)}` : `${this.pilotName(killer)} destroyed ${this.pilotName(victim)}`);
		this.notice = { text, until: performance.now() / 1000 + NOTICE_TIME };
	}

	private matchNotices(): string[] {
		const now = performance.now() / 1000;
		const session = this.session;
		const lines = (this.notice && now < this.notice.until ? [this.notice.text] : []);
		if (session?.ship.dead && !session.outcome) {
			this.backAt ??= now + RESPAWN_DELAY;
			const left = (session.local ? this.respawnIn ?? RESPAWN_DELAY : this.backAt - now);
			lines.push(`Back in ${Math.max(1, Math.ceil(left))} s`);
		} else {
			this.backAt = null;
		}
		return lines;
	}

	private step(): void {
		const session = this.session;

		if (!session) {
			mat4.rotateY(this.camera.vMatrix, this.camera.vMatrix, IDLE_TURN * this.loop.step);
			return;
		}

		if (session.online) {
			session.online.step(this.loop.step);
			this.spectate(session.online);
			return; /* the server says when the level is over */
		}

		if (session.outcome) { return; }

		const { enemies, pods } = session.local!;
		if (session.ship.dead) { this.comeBack(session.ship); }
		const podsLeft = pods.filter(pod => !pod.dead).length;
		const outcome = levelOutcome({ podsLeft, enemiesLeft: enemies.remaining });
		if (outcome) { this.finish(session, outcome, podsLeft, pods.length, enemies.destroyed); }
	}

	/** Single player: a destroyed ship flies again RESPAWN_DELAY later, where the level started */
	private comeBack(ship: PlayerShip): void {
		this.respawnIn = (this.respawnIn ?? RESPAWN_DELAY) - this.loop.step;
		if (this.respawnIn > 0) { return; }
		this.respawnIn = null;
		ship.revive();
		vec3.zero(ship.position);
		vec3.zero(ship.velocity);
		quat.identity(ship.orientation);
		ship.targetLock?.clear();
		this.pilot.reset();
		this.loop.spawn(ship);
	}

	/** Once your ship is gone, the camera follows a teammate still flying, until yours flies again; in a deathmatch it stays */
	private spectate(online: OnlineSession): void {
		if (online.arena) { return; }
		if (!online.ship.dead) {
			if (this.watching) {
				this.watching = null;
				this.camera.follow(online.ship);
				this.sounds.listener = online.ship;
			}
			return;
		}
		if (this.watching && !this.watching.dead) { return; }
		this.watching = online.teammates[0] ?? null;
		if (!this.watching) { return; }
		this.camera.follow(this.watching, SPECTATE_OFFSET);
		this.sounds.listener = this.watching;
	}

	private finish(session: Session, outcome: Outcome, podsLeft: number, podsTotal: number, destroyed: Record<EnemyKind, number>, match?: MatchResult): void {
		session.outcome = outcome;
		this.held = false;
		/* the mouse is for the result panel now: the ship drifts to a stop, turning slowly */
		session.ship.setPilot(new IdlePilot(IDLE_TURN));
		session.ship.targetLock = null;
		this.onOutcome?.({
			level: session.level,
			outcome,
			podsLeft,
			podsTotal,
			destroyed,
			shields: (session.ship.dead ? 0 : session.ship.shields.value),
			difficulty: session.difficulty,
			mechanics: session.mechanics,
			online: session.online !== null,
			...(match ? { match } : {}),
		});
	}
}
