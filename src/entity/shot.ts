import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { circle } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

/** Visual and hit-test radius (m) */
const RADIUS = 0.15;

export class Shot extends Entity {
	/** Position before the last update; the segment to it is used for hit tests */
	readonly previousPosition = vec3.create();
	/** Shots never hit their owner */
	readonly owner: Entity | null;
	/** If set, the only entity this shot can hit */
	target: Entity | null = null;
	/** Shield points taken from a ship on hit */
	readonly damage: number;
	/** Remaining life span (s) */
	private time: number;

	constructor(position: vec3, velocity: vec3, owner: Entity | null, lifetime: number, damage: number) {
		super();

		vec3.copy(this.position, position);
		vec3.copy(this.previousPosition, position);
		vec3.copy(this.velocity, velocity);
		this.owner = owner;
		this.time = lifetime;
		this.damage = damage;

		this.geometries = [circle(vec3.create(), RADIUS, new Color(0xffffff))];
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
