import { vec3 } from "gl-matrix";
import { Entity } from "./entity.ts";

/** One entity or several, as a list */
export function toList<T extends Entity>(value: T | readonly T[]): readonly T[] {
	return (value instanceof Entity ? [value] : value);
}

/** The nearest of the candidates still alive, or null when none is */
export function nearestAlive<T extends Entity>(from: Entity, candidates: readonly T[]): T | null {
	let best: T | null = null;
	let bestDistance = Infinity;

	for (const candidate of candidates) {
		if (candidate.dead) { continue; }
		const distance = vec3.squaredDistance(from.position, candidate.position);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}

	return best;
}
