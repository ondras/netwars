import { mat4, vec3 } from "gl-matrix";
import type { Camera } from "../camera.ts";
import type { Entity } from "../entity/entity.ts";
import type { Ship } from "../entity/ship.ts";
import { RadarScope } from "./radar-scope.ts";
import { syncCanvasSize, type Renderer } from "./renderer.ts";

const COLOR = "rgba(110, 255, 140, 0.85)";
/** Shields below WARNING_LEVEL */
const COLOR_WARNING = "rgba(255, 90, 60, 0.95)";
const WARNING_LEVEL = 0.25;
const FONT = "12px ui-monospace, monospace";
const HELP = "Mouse: steer · Button: fire · W / S: speed up / down (hold to repeat)";

/** Meter size and placement (px) */
const METER_WIDTH = 10;
const METER_HEIGHT = 160;
const METER_LEFT = 24;
const METER_SPACING = 120;
/** Space below the meters for their labels */
const METER_BOTTOM = 56;

/** Distance ahead of the ship where the crosshair is placed (m) */
const AIM_DISTANCE = 40;

const RADAR_RANGE = 40; /* m */
/** Radar box size (px) */
const RADAR_WIDTH = 260;
const RADAR_HEIGHT = 160;

/** 2D overlay drawn on top of the scene; transparent to mouse events via CSS */
export class HUD implements Renderer {
	readonly node = document.createElement("canvas");
	private readonly ctx = this.node.getContext("2d")!;
	private readonly radar = new RadarScope(RADAR_RANGE);
	private readonly camera: Camera;
	private readonly ship: Ship;

	constructor(camera: Camera, ship: Ship) {
		this.camera = camera;
		this.ship = ship;
	}

	render(entities: readonly Entity[]): void {
		const { ctx, node } = this;

		syncCanvasSize(node);
		const width = node.clientWidth;
		const height = node.clientHeight;
		if (!width || !height) { return; }

		/* draw in CSS pixels */
		ctx.setTransform(node.width / width, 0, 0, node.height / height, 0, 0);
		ctx.clearRect(0, 0, width, height);

		ctx.strokeStyle = ctx.fillStyle = COLOR;
		ctx.lineWidth = 1.5;
		ctx.font = FONT;
		ctx.textBaseline = "alphabetic";

		ctx.fillText(HELP, 16, 24);

		if (this.ship.dead) { return; }

		this.drawCrosshair(width, height);
		this.drawStick(width, height);
		this.drawSpeed(METER_LEFT, height - METER_BOTTOM);
		this.drawShields(METER_LEFT + METER_SPACING, height - METER_BOTTOM);
		this.radar.draw(ctx, this.ship, entities, width - RADAR_WIDTH - 16, height - RADAR_HEIGHT - 16, RADAR_WIDTH, RADAR_HEIGHT);
	}

	/** Where shots fired now will be at AIM_DISTANCE */
	private drawCrosshair(width: number, height: number): void {
		const { ship, camera, ctx } = this;

		this.camera.update();
		const forward = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), ship.orientation);
		const aim = vec3.scaleAndAdd(vec3.create(), ship.position, forward, AIM_DISTANCE);
		const vpMatrix = mat4.multiply(mat4.create(), camera.pMatrix, camera.vMatrix);
		vec3.transformMat4(aim, aim, vpMatrix);

		const x = (aim[0] + 1) / 2 * width;
		const y = (1 - aim[1]) / 2 * height;
		const gap = 4;
		const size = 10;

		ctx.beginPath();
		ctx.moveTo(x - gap - size, y); ctx.lineTo(x - gap, y);
		ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + size, y);
		ctx.moveTo(x, y - gap - size); ctx.lineTo(x, y - gap);
		ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + size);
		ctx.stroke();
	}

	/** Current steering input; the screen center is neutral, edges are full deflection */
	private drawStick(width: number, height: number): void {
		const { yaw, pitch } = this.ship.engine;
		const x = (1 - yaw.control) / 2 * width;
		const y = (1 - pitch.control) / 2 * height;

		this.ctx.beginPath();
		this.ctx.arc(x, y, 5, 0, 2 * Math.PI);
		this.ctx.stroke();
	}

	/** Zero in the middle: forward speed fills upwards, reverse downwards; the tick marks the target speed */
	private drawSpeed(x: number, bottom: number): void {
		const { ctx } = this;
		const { speed } = this.ship.engine;

		const half = METER_HEIGHT / 2;
		const zero = bottom - half;
		const toY = (value: number) => zero - Math.max(-1, Math.min(1, value / speed.limit)) * half;

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

		ctx.fillText(`SPD ${signed(speed.value, 1)} m/s`, x, bottom + 18);
		ctx.fillText(`SET ${signed(speed.target, 0)} m/s`, x, bottom + 34);
	}

	private drawShields(x: number, bottom: number): void {
		const { ctx } = this;
		const { value, max } = this.ship.shields;
		const level = Math.max(0, Math.min(1, value / max));
		const fill = level * METER_HEIGHT;

		ctx.save();
		ctx.strokeStyle = ctx.fillStyle = (level < WARNING_LEVEL ? COLOR_WARNING : COLOR);
		ctx.strokeRect(x, bottom - METER_HEIGHT, METER_WIDTH, METER_HEIGHT);
		ctx.fillRect(x, bottom - fill, METER_WIDTH, fill);
		ctx.fillText(`SHD ${Math.round(level * 100)} %`, x, bottom + 18);
		ctx.restore();
	}
}

/** "+1.5", "-3", "0.0" (never "-0.0") */
function signed(value: number, digits: number): string {
	const text = value.toFixed(digits);
	const rounded = Number(text);
	if (rounded == 0) { return (0).toFixed(digits); }
	return (rounded > 0 ? `+${text}` : text);
}
