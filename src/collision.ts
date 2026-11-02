import { vec3, type ReadonlyVec3 } from "gl-matrix";
import { explode } from "./entity/debris.ts";
import type { Entity } from "./entity/entity.ts";
import { Shot } from "./entity/shot.ts";
import type { World } from "./world.ts";

/** Does the segment a→b pass within `radius` of `center`? */
export function segmentHitsSphere(a: ReadonlyVec3, b: ReadonlyVec3, center: ReadonlyVec3, radius: number): boolean {
	const ab = vec3.subtract(vec3.create(), b, a);
	const ac = vec3.subtract(vec3.create(), center, a);

	const lengthSquared = vec3.squaredLength(ab);
	const t = (lengthSquared > 0 ? Math.min(1, Math.max(0, vec3.dot(ac, ab) / lengthSquared)) : 0);

	const closest = vec3.scaleAndAdd(vec3.create(), a, ab, t);
	return vec3.squaredDistance(closest, center) <= radius * radius;
}

/**
 * Test the path each shot travelled during the last step against bounding spheres of hittable entities.
 * A hit removes the shot and explodes the target.
 */
export function resolveHits(entities: readonly Entity[], world: World): void {
	for (const shot of entities) {
		if (!(shot instanceof Shot) || shot.dead) { continue; }

		for (const target of entities) {
			if (!target.hittable || target.dead || target == shot.owner || !target.radius) { continue; }

			if (segmentHitsSphere(shot.previousPosition, shot.position, target.position, target.radius + shot.radius)) {
				shot.dead = true;
				explode(target, world);
				break;
			}
		}
	}
}
