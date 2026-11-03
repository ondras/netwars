import type { ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "./audio/sounds.ts";
import { resolveCollisions, resolveHits } from "./collision.ts";
import { DIFFICULTIES, type Difficulty } from "./difficulty.ts";
import type { Entity } from "./entity/entity.ts";
import type { Ship } from "./entity/ship.ts";
import type { Renderer } from "./render/renderer.ts";
import type { World } from "./world.ts";

export interface LoopOptions {
	/** Fixed simulation step (s) */
	step: number;
	/** Longest frame time simulated at once (s); limits catching up after the tab was in the background */
	maxFrame: number;
}

/** What happens once every entity has moved: by default shots hit and ships bump into things */
export type Rules = (scene: readonly Entity[], world: World) => void;

export const DEFAULT_RULES: Rules = (scene, world) => {
	resolveHits(scene, world);
	resolveCollisions(scene, world);
};

/** Renders on every animation frame, advances the simulation in fixed steps */
export class Loop implements World {
	readonly scene: Entity[] = [];
	readonly players: Ship[] = [];
	difficulty: Difficulty = DIFFICULTIES.normal;
	debris = true;
	rules: Rules = DEFAULT_RULES;
	readonly renderers: Renderer[] = [];
	/** Called after every simulation step */
	onStep: (() => void) | null = null;
	/** Called for every sound effect an entity makes */
	onSound: ((name: SoundName, at?: ReadonlyVec3, to?: Entity) => void) | null = null;
	/** Called for every entity taken out of the scene, once it has died */
	onRemove: ((entity: Entity) => void) | null = null;
	/** While set, the scene is still drawn but the simulation does not advance */
	paused = false;

	private readonly options: LoopOptions;
	private readonly spawned: Entity[] = [];
	private frame = 0;
	private lastTime: number | null = null;
	private accumulator = 0;

	constructor(options: Partial<LoopOptions> = {}) {
		this.options = { step: 0.015, maxFrame: 0.25, ...options };
	}

	get step(): number {
		return this.options.step;
	}

	start(): this {
		if (!this.frame) {
			this.lastTime = null;
			this.frame = requestAnimationFrame(this.tick);
		}
		return this;
	}

	stop(): this {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		return this;
	}

	spawn(...entities: Entity[]): void {
		this.spawned.push(...entities);
	}

	sound(name: SoundName, at?: ReadonlyVec3, to?: Entity): void {
		this.onSound?.(name, at, to);
	}

	/** Remove everything from the scene, releasing renderer resources */
	clear(): void {
		for (const entity of this.scene) {
			for (const renderer of this.renderers) { renderer.deletePrivateData?.(entity); }
		}
		this.scene.length = 0;
		this.spawned.length = 0;
		this.players.length = 0;
	}

	/**
	 * Run as many simulation steps as fit into the elapsed time
	 * @param elapsed Real time since the previous call (s)
	 * @returns Number of steps run
	 */
	advance(elapsed: number): number {
		const { step, maxFrame } = this.options;
		this.accumulator += Math.min(elapsed, maxFrame);

		let steps = 0;
		while (this.accumulator >= step) {
			this.accumulator -= step;
			this.update(step);
			steps++;
		}
		return steps;
	}

	/** Single simulation step */
	update(dt: number): void {
		const scene = this.scene;

		for (const entity of scene) {
			if (entity.simulated) { entity.update(dt, this); }
		}
		this.rules(scene, this);

		let i = 0;
		while (i < scene.length) {
			const entity = scene[i];
			if (entity.dead) {
				scene.splice(i, 1);
				for (const renderer of this.renderers) { renderer.deletePrivateData?.(entity); }
				this.onRemove?.(entity);
			} else {
				i++;
			}
		}

		scene.push(...this.spawned);
		this.spawned.length = 0;

		this.onStep?.();
	}

	private readonly tick = (time: DOMHighResTimeStamp): void => {
		this.frame = requestAnimationFrame(this.tick);

		if (this.lastTime !== null && !this.paused) { this.advance((time - this.lastTime) / 1000); }
		this.lastTime = time;

		for (const renderer of this.renderers) { renderer.render(this.scene); }
	};
}
