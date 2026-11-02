import type { Camera } from "../camera.ts";
import { Color } from "../color.ts";
import type { Entity } from "../entity/entity.ts";

export interface RendererOptions {
	width: number;
	height: number;
	/** Background */
	color: Color;
}

export abstract class Renderer {
	readonly node = document.createElement("canvas");
	protected readonly camera: Camera;
	protected readonly options: RendererOptions;

	constructor(camera: Camera, options: Partial<RendererOptions> = {}) {
		this.camera = camera;
		this.options = { width: 400, height: 300, color: new Color(0), ...options };

		this.node.width = this.options.width;
		this.node.height = this.options.height;
		camera.syncPort(this.node);
	}

	render(_entities: readonly Entity[]): void {
		this.camera.update();
	}

	/** Release any per-entity resources (called when the entity leaves the scene) */
	deletePrivateData(_entity: Entity): void {}
}
