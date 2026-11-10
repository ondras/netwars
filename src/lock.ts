import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";

const degrees = (angle: number) => angle * Math.PI / 180;

/** Farthest target that can be locked (m); a rocket flies about 175 m */
export const LOCK_RANGE = 100;
/** A target starts locking within this angle off the nose (rad) */
export const LOCK_CONE = degrees(8);
/** A target locking or locked is lost beyond this angle off the nose (rad) */
export const HOLD_CONE = degrees(14);
/** Time a target has to stay ahead to lock (s) */
export const LOCK_TIME = 0.8;

/** Angle between the observer's nose (-Z) and the direction to a point (rad) */
export function angleOffNose(observer: Entity, point: ReadonlyVec3): number {
	const local = vec3.subtract(vec3.create(), point, observer.position);
	vec3.transformQuat(local, local, quat.conjugate(quat.create(), observer.orientation));
	const distance = vec3.length(local);
	return (distance ? Math.acos(Math.max(-1, Math.min(1, -local[2] / distance))) : 0);
}

type Nearest = (point: ReadonlyVec3, around: ReadonlyVec3) => ReadonlyVec3;

/** Picks the target closest to the nose and locks on after it stays ahead for LOCK_TIME */
export class TargetLock {
	/** Being locked, or locked */
	target: Entity | null = null;
	/** 0 when the target was picked, 1 when it is locked */
	progress = 0;

	private readonly isTarget: (entity: Entity) => boolean;

	constructor(isTarget: (entity: Entity) => boolean) {
		this.isTarget = isTarget;
	}

	get locked(): boolean {
		return this.target !== null && this.progress >= 1;
	}

	clear(): void {
		this.target = null;
		this.progress = 0;
	}

	/** @param nearest In a world that wraps around, where to look for an entity (World.nearest) */
	update(dt: number, observer: Entity, scene: readonly Entity[], nearest: Nearest = point => point): void {
		if (this.target && !this.within(observer, this.target, HOLD_CONE, nearest)) { this.clear(); }

		if (!this.target) {
			let bestAngle = Infinity;
			for (const entity of scene) {
				if (!this.isTarget(entity) || !this.within(observer, entity, LOCK_CONE, nearest)) { continue; }
				const angle = angleOffNose(observer, nearest(entity.position, observer.position));
				if (angle < bestAngle) {
					this.target = entity;
					bestAngle = angle;
				}
			}
		}

		if (this.target) { this.progress = Math.min(1, this.progress + dt / LOCK_TIME); }
	}

	private within(observer: Entity, entity: Entity, cone: number, nearest: Nearest): boolean {
		const at = nearest(entity.position, observer.position);
		return (!entity.dead && vec3.distance(observer.position, at) <= LOCK_RANGE && angleOffNose(observer, at) <= cone);
	}
}
