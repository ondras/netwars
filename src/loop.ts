import { resolveHits } from "./collision.ts";
import type { Entity } from "./entity/entity.ts";
import type { Renderer } from "./render/renderer.ts";
import type { World } from "./world.ts";

export interface LoopOptions {
	/** Fixed simulation step (s) */
	step: number;
	/** Longest frame time simulated at once (s); limits catching up after the tab was in the background */
	maxFrame: number;
}

/** Renders on every animation frame, advances the simulation in fixed steps */
export class Loop implements World {
	readonly scene: Entity[] = [];
	readonly renderers: Renderer[] = [];

	private readonly options: LoopOptions;
	private readonly spawned: Entity[] = [];
	private frame = 0;
	private lastTime: number | null = null;
	private accumulator = 0;

	constructor(options: Partial<LoopOptions> = {}) {
		this.options = { step: 0.015, maxFrame: 0.25, ...options };
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

		for (const entity of scene) { entity.update(dt, this); }
		resolveHits(scene, this);

		let i = 0;
		while (i < scene.length) {
			const entity = scene[i];
			if (entity.dead) {
				scene.splice(i, 1);
				for (const renderer of this.renderers) { renderer.deletePrivateData?.(entity); }
			} else {
				i++;
			}
		}

		scene.push(...this.spawned);
		this.spawned.length = 0;
	}

	private readonly tick = (time: DOMHighResTimeStamp): void => {
		this.frame = requestAnimationFrame(this.tick);

		if (this.lastTime !== null) { this.advance((time - this.lastTime) / 1000); }
		this.lastTime = time;

		for (const renderer of this.renderers) { renderer.render(this.scene); }
	};
}
