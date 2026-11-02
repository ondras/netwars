import { mat4, vec3 } from "gl-matrix";
import type { Entity } from "../entity/entity.ts";
import { Hunter } from "../entity/hunter.ts";
import { Pod } from "../entity/pod.ts";
import { Powerup } from "../entity/powerup.ts";
import { Ship } from "../entity/ship.ts";
import { radarContact, type RadarContact } from "../radar.ts";

const GRID_COLOR = "rgba(255, 70, 60, 0.85)";
export const POD_COLOR = "rgb(90, 150, 255)";
/** Pirates and other ships */
export const SHIP_COLOR = "rgb(255, 220, 60)";
export const HUNTER_COLOR = "rgb(255, 130, 40)";
export const POWERUP_COLOR = "rgb(200, 200, 200)";

/** Grid cells per side */
const CELLS = 4;
/** Longest height stalk, in radar units (1 = range) */
const MAX_STALK = 0.5;

/** @returns null for entities not shown on the radar */
function contactColor(entity: Entity): string | null {
	if (entity instanceof Pod) { return POD_COLOR; }
	if (entity instanceof Hunter) { return HUNTER_COLOR; }
	if (entity instanceof Ship) { return SHIP_COLOR; }
	if (entity instanceof Powerup) { return POWERUP_COLOR; }
	return null;
}

/*
 * Radar space: the grid is the square -1..1 on the XZ plane, ahead is -Z, up is +Y.
 * It is seen from behind and above, like a grid drawn on a table in front of the viewer.
 */
const VIEW_PROJECTION = mat4.multiply(
	mat4.create(),
	mat4.perspective(mat4.create(), Math.PI / 4, 1, 0.1, 10),
	mat4.lookAt(mat4.create(), [0, 1.8, 2.1], [0, 0, -0.1], [0, 1, 0]), /* ~40° down */
);

/** Radar space → normalized device coordinates */
function project(x: number, y: number, z: number): vec3 {
	return vec3.transformMat4(vec3.create(), vec3.fromValues(x, y, z), VIEW_PROJECTION);
}

/** Extent of the projected grid including the tallest stalks, used to fit it into the target box */
const BOUNDS = (() => {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const x of [-1, 1]) {
		for (const y of [-MAX_STALK, MAX_STALK]) {
			for (const z of [-1, 1]) {
				const p = project(x, y, z);
				xs.push(p[0]);
				ys.push(p[1]);
			}
		}
	}
	return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
})();

interface Plotted {
	contact: RadarContact;
	color: string;
}

/** Square grid in perspective; contacts stand on stalks showing their height */
export class RadarScope {
	/** Half the side of the covered square (m) */
	readonly range: number;

	constructor(range: number) {
		this.range = range;
	}

	/** Draw into the given box (CSS pixels), observer at the grid center facing away from the viewer */
	draw(ctx: CanvasRenderingContext2D, observer: Entity, entities: readonly Entity[], left: number, top: number, width: number, height: number): void {
		const scale = Math.min(width / (BOUNDS.maxX - BOUNDS.minX), height / (BOUNDS.maxY - BOUNDS.minY));
		const originX = left + width / 2 - (BOUNDS.minX + BOUNDS.maxX) / 2 * scale;
		const originY = top + height / 2 + (BOUNDS.minY + BOUNDS.maxY) / 2 * scale;

		const toScreen = (x: number, y: number, z: number): [number, number] => {
			const p = project(x, y, z);
			return [originX + p[0] * scale, originY - p[1] * scale];
		};
		const moveTo = (x: number, y: number, z: number) => ctx.moveTo(...toScreen(x, y, z));
		const lineTo = (x: number, y: number, z: number) => ctx.lineTo(...toScreen(x, y, z));

		ctx.save();
		ctx.lineWidth = 1;

		/* background */
		ctx.beginPath();
		moveTo(-1, 0, -1); lineTo(1, 0, -1); lineTo(1, 0, 1); lineTo(-1, 0, 1);
		ctx.closePath();
		ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
		ctx.fill();

		/* grid */
		ctx.beginPath();
		for (let i = 0; i <= CELLS; i++) {
			const t = -1 + 2 * i / CELLS;
			moveTo(t, 0, -1); lineTo(t, 0, 1);
			moveTo(-1, 0, t); lineTo(1, 0, t);
		}
		ctx.strokeStyle = GRID_COLOR;
		ctx.stroke();

		ctx.fillStyle = GRID_COLOR;
		const [labelX, labelY] = toScreen(-1, 0, -1);
		ctx.fillText(`${this.range} m`, labelX, labelY - 6);

		/* contacts, farthest first */
		const plotted: Plotted[] = [];
		for (const entity of entities) {
			if (entity == observer || entity.dead) { continue; }
			const color = contactColor(entity);
			if (color) { plotted.push({ contact: radarContact(observer, entity, this.range), color }); }
		}
		plotted.sort((a, b) => b.contact.forward - a.contact.forward);

		for (const { contact, color } of plotted) {
			const x = contact.x;
			const z = -contact.forward;
			ctx.strokeStyle = ctx.fillStyle = color;

			if (contact.outOfRange) {
				ctx.beginPath();
				ctx.arc(...toScreen(x, 0, z), 3, 0, 2 * Math.PI);
				ctx.stroke();
				continue;
			}

			const y = Math.max(-MAX_STALK, Math.min(MAX_STALK, contact.height));
			ctx.beginPath();
			moveTo(x, 0, z);
			lineTo(x, y, z);
			ctx.stroke();

			ctx.beginPath();
			ctx.arc(...toScreen(x, y, z), 2.5, 0, 2 * Math.PI);
			ctx.fill();
		}

		ctx.restore();
	}
}
