import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { line } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import type { Pod } from "./pod.ts";

const COLOR = new Color(0.8, 0.8, 0.8);
/** Half the spread of the lines where they leave the hull (m) */
const SPREAD = 0.25;

/**
 * Lines from a carrier's hull to the pod it holds. Modelled one unit long, pointing down (-Y),
 * then placed, turned and stretched between the two ends by stretch().
 */
export class Grapple extends Entity {
	private readonly carrier: Entity;
	private readonly cargo: Pod;

	constructor(carrier: Entity, cargo: Pod) {
		super();
		this.carrier = carrier;
		this.cargo = cargo;

		const end = vec3.fromValues(0, -1, 0);
		this.geometries = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) =>
			line(vec3.fromValues(x * SPREAD, 0, z * SPREAD), vec3.clone(end), COLOR)
		);
	}

	/** Span the lines from a point on the hull to the pod */
	stretch(from: ReadonlyVec3, to: ReadonlyVec3): void {
		const direction = vec3.subtract(vec3.create(), to, from);
		const length = vec3.length(direction);
		if (!length) { return; }

		vec3.copy(this.position, from);
		quat.rotationTo(this.orientation, vec3.fromValues(0, -1, 0), vec3.scale(direction, direction, 1 / length));
		vec3.set(this.scale, 1, length, 1);
	}

	/** Positioned by the carrier; disappears once the pod is no longer held */
	override update(_dt: number, _world: World): void {
		const { carrier, cargo } = this;
		if (carrier.dead || cargo.dead || cargo.carrier != carrier) { this.dead = true; }
	}
}
