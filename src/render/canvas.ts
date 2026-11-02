import { mat4, vec2, vec3 } from "gl-matrix";
import type { Entity } from "../entity/entity.ts";
import type { Geometry } from "../geometry.ts";
import { Renderer } from "./renderer.ts";

interface ProjectedGeometry {
	geometry: Geometry;
	/** Normalized device coordinates */
	points: vec3[];
	depth: number;
	/** Billboard radius in pixels */
	radius: number;
}

interface ProjectedEntity {
	geometries: ProjectedGeometry[];
	depth: number;
}

const byDepth = (a: { depth: number }, b: { depth: number }) => b.depth - a.depth;

/** Software renderer: painter's algorithm on a 2D canvas */
export class CanvasRenderer extends Renderer {
	private readonly ctx = this.node.getContext("2d")!;

	override render(entities: readonly Entity[]): void {
		super.render(entities);

		const { ctx, node } = this;
		this.clear();
		ctx.setTransform(1, 0, 0, -1, node.width / 2, node.height / 2);

		for (const entity of this.projectAndSortEntities(entities)) {
			for (const geometry of entity.geometries) { this.renderGeometry(geometry); }
		}

		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	private projectAndSortEntities(entities: readonly Entity[]): ProjectedEntity[] {
		const results: ProjectedEntity[] = [];

		/* View-Projection, computed once, multiplied with Model matrix for each entity */
		const vpMatrix = mat4.multiply(mat4.create(), this.camera.pMatrix, this.camera.vMatrix);

		/* Model-View-Projection, re-used for each entity */
		const mvpMatrix = mat4.create();

		/* Model-View for billboards, re-used for each entity */
		const mvMatrix = mat4.create();

		for (const entity of entities) {
			if (!entity.geometries.length) { continue; }

			const mMatrix = entity.getModelMatrix();

			mat4.multiply(mvpMatrix, vpMatrix, mMatrix);
			mat4.multiply(mvMatrix, this.camera.vMatrix, mMatrix);

			const pos = project(vec3.create(), mvpMatrix);
			const limit = 1.1;
			if (Math.abs(pos[0]) > limit || Math.abs(pos[1]) > limit) { continue; }
			if (pos[2] > 1 || pos[2] < 0) { continue; }

			results.push({
				depth: pos[2],
				geometries: this.projectAndSortGeometries(entity.geometries, mvpMatrix, mvMatrix),
			});
		}

		return results.sort(byDepth);
	}

	/**
	 * @param mvpMatrix Complete MVP matrix
	 * @param mvMatrix Model-View matrix necessary for billboard size computation
	 */
	private projectAndSortGeometries(geometries: readonly Geometry[], mvpMatrix: mat4, mvMatrix: mat4): ProjectedGeometry[] {
		const results: ProjectedGeometry[] = [];

		for (const geometry of geometries) {
			const points = geometry.points.map(point => project(point, mvpMatrix));
			const depth = points.reduce((sum, point) => sum + point[2], 0) / points.length;

			if (geometry.type == "triangle" || geometry.type == "quad") { /* backface culling */
				const v1 = vec3.subtract(vec3.create(), points[1], points[0]);
				const v2 = vec3.subtract(vec3.create(), points[2], points[0]);
				const cross = vec3.cross(vec3.create(), v1, v2);
				/* FIXME optimize */
				if (cross[2] < 0) { continue; }
			}

			let radius = 0;
			if (geometry.type == "billboard") {
				const mvCenter = project(geometry.points[0], mvMatrix);
				const mvOffset = vec3.clone(mvCenter);
				mvOffset[0] += geometry.radius;

				const ndcCenter = project(mvCenter, this.camera.pMatrix);
				const ndcOffset = project(mvOffset, this.camera.pMatrix);
				radius = (ndcOffset[0] - ndcCenter[0]) * this.node.width / 2;
			}

			results.push({ geometry, points, depth, radius });
		}

		return results.sort(byDepth);
	}

	private renderGeometry({ geometry, points, radius }: ProjectedGeometry): void {
		const { ctx } = this;
		const p = points.map(point => this.toScreen(point));

		switch (geometry.type) {
			case "line":
				ctx.beginPath();
				ctx.moveTo(p[0][0], p[0][1]);
				ctx.lineTo(p[1][0], p[1][1]);
				ctx.strokeStyle = geometry.color.toString();
				ctx.stroke();
			break;

			case "triangle":
			case "quad":
				ctx.beginPath();
				ctx.moveTo(p[0][0], p[0][1]);
				for (let i = 1; i < p.length; i++) { ctx.lineTo(p[i][0], p[i][1]); }
				ctx.fillStyle = geometry.color.toString();
				ctx.fill();
			break;

			case "billboard":
				ctx.drawImage(geometry.getTexture(), p[0][0] - radius, p[0][1] - radius, 2 * radius, 2 * radius);
			break;
		}
	}

	private toScreen(position: vec3): vec2 {
		return vec2.fromValues(position[0] * this.node.width / 2, position[1] * this.node.height / 2);
	}

	private clear(): void {
		this.ctx.fillStyle = this.options.color.toString();
		this.ctx.fillRect(0, 0, this.node.width, this.node.height);
	}
}

function project(position: vec3, matrix: mat4): vec3 {
	return vec3.transformMat4(vec3.create(), position, matrix);
}
