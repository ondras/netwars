import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { circle, cloneGeometry, type Geometry } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";

const COLORS = [0xff1111, 0xff4411, 0xff7711, 0xffaa11, 0xffdd11];

/** Typical speed of debris flying away from the explosion center (m/s) */
export const EXPLOSION_SPEED = 6;

/** A ship with more faces and lines than this leaves a sample of them: each piece of debris is an entity with its own buffers */
export const MAX_DEBRIS = 60;

/** Life span range (s) */
const MIN_LIFETIME = 2;
const MAX_LIFETIME = 3;

/** Flies away at a constant speed, then disappears */
export class Debris extends Entity {
	/** Remaining life span (s) */
	private time = MIN_LIFETIME + (MAX_LIFETIME - MIN_LIFETIME) * Math.random();

	constructor(parent: Entity, velocity: vec3) {
		super();

		vec3.copy(this.position, parent.position);

		/* adjust randomly */
		vec3.scale(this.velocity, velocity, 1 + (Math.random() - 0.5));

		/* do not forget to also add parent's velocity part */
		vec3.scaleAndAdd(this.velocity, this.velocity, parent.velocity, 0.5);
	}

	/** Create new debris representing a geometry component of the parent */
	static fromGeometry(parent: Entity, source: Geometry, explosionForce: number): Debris {
		/* parent models share geometry objects, so work on a copy */
		const geometry = cloneGeometry(source);
		const position = vec3.create();

		/* scale and rotate all points, as the parent's model matrix did */
		for (const point of geometry.points) {
			vec3.multiply(point, point, parent.scale);
			vec3.transformQuat(point, point, parent.orientation);
		}

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

		super.update(dt, world);
	}
}

/**
 * Destroy the entity, replacing it with debris
 * @param force Typical debris speed (m/s)
 */
export function explode(entity: Entity, world: World, force = EXPLOSION_SPEED): void {
	if (entity.dead) { return; }
	entity.dead = true;
	entity.exploded = true;
	world.sound("explosion", entity.position);
	if (!world.debris) { return; }

	const { geometries } = entity;
	const pieces = Math.min(geometries.length, MAX_DEBRIS);
	for (let i = 0; i < pieces; i++) {
		world.spawn(Debris.fromGeometry(entity, geometries[Math.floor(i * geometries.length / pieces)], force), Debris.particle(entity, force));
	}
}
