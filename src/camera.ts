import { mat4, quat, vec3 } from "gl-matrix";
import type { Entity } from "./entity/entity.ts";

export interface CameraOptions {
	/** Vertical field of view (rad) */
	fov: number;
	aspect: number;
	near: number;
	far: number;
}

export class Camera {
	/** Projection matrix */
	readonly pMatrix = mat4.create();
	/** View matrix */
	readonly vMatrix = mat4.create();

	private readonly options: CameraOptions = {
		fov: 45 * Math.PI / 180,
		aspect: 1,
		near: 0.1,
		far: 3000,
	};

	private followed: Entity | null = null;
	private readonly followOffset = vec3.create();

	constructor(options: Partial<CameraOptions> = {}) {
		this.configure(options);
	}

	configure(options: Partial<CameraOptions>): void {
		Object.assign(this.options, options);
		const { fov, aspect, near, far } = this.options;
		mat4.perspective(this.pMatrix, fov, aspect, near, far);
	}

	syncPort(node: HTMLCanvasElement): this {
		this.configure({ aspect: node.width / node.height });
		return this;
	}

	/** @param offset Camera position in the entity's local space */
	follow(entity: Entity, offset?: vec3): void {
		this.followed = entity;
		if (offset) {
			vec3.scale(this.followOffset, offset, -1);
		} else {
			vec3.set(this.followOffset, 0, 0, 0);
		}
	}

	update(): void {
		const entity = this.followed;
		if (!entity) { return; }

		/* invert entity rotation */
		const rot = quat.conjugate(quat.create(), entity.orientation);

		/* apply local translation, apply inverted entity rotation */
		mat4.fromRotationTranslation(this.vMatrix, rot, this.followOffset);

		/* apply inverted entity translation */
		const pos = vec3.scale(vec3.create(), entity.position, -1);
		mat4.translate(this.vMatrix, this.vMatrix, pos);
	}
}
