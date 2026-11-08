import { vec3, type ReadonlyVec3 } from "gl-matrix";
import { explode } from "./entity/debris.ts";
import type { Entity } from "./entity/entity.ts";
import { Pod } from "./entity/pod.ts";
import { Ship } from "./entity/ship.ts";
import { Shot } from "./entity/shot.ts";
import type { World } from "./world.ts";

/** Part of the bounding spheres' reach at which bodies touch: models fill their spheres loosely */
export const CONTACT = 0.75;

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
 * @param spares What a shot passes through: in co-op, players' shots and their teammates
 */
export function resolveHits(entities: readonly Entity[], world: World, spares: (shot: Shot, target: Entity) => boolean = () => false): void {
	for (const shot of entities) {
		if (!(shot instanceof Shot) || shot.dead) { continue; }

		let hit: Entity | null = null;
		let hitAt = Infinity;

		for (const target of entities) {
			if (!target.hittable || target.dead || target == shot.owner || !target.radius) { continue; }
			if (shot.target && target != shot.target) { continue; }
			if (shot.hitOnly && !shot.hitOnly.includes(target)) { continue; }
			if (target instanceof Shot && target.owner == shot.owner) { continue; } /* never your own rockets */
			if (spares(shot, target)) { continue; }

			const center = world.nearest(target.position, shot.position);
			const t = segmentSphereEntry(shot.previousPosition, shot.position, center, target.radius + shot.radius);
			if (t !== null && t < hitAt) {
				hit = target;
				hitAt = t;
			}
		}

		if (!hit) { continue; }

		shot.dead = true;
		if (hit instanceof Ship || hit instanceof Pod) { hit.lastHitBy = shot.owner; }
		const survives = (hit instanceof Ship && hit.absorb(shot.damage));
		if (survives) {
			world.sound(shot.impactSound, hit.position);
		} else {
			explode(hit, world);
		}
	}
}

const isBody = (entity: Entity): entity is Ship | Pod => (entity instanceof Ship || entity instanceof Pod) && !entity.dead && entity.radius > 0;
const carries = (carrier: Entity, cargo: Entity) => (cargo instanceof Pod && cargo.carrier == carrier);

/**
 * Ships that touch a ship or a pod are pushed apart until they just touch (pods stay put)
 * and bump: they slow down and spin for a moment. A pirate and the pod it carries do not collide.
 * @param movable Ships this may push and bump; the others stay put like pods (in online play, ships flown on
 * another computer are moved there)
 */
export function resolveCollisions(entities: readonly Entity[], world: World, movable: (ship: Ship) => boolean = () => true): void {
	const bodies = entities.filter(isBody);
	const moves = (body: Ship | Pod): body is Ship => body instanceof Ship && movable(body);

	for (let i = 0; i < bodies.length; i++) {
		for (let j = i + 1; j < bodies.length; j++) {
			const a = bodies[i];
			const b = bodies[j];
			const aMoves = moves(a);
			const bMoves = moves(b);
			if (!(aMoves || bMoves) || carries(a, b) || carries(b, a)) { continue; }

			const reach = CONTACT * (a.radius + b.radius);
			const away = vec3.subtract(vec3.create(), a.position, b.position); /* from b towards a */
			const distance = vec3.length(away);
			if (distance >= reach) { continue; }

			if (distance > 1e-6) { vec3.scale(away, away, 1 / distance); } else { vec3.set(away, 0, 1, 0); }
			const overlap = reach - distance;
			const share = (aMoves && bMoves ? 0.5 : 1);
			if (aMoves) { vec3.scaleAndAdd(a.position, a.position, away, overlap * share); }
			if (bMoves) { vec3.scaleAndAdd(b.position, b.position, away, -overlap * share); }

			const bumped = [a, b].map(body => moves(body) && body.bump());
			if (bumped.includes(true)) { world.sound("impact", vec3.lerp(vec3.create(), a.position, b.position, 0.5)); }
		}
	}
}
