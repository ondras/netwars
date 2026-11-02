import type { Entity } from "./entity/entity.ts";
import type { Renderer } from "./render/renderer.ts";

export interface LoopOptions {
	/** Simulation timer period (ms) */
	interval: number;
	/** Fixed simulation step (ms) */
	update: number;
}

export class Loop {
	readonly scene: Entity[] = [];
	readonly renderers: Renderer[] = [];

	private readonly options: LoopOptions;
	private timer = 0;
	private ts = 0;
	private remainingTime = 0;

	constructor(options: Partial<LoopOptions> = {}) {
		this.options = { interval: 30, update: 15, ...options };
	}

	start(): this {
		if (!this.timer) {
			this.ts = Date.now();
			this.remainingTime = 0;
			this.timer = window.setInterval(this.tickUpdate, this.options.interval);
			this.tickRender();
		}
		return this;
	}

	stop(): this {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = 0;
		}
		return this;
	}

	private readonly tickRender = (): void => {
		for (const renderer of this.renderers) { renderer.render(this.scene); }
		requestAnimationFrame(this.tickRender);
	};

	private readonly tickUpdate = (): void => {
		const ts = Date.now();
		this.remainingTime += ts - this.ts;
		this.ts = ts;

		while (this.remainingTime >= this.options.update) {
			this.remainingTime -= this.options.update;
			this.updateScene();
		}
	};

	private updateScene(): void {
		const scene = this.scene;
		const dt = this.options.update / 1000;
		const spawned = scene.map(entity => entity.update(dt));

		let i = 0;
		while (i < scene.length) {
			const entity = scene[i];
			if (entity.dead) {
				scene.splice(i, 1);
				for (const renderer of this.renderers) { renderer.deletePrivateData(entity); }
			} else {
				i++;
			}
		}

		for (const entities of spawned) {
			if (entities?.length) { scene.push(...entities); }
		}
	}
}
