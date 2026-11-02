import { quat, vec3 } from "gl-matrix";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import { Pirate } from "./pirate.ts";
import { Pod } from "./pod.ts";
import type { Ship } from "./ship.ts";

export interface SpawnerOptions {
	/** Most pirates alive at once */
	max: number;
	/** Before the first pirate (s) */
	firstDelay: number;
	/** Between pirates, counted while below max (s) */
	interval: number;
	/** Pirates never appear closer than this to the player, horizontally (m) */
	minDistance: number;
	/** How far beyond the far edge of the pod field pirates appear (m) */
	behind: number;
	/** Random deviation from the line player → pods → pirate, either way (rad) */
	spread: number;
}

const DEFAULTS: SpawnerOptions = {
	max: 2,
	firstDelay: 5,
	interval: 20,
	minDistance: 120,
	behind: 40,
	spread: 0.35,
};

/**
 * Invisible scene member that sends in pirates from beyond the pods as seen by the player,
 * so that the pods are in the line of fire. Without free pods, pirates appear at minDistance in any direction.
 */
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
		const pods = world.scene.filter((entity): entity is Pod => entity instanceof Pod && !entity.dead && !entity.carrier);
		const lookAt = this.place(pirate.position, pods);

		const heading = vec3.subtract(vec3.create(), lookAt, pirate.position);
		if (vec3.length(heading) > 1) {
			quat.rotationTo(pirate.orientation, vec3.fromValues(0, 0, -1), vec3.normalize(heading, heading));
		}

		this.pirates.push(pirate);
		world.spawn(pirate);
	}

	/**
	 * Set the spawn position
	 * @returns Point the pirate should face
	 */
	private place(position: vec3, pods: readonly Pod[]): vec3 {
		const { minDistance, behind, spread } = this.options;
		const player = this.player.position;
		const height = (Math.random() - 0.5) * 10;

		if (!pods.length) {
			const direction = randomHorizontal();
			vec3.scaleAndAdd(position, player, direction, minDistance);
			position[1] += height;
			return vec3.clone(player);
		}

		/* pod field: center and horizontal radius */
		const center = vec3.create();
		for (const pod of pods) { vec3.add(center, center, pod.position); }
		vec3.scale(center, center, 1 / pods.length);
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

		position[1] = center[1] + height;
		return center;
	}
}

function randomHorizontal(): vec3 {
	const angle = 2 * Math.PI * Math.random();
	return vec3.fromValues(Math.cos(angle), 0, Math.sin(angle));
}
