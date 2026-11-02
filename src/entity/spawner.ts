import { quat, vec3 } from "gl-matrix";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import { Pirate } from "./pirate.ts";
import type { Ship } from "./ship.ts";

export interface SpawnerOptions {
	/** Most pirates alive at once */
	max: number;
	/** Before the first pirate (s) */
	firstDelay: number;
	/** Between pirates, counted while below max (s) */
	interval: number;
	/** Horizontal distance from the center where pirates appear (m) */
	distance: number;
}

const DEFAULTS: SpawnerOptions = {
	max: 2,
	firstDelay: 5,
	interval: 20,
	distance: 70,
};

/** Invisible scene member that sends in pirates, facing the center */
export class PirateSpawner extends Entity {
	private readonly options: SpawnerOptions;
	private readonly player: Ship;
	private readonly pirates: Pirate[] = [];
	private timer: number;

	constructor(player: Ship, options: Partial<SpawnerOptions> = {}) {
		super();
		this.player = player;
		this.options = { ...DEFAULTS, ...options };
		this.timer = this.options.firstDelay;
	}

	override update(dt: number, world: World): void {
		for (let i = this.pirates.length - 1; i >= 0; i--) {
			if (this.pirates[i].dead) { this.pirates.splice(i, 1); }
		}

		if (this.pirates.length >= this.options.max) { return; }

		this.timer -= dt;
		if (this.timer > 0) { return; }
		this.timer = this.options.interval;

		const pirate = new Pirate(this.player);
		const angle = 2 * Math.PI * Math.random();
		const { distance } = this.options;
		vec3.set(pirate.position, Math.cos(angle) * distance, (Math.random() - 0.5) * 10, Math.sin(angle) * distance);

		const towardsCenter = vec3.normalize(vec3.create(), vec3.negate(vec3.create(), pirate.position));
		quat.rotationTo(pirate.orientation, vec3.fromValues(0, 0, -1), towardsCenter);

		this.pirates.push(pirate);
		world.spawn(pirate);
	}
}
