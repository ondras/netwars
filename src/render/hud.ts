import { mat4, vec3 } from "gl-matrix";
import type { Camera } from "../camera.ts";
import type { Ship } from "../entity/ship.ts";
import { syncCanvasSize, type Renderer } from "./renderer.ts";

const COLOR = "rgba(110, 255, 140, 0.85)";
const FONT = "12px ui-monospace, monospace";
const HELP = "Mouse: steer · Button: fire · Shift / Ctrl: throttle up / down";

/** Distance ahead of the ship where the crosshair is placed (m) */
const AIM_DISTANCE = 40;

/** 2D overlay drawn on top of the scene; transparent to mouse events via CSS */
export class HUD implements Renderer {
	readonly node = document.createElement("canvas");
	private readonly ctx = this.node.getContext("2d")!;
	private readonly camera: Camera;
	private readonly ship: Ship;

	constructor(camera: Camera, ship: Ship) {
		this.camera = camera;
		this.ship = ship;
	}

	render(): void {
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
		this.drawSpeed(height);
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

	private drawSpeed(height: number): void {
		const { ctx } = this;
		const { speed } = this.ship.engine;

		const barHeight = 120;
		const x = 24;
		const bottom = height - 48;
		const fill = Math.min(1, Math.abs(speed.value) / speed.limit) * barHeight;

		ctx.strokeRect(x, bottom - barHeight, 10, barHeight);
		ctx.fillRect(x, bottom - fill, 10, fill);

		ctx.fillText(`SPD ${speed.value.toFixed(1)} m/s`, x, bottom + 18);
		ctx.fillText(`THR ${speed.control >= 0 ? "+" : ""}${speed.control.toFixed(1)}`, x, bottom + 34);
	}
}
