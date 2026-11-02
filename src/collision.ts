import { vec3, type ReadonlyVec3 } from "gl-matrix";
import { explode } from "./entity/debris.ts";
import type { Entity } from "./entity/entity.ts";
import { Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import type { World } from "./world.ts";

/**
 * Where does the segment a→b enter the sphere?
 * @returns Fraction of the segment (0 when a is already inside), or null when it does not touch the sphere
 */
export function segmentSphereEntry(a: ReadonlyVec3, b: ReadonlyVec3, center: ReadonlyVec3, radius: number): number | null {
	const d = vec3.subtract(vec3.create(), b, a);
	const f = vec3.subtract(vec3.create(), a, center);

	const c = vec3.squaredLength(f) - radius * radius;
	if (c <= 0) { return 0; } /* starts inside */

	const qa = vec3.squaredLength(d);
	if (!qa) { return null; } /* a point outside */

	const qb = 2 * vec3.dot(f, d);
	const discriminant = qb * qb - 4 * qa * c;
	if (discriminant < 0) { return null; }

	/* starting outside, both roots have the same sign; the smaller one is the entry */
	const t = (-qb - Math.sqrt(discriminant)) / (2 * qa);
	return (t >= 0 && t <= 1 ? t : null);
}

/** Does the segment a→b pass within `radius` of `center`? */
export function segmentHitsSphere(a: ReadonlyVec3, b: ReadonlyVec3, center: ReadonlyVec3, radius: number): boolean {
	return segmentSphereEntry(a, b, center, radius) !== null;
}

/**
 * Test the path each shot travelled during the last step against bounding spheres of hittable entities;
 * the sphere entered first along the path is hit. A hit removes the shot;
 * ships lose shields and explode when depleted, anything else explodes at once.
 */
export function resolveHits(entities: readonly Entity[], world: World): void {
	for (const shot of entities) {
		if (!(shot instanceof Shot) || shot.dead) { continue; }

		let hit: Entity | null = null;
		let hitAt = Infinity;

		for (const target of entities) {
			if (!target.hittable || target.dead || target == shot.owner || !target.radius) { continue; }
			if (shot.target && target != shot.target) { continue; }

			const t = segmentSphereEntry(shot.previousPosition, shot.position, target.position, target.radius + shot.radius);
			if (t !== null && t < hitAt) {
				hit = target;
				hitAt = t;
			}
		}

		if (!hit) { continue; }

		shot.dead = true;
		const survives = (hit instanceof Ship && hit.absorb(shot.damage));
		if (!survives) { explode(hit, world); }
	}
}
