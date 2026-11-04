import { vec3, type ReadonlyVec3 } from "gl-matrix";
import type { SoundName } from "../audio/sounds.ts";
import { Color } from "../color.ts";
import { circle } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

/** Visual and hit-test radius (m) */
export const SHOT_RADIUS = 0.15;

export class Shot extends Entity {
	/** Position before the last update; the segment to it is used for hit tests */
	readonly previousPosition = vec3.create();
	/** Shots never hit their owner */
	readonly owner: Entity | null;
	/** If set, the only entity this shot can hit */
	target: Entity | null = null;
	/** If set, the shot can only hit these (e.g. a hunter's: the players) */
	hitOnly: readonly Entity[] | null = null;
	/** Shield points taken from a ship on hit */
	readonly damage: number;
	/** Heard when it hits a ship that survives the hit */
	readonly impactSound: SoundName = "hit";
	/** 0xRRGGBB */
	readonly color: number;
	/** Remaining life span (s) */
	private time: number;

	constructor(position: vec3, velocity: vec3, owner: Entity | null, lifetime: number, damage: number, color = 0xffffff) {
		super();

		vec3.copy(this.position, position);
		vec3.copy(this.previousPosition, position);
		vec3.copy(this.velocity, velocity);
		this.owner = owner;
		this.time = lifetime;
		this.damage = damage;
		this.color = color;

		this.geometries = [circle(vec3.create(), SHOT_RADIUS, new Color(color))];
	}

	/** Remaining life span (s) */
	get timeLeft(): number {
		return this.time;
	}

	override shift(offset: ReadonlyVec3): void {
		super.shift(offset);
		vec3.add(this.previousPosition, this.previousPosition, offset);
	}

	override update(dt: number, world: World): void {
		this.time -= dt;
		if (this.time <= 0) {
			this.dead = true;
			return;
		}

		vec3.copy(this.previousPosition, this.position);
		super.update(dt, world);
	}
}
