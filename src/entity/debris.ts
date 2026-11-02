import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { circle, cloneGeometry, type Geometry } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

const COLORS = [0xff1111, 0xff4411, 0xff7711, 0xffaa11, 0xffdd11];

export class Debris extends Entity {
	/** Remaining life span (s) */
	private time = 4 + 3 * Math.random();
	private readonly initialVelocity: vec3;

	constructor(parent: Entity, velocity: vec3) {
		super();

		vec3.copy(this.position, parent.position);

		/* adjust randomly */
		this.initialVelocity = vec3.scale(vec3.create(), velocity, 1 + (Math.random() - 0.5));

		/* do not forget to also add parent's velocity part */
		vec3.scaleAndAdd(this.initialVelocity, this.initialVelocity, parent.velocity, 0.5);
	}

	/** Create new debris representing a geometry component of the parent */
	static fromGeometry(parent: Entity, source: Geometry, explosionForce: number): Debris {
		/* parent models share geometry objects, so work on a copy */
		const geometry = cloneGeometry(source);
		const position = vec3.create();

		/* rotate all points */
		for (const point of geometry.points) { vec3.transformQuat(point, point, parent.orientation); }

		/* compute debris center */
		for (const point of geometry.points) { vec3.add(position, position, point); }
		vec3.scale(position, position, 1 / geometry.points.length);

		/* adjust geometry points with respect to the center */
		for (const point of geometry.points) { vec3.subtract(point, point, position); }

		/* convert parent-relative position to velocity */
		const velocity = vec3.normalize(vec3.create(), position);
		vec3.scale(velocity, velocity, explosionForce);

		const debris = new Debris(parent, velocity);
		debris.geometries = [geometry];

		/* debris shares position with a parent; adjust it to mirror previous geometry position */
		vec3.add(debris.position, debris.position, position);

		/* add some random spin */
		vec3.random(debris.angularVelocity, Math.random() * Math.PI);

		return debris;
	}

	/** Create new debris representing a generic particle circle */
	static particle(parent: Entity, explosionForce: number): Debris {
		const velocity = vec3.random(vec3.create(), explosionForce);

		const debris = new Debris(parent, velocity);

		const color = COLORS[Math.floor(Math.random() * COLORS.length)];
		debris.geometries = [circle(vec3.create(), Math.random() / 4, new Color(color))];

		return debris;
	}

	override update(dt: number, world: World): void {
		this.time -= dt;
		if (this.time <= 0) {
			this.dead = true;
			return;
		}

		vec3.scale(this.velocity, this.initialVelocity, this.time ** 2 / 20);

		super.update(dt, world);
	}
}

/** Destroy the entity, replacing it with debris */
export function explode(entity: Entity, world: World, force = 1): void {
	if (entity.dead) { return; }
	entity.dead = true;

	for (const geometry of entity.geometries) {
		world.spawn(Debris.fromGeometry(entity, geometry, force), Debris.particle(entity, force));
	}
}
