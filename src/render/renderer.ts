import type { Entity } from "../entity/entity.ts";

/** Draws the scene once per animation frame */
export interface Renderer {
	render(entities: readonly Entity[]): void;
	/** Release any per-entity resources (called when the entity leaves the scene) */
	deletePrivateData?(entity: Entity): void;
}

/**
 * Match the canvas drawing buffer to its CSS size and the device pixel ratio
 * @returns Whether the size changed
 */
export function syncCanvasSize(canvas: HTMLCanvasElement): boolean {
	const ratio = window.devicePixelRatio || 1;
	const width = Math.round(canvas.clientWidth * ratio);
	const height = Math.round(canvas.clientHeight * ratio);

	if (!width || !height) { return false; } /* not laid out yet */
	if (canvas.width == width && canvas.height == height) { return false; }

	canvas.width = width;
	canvas.height = height;
	return true;
}
