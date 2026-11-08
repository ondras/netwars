import { mat4, vec3, vec4, type ReadonlyVec3 } from "gl-matrix";
import type { Camera } from "../camera.ts";
import type { Entity } from "../entity/entity.ts";
import { POWERUPS } from "../entity/powerup.ts";
import { ROCKET_CAPACITY, type Ship } from "../entity/ship.ts";
import { RadarScope } from "./radar-scope.ts";
import { syncCanvasSize, type Renderer } from "./renderer.ts";

const COLOR = "rgba(110, 255, 140, 0.85)";
/** Shields below WARNING_LEVEL */
const COLOR_WARNING = "rgba(255, 90, 60, 0.95)";
/** Lock brackets once the rocket target is locked */
const COLOR_LOCKED = "rgba(255, 70, 50, 0.95)";
/** Smallest half size of the lock brackets when locked (px); they start LOCK_SHRINK px larger and close in */
const LOCKED_SIZE = 16;
const LOCK_SHRINK = 30;
const WARNING_LEVEL = 0.25;
const FONT = "12px ui-monospace, monospace";

/** Meter size and placement (px) */
const METER_WIDTH = 10;
const METER_HEIGHT = 160;
const METER_LEFT = 24;
const METER_SPACING = 120;
/** Space below the meters for their labels */
const METER_BOTTOM = 56;
/** Height of one rocket in the rocket gauge, at most (px) */
const ROCKET_SLOT = 28;

/** Distance ahead of the ship where the crosshair is placed (m) */
const AIM_DISTANCE = 40;

const RADAR_RANGE = 150; /* m */
/** Radar box size (px) */
const RADAR_WIDTH = 260;
const RADAR_HEIGHT = 160;

/** 2D overlay drawn on top of the scene; transparent to mouse events via CSS */
export class HUD implements Renderer {
	readonly node = document.createElement("canvas");
	/** Player ship; nothing is drawn without one */
	ship: Ship | null = null;
	/** Text for the top left corner (level, enemies, pods) */
	status: (() => string) | null = null;
	/** More lines below it (a match's scores) */
	lines: (() => readonly string[]) | null = null;
	/** Lines in the middle of the view, upper part (who destroyed whom) */
	notices: (() => readonly string[]) | null = null;

	private readonly ctx = this.node.getContext("2d")!;
	private readonly radar = new RadarScope(RADAR_RANGE);
	private readonly camera: Camera;
	private readonly viewProjection = mat4.create();
	/** Canvas size in CSS pixels */
	private width = 0;
	private height = 0;

	constructor(camera: Camera) {
		this.camera = camera;
	}

	render(entities: readonly Entity[]): void {
		const { ctx, node, ship } = this;

		syncCanvasSize(node);
		const width = node.clientWidth;
		const height = node.clientHeight;
		if (!width || !height) { return; }

		/* draw in CSS pixels */
		ctx.setTransform(node.width / width, 0, 0, node.height / height, 0, 0);
		ctx.clearRect(0, 0, width, height);
		if (!ship) { return; }

		ctx.strokeStyle = ctx.fillStyle = COLOR;
		ctx.lineWidth = 1.5;
		ctx.font = FONT;
		ctx.textBaseline = "alphabetic";

		if (this.status) { ctx.fillText(this.status(), 16, 24); }
		this.lines?.().forEach((line, i) => ctx.fillText(line, 16, 42 + i * 16));
		ctx.textAlign = "center";
		this.notices?.().forEach((line, i) => ctx.fillText(line, width / 2, height / 4 + i * 18));
		ctx.textAlign = "start";
		if (ship.dead) { return; }

		this.width = width;
		this.height = height;
		this.camera.update();
		mat4.multiply(this.viewProjection, this.camera.pMatrix, this.camera.vMatrix);

		this.drawCrosshair(ship);
		this.drawLock(ship);
		this.drawStick(ship, width, height);
		this.drawSpeed(ship, METER_LEFT, height - METER_BOTTOM);
		this.drawShields(ship, METER_LEFT + METER_SPACING, height - METER_BOTTOM);
		this.drawRockets(ship, METER_LEFT + 2 * METER_SPACING, height - METER_BOTTOM);
		this.drawEffects(ship, METER_LEFT, height - METER_BOTTOM - METER_HEIGHT - 16);
		this.radar.draw(ctx, ship, entities, width - RADAR_WIDTH - 16, height - RADAR_HEIGHT - 16, RADAR_WIDTH, RADAR_HEIGHT);
	}

	/** Canvas position (CSS px) of a point in the scene, or null when it is behind the camera */
	private toScreen(point: ReadonlyVec3): [number, number] | null {
		const clip = vec4.transformMat4(vec4.create(), vec4.fromValues(point[0], point[1], point[2], 1), this.viewProjection);
		if (clip[3] <= 0) { return null; }
		return [(clip[0] / clip[3] + 1) / 2 * this.width, (1 - clip[1] / clip[3]) / 2 * this.height];
	}

	/** Where shots fired now will be at AIM_DISTANCE */
	private drawCrosshair(ship: Ship): void {
		const { ctx } = this;

		const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const aim = this.toScreen(vec3.scaleAndAdd(vec3.create(), ship.position, forward, AIM_DISTANCE));
		if (!aim) { return; }

		const [x, y] = aim;
		const gap = 4;
		const size = 10;

		ctx.beginPath();
		ctx.moveTo(x - gap - size, y); ctx.lineTo(x - gap, y);
		ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + size, y);
		ctx.moveTo(x, y - gap - size); ctx.lineTo(x, y - gap);
		ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + size);
		ctx.stroke();
	}

	/** Corner brackets closing in on the rocket target while it locks; red, with LOCKED, once locked */
	private drawLock(ship: Ship): void {
		const lock = ship.targetLock;
		const target = lock?.target;
		if (!lock || !target) { return; }
		const point = this.toScreen(target.position);
		if (!point) { return; }

		const { ctx } = this;
		const [x, y] = point;

		/* enclose the target: its bounding radius on screen, measured along the view's up direction */
		const up = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 1, 0), ship.orientation);
		const edge = this.toScreen(vec3.scaleAndAdd(vec3.create(), target.position, up, target.radius));
		const radius = (edge ? Math.hypot(edge[0] - x, edge[1] - y) : 0);
		const half = Math.max(LOCKED_SIZE, radius + 4) + (1 - lock.progress) * LOCK_SHRINK;
		const arm = 7;

		ctx.save();
		ctx.strokeStyle = ctx.fillStyle = (lock.locked ? COLOR_LOCKED : COLOR);
		ctx.beginPath();
		for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			const cornerX = x + sx * half;
			const cornerY = y + sy * half;
			ctx.moveTo(cornerX, cornerY - sy * arm);
			ctx.lineTo(cornerX, cornerY);
			ctx.lineTo(cornerX - sx * arm, cornerY);
		}
		ctx.stroke();

		if (lock.locked) {
			ctx.textAlign = "center";
			ctx.fillText("LOCKED", x, y + half + 16);
		}
		ctx.restore();
	}

	/** One rocket outline per place in the rack, filled for each rocket left */
	private drawRockets(ship: Ship, x: number, bottom: number): void {
		const { ctx } = this;
		const slot = Math.min(METER_HEIGHT / ROCKET_CAPACITY, ROCKET_SLOT);
		const length = slot - 8;

		for (let i = 0; i < ROCKET_CAPACITY; i++) {
			const top = bottom - (i + 1) * slot + 4;
			ctx.beginPath();
			ctx.moveTo(x, top + length);
			ctx.lineTo(x, top + 5);
			ctx.lineTo(x + METER_WIDTH / 2, top);
			ctx.lineTo(x + METER_WIDTH, top + 5);
			ctx.lineTo(x + METER_WIDTH, top + length);
			ctx.closePath();

			if (i < ship.rockets) {
				ctx.fill();
			} else {
				ctx.save();
				ctx.globalAlpha = 0.35;
				ctx.stroke();
				ctx.restore();
			}
		}

		ctx.fillText(`RKT ${ship.rockets}`, x, bottom + 18);
	}

	/** Current steering input; the screen center is neutral, edges are full deflection */
	private drawStick(ship: Ship, width: number, height: number): void {
		const { yaw, pitch } = ship.engine;
		const x = (1 - yaw.control) / 2 * width;
		const y = (1 - pitch.control) / 2 * height;

		this.ctx.beginPath();
		this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
		this.ctx.stroke();
	}

	/** The throttle, which extra thrust leaves as it is: zero in the middle, forward speed fills upwards, reverse downwards; the tick marks the target speed */
	private drawSpeed(ship: Ship, x: number, bottom: number): void {
		const { ctx } = this;
		const { speed } = ship.engine;
		const { limit } = speed;

		const half = METER_HEIGHT / 2;
		const zero = bottom - half;
		const toY = (value: number) => zero - Math.max(-1, Math.min(1, value / limit)) * half;

		ctx.strokeRect(x, bottom - METER_HEIGHT, METER_WIDTH, METER_HEIGHT);
		const y = toY(speed.value);
		ctx.fillRect(x, Math.min(y, zero), METER_WIDTH, Math.abs(zero - y));

		/* zero line */
		ctx.save();
		ctx.globalAlpha = 0.5;
		ctx.beginPath();
		ctx.moveTo(x - 6, zero);
		ctx.lineTo(x + METER_WIDTH + 6, zero);
		ctx.stroke();
		ctx.restore();

		/* target speed */
		const target = toY(speed.target);
		ctx.beginPath();
		ctx.moveTo(x - 4, target);
		ctx.lineTo(x + METER_WIDTH + 4, target);
		ctx.stroke();

		ctx.fillText(`SET ${signed(speed.target)} m/s`, x, bottom + 18);
	}

	private drawShields(ship: Ship, x: number, bottom: number): void {
		const { ctx } = this;
		const { value, max } = ship.shields;
		const level = Math.max(0, Math.min(1, value / max));
		const fill = level * METER_HEIGHT;

		ctx.save();
		ctx.strokeStyle = ctx.fillStyle = (level < WARNING_LEVEL ? COLOR_WARNING : COLOR);
		ctx.strokeRect(x, bottom - METER_HEIGHT, METER_WIDTH, METER_HEIGHT);
		ctx.fillRect(x, bottom - fill, METER_WIDTH, fill);
		ctx.fillText(`SHD ${Math.round(level * 100)} %`, x, bottom + 18);
		ctx.restore();
	}

	/** Powerups still working, upwards from `bottom` */
	private drawEffects(ship: Ship, x: number, bottom: number): void {
		const lines: string[] = [];
		if (ship.effects.power > 0) { lines.push(`${POWERUPS.power.label.toUpperCase()} ${ship.effects.power}`); }
		if (ship.effects.boost > 0) { lines.push(`${POWERUPS.boost.label.toUpperCase()} ${Math.ceil(ship.effects.boost)} s`); }

		lines.forEach((line, i) => this.ctx.fillText(line, x, bottom - i * 16));
	}
}

/** "+15", "-3", "0" (never "-0") */
function signed(value: number): string {
	const text = value.toFixed(0);
	const rounded = Number(text);
	if (rounded == 0) { return "0"; }
	return (rounded > 0 ? `+${text}` : text);
}
