import { quat, vec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";

/** Target position relative to the observer, in radar units (1 = range) */
export interface RadarContact {
	/** To the observer's right */
	x: number;
	/** Ahead of the observer */
	forward: number;
	/** Above the observer; not limited to the range */
	height: number;
	/** Outside the square ±range; x and forward were scaled down onto its edge */
	outOfRange: boolean;
}

export function radarContact(observer: Entity, target: Entity, range: number): RadarContact {
	const local = vec3.subtract(vec3.create(), target.position, observer.position);
	vec3.transformQuat(local, local, quat.conjugate(quat.create(), observer.orientation));

	/* local axes: +X right, +Y up, -Z forward */
	let x = local[0] / range;
	let forward = -local[2] / range;
	const height = local[1] / range;

	const extent = Math.max(Math.abs(x), Math.abs(forward));
	const outOfRange = extent > 1;
	if (outOfRange) {
		x /= extent;
		forward /= extent;
	}

	return { x, forward, height, outOfRange };
}
