import { mat4, quat, vec3 } from "gl-matrix";
import { SoundPlayer } from "./audio/player.ts";
import { Camera } from "./camera.ts";
import { DIFFICULTIES, difficulty, difficultyLevel, type DifficultyLevel } from "./difficulty.ts";
import type { Entity } from "./entity/entity.ts";
import { Hunter } from "./entity/hunter.ts";
import { Pirate } from "./entity/pirate.ts";
import { PlayerShip } from "./entity/player-ship.ts";
import { Pod } from "./entity/pod.ts";
import { ROCKET_CAPACITY, type Ship } from "./entity/ship.ts";
import { EnemySpawner, PowerupSpawner } from "./entity/spawner.ts";
import { LEVELS, levelOutcome, POD_FIELD, type EnemyKind, type Outcome } from "./levels.ts";
import { TargetLock } from "./lock.ts";
import { DEFAULT_RULES, Loop } from "./loop.ts";
import type { ClientMessage, OutcomeMessage, Snapshot, StartMessage } from "./net/protocol.ts";
import { OnlineSession } from "./net/session.ts";
import { IdlePilot, PlayerPilot, type Pilot } from "./pilot.ts";
import { HUD } from "./render/hud.ts";
import { WebGLRenderer } from "./render/webgl.ts";
import { effectsVolume } from "./settings.ts";

/** Camera turn rate while no level is running, and after one ends (rad/s) */
const IDLE_TURN = 0.015;
/** Where the camera follows a teammate from once your ship is gone (m, in their frame: behind and above) */
const SPECTATE_OFFSET = vec3.fromValues(0, 2.5, 10);

/** Rockets lock onto enemy ships only */
export const isRocketTarget = (entity: Entity): boolean => entity instanceof Pirate || entity instanceof Hunter;

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
	/** Played online, with others */
	online: boolean;
}

interface Session {
	level: number;
	difficulty: DifficultyLevel;
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

	private readonly loop = new Loop();
	private readonly camera = new Camera();
	private readonly hud = new HUD(this.camera);
	private readonly sounds = new SoundPlayer(effectsVolume());
	private readonly pilot: PlayerPilot;
	private session: Session | null = null;
	/** An online level's pause menu is open */
	private held = false;
	/** Followed by the camera once your ship is gone in an online level */
	private watching: Ship | null = null;

	constructor(container: HTMLElement) {
		this.pilot = new PlayerPilot(container);

		const scene = new WebGLRenderer(this.camera);
		this.hud.node.className = "hud";
		container.append(scene.node, this.hud.node);
		this.loop.renderers.push(scene, this.hud);

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

	pause(): void {
		if (!this.playing) { return; }
		if (this.session!.online) {
			this.held = true;
			this.session!.ship.setPilot(HOLD);
		} else {
			this.loop.paused = true;
		}
	}

	resume(): void {
		this.pilot.reset(); /* drop clicks and key presses made while paused */
		this.loop.paused = false;
		if (this.held && this.playing) { this.session!.ship.setPilot(this.pilot); }
		this.held = false;
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
		const ship = this.createShip();

		const pods = Array.from({ length: config.pods }, () => {
			const pod = new Pod();
			pod.position[0] = (Math.random() - 0.5) * 2 * POD_FIELD;
			pod.position[1] = (Math.random() - 0.5) * 5;
			pod.position[2] = (Math.random() - 0.5) * 2 * POD_FIELD;
			return pod;
		});

		const { scene, players } = this.loop;
		this.loop.difficulty = difficulty();
		const enemies = new EnemySpawner(players, config.enemies, { max: config.maxEnemies, interval: config.enemyInterval });

		scene.push(ship, ...pods, enemies);
		if (config.powerups) { scene.push(new PowerupSpawner(players, config.powerups)); }

		this.begin({ level, difficulty: difficultyLevel(), ship, outcome: null, local: { enemies, pods }, online: null });
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
		const ship = this.createShip();
		vec3.set(ship.position, ...start.spawn);
		quat.set(ship.orientation, ...start.facing);
		ship.rockets = start.rockets;
		this.loop.difficulty = DIFFICULTIES[start.difficulty];
		if (start.alive) {
			this.loop.scene.push(ship);
		} else {
			ship.dead = true; /* destroyed while away: watch the others */
		}

		const online = new OnlineSession(this.loop, send, start, me, ship);
		this.loop.rules = online.rules;
		this.begin({ level: start.level, difficulty: start.difficulty, ship, outcome: null, local: null, online });
	}

	receive(snapshot: Snapshot): void {
		this.session?.online?.receive(snapshot);
	}

	/** The server says the online level is over */
	endOnline({ outcome, podsLeft, podsTotal, destroyed }: OutcomeMessage): void {
		if (this.session?.online && !this.session.outcome) { this.finish(this.session, outcome, podsLeft, podsTotal, destroyed); }
	}

	/** End the level (if any) and clear the scene */
	stop(): void {
		this.loop.clear();
		this.loop.paused = false;
		this.loop.rules = DEFAULT_RULES;
		this.held = false;
		this.watching = null;
		this.session = null;
		this.camera.follow(null);
		this.sounds.listener = null;
		this.hud.ship = null;
		this.hud.status = null;
	}

	/** Your ship: flown from the cockpit, so never drawn */
	private createShip(): PlayerShip {
		const ship = new PlayerShip();
		ship.visible = false;
		ship.setPilot(this.pilot);
		ship.rockets = ROCKET_CAPACITY; /* a full rack every level */
		ship.targetLock = new TargetLock(isRocketTarget);
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
	}

	private status(): string {
		const { level, local, online } = this.session!;
		const name = `LEVEL ${level + 1} ${LEVELS[level].name.toUpperCase()}`;
		if (online) {
			const flying = online.players.filter(ship => !ship.dead).length;
			return `${name} · ENEMIES ${online.enemies} · PODS ${online.pods}/${online.podsTotal} · PILOTS ${flying}`;
		}
		const podsLeft = local!.pods.filter(pod => !pod.dead).length;
		return `${name} · ENEMIES ${local!.enemies.remaining} · PODS ${podsLeft}/${local!.pods.length}`;
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
		const podsLeft = pods.filter(pod => !pod.dead).length;
		const outcome = levelOutcome({ shipDead: session.ship.dead, podsLeft, enemiesLeft: enemies.remaining });
		if (outcome) { this.finish(session, outcome, podsLeft, pods.length, enemies.destroyed); }
	}

	/** Once your ship is gone, the camera follows a teammate still flying */
	private spectate(online: OnlineSession): void {
		if (!online.ship.dead || (this.watching && !this.watching.dead)) { return; }
		this.watching = online.teammates[0] ?? null;
		if (!this.watching) { return; }
		this.camera.follow(this.watching, SPECTATE_OFFSET);
		this.sounds.listener = this.watching;
	}

	private finish(session: Session, outcome: Outcome, podsLeft: number, podsTotal: number, destroyed: Record<EnemyKind, number>): void {
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
			online: session.online !== null,
		});
	}
}
