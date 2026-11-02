import { mat4 } from "gl-matrix";
import type { Camera } from "../camera.ts";
import { Color } from "../color.ts";
import type { Entity } from "../entity/entity.ts";
import type { Texture } from "../geometry.ts";
import { syncCanvasSize, type Renderer } from "./renderer.ts";
import billboardFrag from "../shaders/billboard.frag?raw";
import billboardVert from "../shaders/billboard.vert?raw";
import simpleFrag from "../shaders/simple.frag?raw";
import simpleVert from "../shaders/simple.vert?raw";

interface Program<A extends string, U extends string> {
	program: WebGLProgram;
	attributes: Record<A, number>;
	uniforms: Record<U, WebGLUniformLocation | null>;
}

type SimpleProgram = Program<"aPosition" | "aColor", "uPmatrix" | "uMVmatrix">;
type BillboardProgram = Program<"aPosition" | "aRadius", "uPmatrix" | "uMVmatrix" | "uTexture" | "uViewport">;

interface ColoredSet {
	points: WebGLBuffer;
	colors: WebGLBuffer;
	/** Number of primitives (lines or triangles) */
	count: number;
}

interface BillboardSet {
	points: WebGLBuffer;
	radiuses: WebGLBuffer;
	textures: WebGLTexture[];
}

/** GPU resources of one entity */
interface EntityData {
	lines?: ColoredSet;
	triangles?: ColoredSet;
	billboards?: BillboardSet;
}

/**
 * Fills its canvas, which is to be sized by CSS; the drawing buffer follows the CSS size and pixel ratio.
 */
export class WebGLRenderer implements Renderer {
	readonly node = document.createElement("canvas");
	private readonly camera: Camera;
	private readonly gl: WebGLRenderingContext;
	private readonly programs: { simple: SimpleProgram; billboard: BillboardProgram };
	private currentProgram: SimpleProgram | BillboardProgram | null = null;
	private readonly entityData = new WeakMap<Entity, EntityData>();

	constructor(camera: Camera, background = new Color(0)) {
		this.camera = camera;

		const gl = this.node.getContext("webgl", { alpha: false, antialias: false });
		if (!gl) { throw new Error("WebGL not supported"); }
		this.gl = gl;

		this.programs = {
			simple: this.createProgram(simpleVert, simpleFrag, ["aPosition", "aColor"], ["uPmatrix", "uMVmatrix"]),
			billboard: this.createProgram(
				billboardVert, billboardFrag,
				["aPosition", "aRadius"],
				["uPmatrix", "uMVmatrix", "uTexture", "uViewport"],
			),
		};

		gl.enable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);

		const [r, g, b] = background.rgb;
		gl.clearColor(r, g, b, 1);
	}

	render(entities: readonly Entity[]): void {
		const { gl, node } = this;

		if (syncCanvasSize(node)) {
			gl.viewport(0, 0, node.width, node.height);
			this.camera.syncPort(node);
		}
		this.camera.update();
		this.currentProgram = null; /* projection may have changed; useProgram() uploads it */

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		for (const entity of entities) { this.renderEntity(entity); }
	}

	deletePrivateData(entity: Entity): void {
		const data = this.entityData.get(entity);
		if (!data) { return; }

		const { gl } = this;
		for (const set of [data.lines, data.triangles]) {
			if (!set) { continue; }
			gl.deleteBuffer(set.points);
			gl.deleteBuffer(set.colors);
		}
		if (data.billboards) {
			gl.deleteBuffer(data.billboards.points);
			gl.deleteBuffer(data.billboards.radiuses);
			for (const texture of data.billboards.textures) { gl.deleteTexture(texture); }
		}

		this.entityData.delete(entity);
	}

	private renderEntity(entity: Entity): void {
		if (!entity.geometries.length) { return; }

		const { gl } = this;
		let data = this.entityData.get(entity);
		if (!data) {
			data = this.createEntityData(entity);
			this.entityData.set(entity, data);
		}

		const mvMatrix = mat4.multiply(mat4.create(), this.camera.vMatrix, entity.getModelMatrix()) as Float32Array;

		if (data.lines) { this.drawColored(data.lines, gl.LINES, 2, mvMatrix); }
		if (data.triangles) { this.drawColored(data.triangles, gl.TRIANGLES, 3, mvMatrix); }

		if (data.billboards) {
			const program = this.programs.billboard;
			this.useProgram(program);
			const { attributes: a, uniforms: u } = program;

			gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);

			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1i(u.uTexture, 0);

			gl.uniform1f(u.uViewport, this.node.width);

			gl.bindBuffer(gl.ARRAY_BUFFER, data.billboards.points);
			gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

			gl.bindBuffer(gl.ARRAY_BUFFER, data.billboards.radiuses);
			gl.vertexAttribPointer(a.aRadius, 1, gl.FLOAT, false, 0, 0);

			data.billboards.textures.forEach((texture, index) => {
				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.drawArrays(gl.POINTS, index, 1);
			});
		}
	}

	private drawColored(set: ColoredSet, mode: GLenum, verticesPerPrimitive: number, mvMatrix: Float32Array): void {
		const { gl } = this;
		const program = this.programs.simple;
		this.useProgram(program);
		const { attributes: a, uniforms: u } = program;

		gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);

		gl.bindBuffer(gl.ARRAY_BUFFER, set.points);
		gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, set.colors);
		gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, 0, 0);

		gl.drawArrays(mode, 0, verticesPerPrimitive * set.count);
	}

	/** Upload entity geometries; quads are split into triangles */
	private createEntityData(entity: Entity): EntityData {
		const lines = { points: [] as number[], colors: [] as number[], count: 0 };
		const triangles = { points: [] as number[], colors: [] as number[], count: 0 };
		const billboards = { points: [] as number[], radiuses: [] as number[], textures: [] as Texture[] };

		for (const geometry of entity.geometries) {
			switch (geometry.type) {
				case "line":
				case "triangle": {
					const set = (geometry.type == "line" ? lines : triangles);
					set.count++;
					for (const point of geometry.points) {
						set.points.push(...point);
						set.colors.push(...geometry.color.rgb);
					}
				} break;

				case "quad":
					triangles.count += 2;
					for (const index of [0, 1, 2, 0, 2, 3]) {
						triangles.points.push(...geometry.points[index]);
						triangles.colors.push(...geometry.color.rgb);
					}
				break;

				case "billboard":
					billboards.textures.push(geometry.getTexture());
					billboards.points.push(...geometry.points[0]);
					billboards.radiuses.push(geometry.radius);
				break;
			}
		}

		const data: EntityData = {};
		if (lines.count) {
			data.lines = { points: this.buffer(lines.points), colors: this.buffer(lines.colors), count: lines.count };
		}
		if (triangles.count) {
			data.triangles = { points: this.buffer(triangles.points), colors: this.buffer(triangles.colors), count: triangles.count };
		}
		if (billboards.textures.length) {
			data.billboards = {
				points: this.buffer(billboards.points),
				radiuses: this.buffer(billboards.radiuses),
				textures: billboards.textures.map(source => this.texture(source)),
			};
		}
		return data;
	}

	private createShader(type: GLenum, source: string): WebGLShader {
		const { gl } = this;

		const shader = gl.createShader(type)!;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error(`Could not compile shader: ${gl.getShaderInfoLog(shader)}`);
		}
		return shader;
	}

	private createProgram<A extends string, U extends string>(
		vertexSource: string, fragmentSource: string, attributes: A[], uniforms: U[],
	): Program<A, U> {
		const { gl } = this;

		const vs = this.createShader(gl.VERTEX_SHADER, vertexSource);
		const fs = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);

		const program = gl.createProgram();
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error("Could not link the shader program");
		}

		gl.deleteShader(vs);
		gl.deleteShader(fs);

		const result = { program, attributes: {}, uniforms: {} } as Program<A, U>;

		for (const name of attributes) {
			result.attributes[name] = gl.getAttribLocation(program, name);
			gl.enableVertexAttribArray(result.attributes[name]);
		}

		for (const name of uniforms) {
			result.uniforms[name] = gl.getUniformLocation(program, name);
		}

		return result;
	}

	private useProgram(program: SimpleProgram | BillboardProgram): void {
		if (program == this.currentProgram) { return; }
		this.currentProgram = program;

		const { gl } = this;
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(program.uniforms.uPmatrix, false, this.camera.pMatrix as Float32Array);
	}

	private texture(source: Texture): WebGLTexture {
		const { gl } = this;

		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		return texture;
	}

	private buffer(data: number[]): WebGLBuffer {
		const { gl } = this;

		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
		return buffer;
	}
}
