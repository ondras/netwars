import { mat4, vec3 } from "gl-matrix";
import type { Entity } from "../entity/entity.ts";
import { Gunship } from "../entity/gunship.ts";
import { Hunter } from "../entity/hunter.ts";
import { PlayerShip } from "../entity/player-ship.ts";
import { Raider } from "../entity/raider.ts";
import { Pod } from "../entity/pod.ts";
import { Powerup, POWERUPS } from "../entity/powerup.ts";
import { Ship } from "../entity/ship.ts";
import { radarContact, type RadarContact } from "../radar.ts";
import { RADAR_REACH, senseFade } from "../senses.ts";

const GRID_COLOR = "rgba(255, 70, 60, 0.85)";
export const POD_COLOR = "rgb(90, 150, 255)";
/** Pirates and other ships */
export const SHIP_COLOR = "rgb(255, 220, 60)";
export const HUNTER_COLOR = "rgb(255, 130, 40)";
export const RAIDER_COLOR = "rgb(255, 95, 125)";
export const GUNSHIP_COLOR = "rgb(138, 1, 223)";
export const POWERUP_COLOR = "rgb(200, 200, 200)";
/** Other pilots in online play: the HUD's green */
export const TEAM_COLOR = "rgb(110, 255, 140)";

/** Grid cells per side */
const CELLS = 4;
/** Longest height stalk, in radar units (1 = range) */
const MAX_STALK = 0.5;
const LETTER_FONT = "bold 10px ui-monospace, monospace";
/** Width of the dark rim round a powerup's letter, so that grid lines do not cut through it (px) */
const LETTER_RIM = 3;
/** From a powerup's dot to its letter, beside it (px) */
const LETTER_GAP = 4;

/** @returns null for entities not shown on the radar */
function contactColor(entity: Entity): string | null {
	if (entity instanceof Pod) { return POD_COLOR; }
	if (entity instanceof Raider) { return RAIDER_COLOR; }
	if (entity instanceof Gunship) { return GUNSHIP_COLOR; }
	if (entity instanceof Hunter) { return HUNTER_COLOR; }
	if (entity instanceof PlayerShip) { return TEAM_COLOR; }
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
	/** What kind of powerup it is */
	letter: string | null;
	/** How much of it shows, 0..1 */
	weight: number;
}

/**
 * Square grid in perspective. Contacts stand on stalks showing their height, or hang below the grid; a powerup has its letter
 * beside its dot. Those beyond its range are hollow dots at its edge, in the direction they are; their height shows just the same.
 * With a reach (a deathmatch), what is farther does not show at all, fading out before.
 */
export class RadarScope {
	/** Half the side of the covered square (m) */
	readonly range: number;

	constructor(range: number) {
		this.range = range;
	}

	/**
	 * Draw into the given box (CSS pixels), observer at the grid center facing away from the viewer
	 * @param reach Whether nothing farther than RADAR_REACH shows
	 */
	draw(ctx: CanvasRenderingContext2D, observer: Entity, entities: readonly Entity[], left: number, top: number, width: number, height: number, reach = false): void {
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
			if (!color) { continue; }

			const letter = (entity instanceof Powerup ? POWERUPS[entity.kind].letter : null);
			const weight = (reach ? senseFade(vec3.distance(entity.position, observer.position), RADAR_REACH) : 1);
			if (weight > 0) { plotted.push({ contact: radarContact(observer, entity, this.range), color, letter, weight }); }
		}
		plotted.sort((a, b) => b.contact.forward - a.contact.forward);

		ctx.font = LETTER_FONT;
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";

		for (const { contact, color, letter, weight } of plotted) {
			ctx.globalAlpha = weight;
			const x = contact.x;
			const z = -contact.forward;
			const y = Math.max(-MAX_STALK, Math.min(MAX_STALK, contact.height));
			ctx.strokeStyle = ctx.fillStyle = color;

			ctx.beginPath();
			moveTo(x, 0, z);
			lineTo(x, y, z);
			ctx.stroke();

			const [dotX, dotY] = toScreen(x, y, z);
			ctx.beginPath();
			if (contact.outOfRange) {
				ctx.arc(dotX, dotY, 3, 0, 2 * Math.PI);
				ctx.fillStyle = "#000"; /* hollow: the stalk does not show inside */
				ctx.fill();
				ctx.stroke();
				ctx.fillStyle = color;
			} else {
				ctx.arc(dotX, dotY, 2.5, 0, 2 * Math.PI);
				ctx.fill();
			}

			if (letter) {
				/* beside the dot, level with it: it stays put whether the powerup is above or below */
				ctx.lineWidth = LETTER_RIM;
				ctx.strokeStyle = "#000";
				ctx.strokeText(letter, dotX + LETTER_GAP, dotY);
				ctx.lineWidth = 1;
				ctx.fillText(letter, dotX + LETTER_GAP, dotY);
			}
		}

		ctx.restore();
	}
}
