import { mat4 } from "gl-matrix";
import { SoundPlayer } from "./audio/player.ts";
import { Camera } from "./camera.ts";
import { Hunter } from "./entity/hunter.ts";
import { Pirate } from "./entity/pirate.ts";
import { TargetLock } from "./lock.ts";
import { effectsVolume } from "./settings.ts";
import { Pod } from "./entity/pod.ts";
import { ROCKET_CAPACITY, Ship } from "./entity/ship.ts";
import { EnemySpawner, PowerupSpawner } from "./entity/spawner.ts";
import { difficultyLevel, type DifficultyLevel } from "./difficulty.ts";
import { LEVELS, levelOutcome, type EnemyKind, type Outcome } from "./levels.ts";
import { Loop } from "./loop.ts";
import { IdlePilot, PlayerPilot } from "./pilot.ts";
import { HUD } from "./render/hud.ts";
import { WebGLRenderer } from "./render/webgl.ts";

/** Horizontal half-size of the square pods are scattered in (m) */
const POD_FIELD = 25;
/** Camera turn rate while no level is running, and after one ends (rad/s) */
const IDLE_TURN = 0.015;

export interface LevelResult {
	level: number;
	outcome: Outcome;
	podsLeft: number;
	podsTotal: number;
	destroyed: Record<EnemyKind, number>;
	/** Shield points left */
	shields: number;
	difficulty: DifficultyLevel;
}

interface Session {
	level: number;
	difficulty: DifficultyLevel;
	ship: Ship;
	enemies: EnemySpawner;
	pods: Pod[];
	outcome: Outcome | null;
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

	constructor(container: HTMLElement) {
		this.pilot = new PlayerPilot(container);

		const scene = new WebGLRenderer(this.camera);
		this.hud.node.className = "hud";
		container.append(scene.node, this.hud.node);
		this.loop.renderers.push(scene, this.hud);

		this.loop.onStep = () => this.step();
		this.loop.onSound = (name, at) => this.sounds.play(name, at);
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

	get paused(): boolean {
		return this.loop.paused;
	}

	/** Freeze the level; the scene stays on screen */
	pause(): void {
		if (this.playing) { this.loop.paused = true; }
	}

	resume(): void {
		this.pilot.reset(); /* drop clicks and key presses made while paused */
		this.loop.paused = false;
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
	start(level: number): void {
		this.stop();
		this.sounds.unlock();
		const config = LEVELS[level];

		const ship = new Ship().fromNSH("missile");
		ship.visible = false; /* cockpit view */
		ship.setPilot(this.pilot);
		ship.rockets = ROCKET_CAPACITY; /* a full rack every level */
		ship.targetLock = new TargetLock(entity => entity instanceof Pirate || entity instanceof Hunter);
		this.pilot.reset();

		const pods = Array.from({ length: config.pods }, () => {
			const pod = new Pod();
			pod.position[0] = (Math.random() - 0.5) * 2 * POD_FIELD;
			pod.position[1] = (Math.random() - 0.5) * 5;
			pod.position[2] = (Math.random() - 0.5) * 2 * POD_FIELD;
			return pod;
		});

		const enemies = new EnemySpawner(ship, config.enemies, { max: config.maxEnemies, interval: config.enemyInterval });

		const { scene } = this.loop;
		scene.push(ship, ...pods, enemies);
		if (config.powerups) { scene.push(new PowerupSpawner(ship, config.powerups)); }

		this.session = { level, difficulty: difficultyLevel(), ship, enemies, pods, outcome: null };
		this.camera.follow(ship);
		this.sounds.listener = ship;
		this.hud.ship = ship;
		this.hud.status = () => this.status();
	}

	/** End the level (if any) and clear the scene */
	stop(): void {
		this.loop.clear();
		this.loop.paused = false;
		this.session = null;
		this.camera.follow(null);
		this.sounds.listener = null;
		this.hud.ship = null;
		this.hud.status = null;
	}

	private status(): string {
		const { level, enemies, pods } = this.session!;
		const podsLeft = pods.filter(pod => !pod.dead).length;
		return `LEVEL ${level + 1} ${LEVELS[level].name.toUpperCase()} · ENEMIES ${enemies.remaining} · PODS ${podsLeft}/${pods.length}`;
	}

	private step(): void {
		const session = this.session;

		if (!session) {
			mat4.rotateY(this.camera.vMatrix, this.camera.vMatrix, IDLE_TURN * 0.015);
			return;
		}

		if (session.outcome) { return; }

		const podsLeft = session.pods.filter(pod => !pod.dead).length;
		const outcome = levelOutcome({ shipDead: session.ship.dead, podsLeft, enemiesLeft: session.enemies.remaining });
		if (!outcome) { return; }

		session.outcome = outcome;
		/* the mouse is for the result panel now: the ship drifts to a stop, turning slowly */
		session.ship.setPilot(new IdlePilot(IDLE_TURN));
		session.ship.targetLock = null;
		this.onOutcome?.({
			level: session.level,
			outcome,
			podsLeft,
			podsTotal: session.pods.length,
			destroyed: session.enemies.destroyed,
			shields: session.ship.shields.value,
			difficulty: session.difficulty,
		});
	}
}
