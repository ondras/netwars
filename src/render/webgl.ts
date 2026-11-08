import { mat4, vec3 } from "gl-matrix";
import type { Camera } from "../camera.ts";
import { Color } from "../color.ts";
import type { Entity } from "../entity/entity.ts";
import type { Texture } from "../geometry.ts";
import { SIGHT_REACH, senseFade } from "../senses.ts";
import { syncCanvasSize, type Renderer } from "./renderer.ts";
import billboardFrag from "../shaders/billboard.frag?raw";
import billboardVert from "../shaders/billboard.vert?raw";
import dustVert from "../shaders/dust.vert?raw";
import simpleFrag from "../shaders/simple.frag?raw";
import simpleVert from "../shaders/simple.vert?raw";
import starFrag from "../shaders/star.frag?raw";
import starVert from "../shaders/star.vert?raw";

interface Program<A extends string, U extends string> {
	program: WebGLProgram;
	attributes: Record<A, number>;
	uniforms: Record<U, WebGLUniformLocation | null>;
}

type SimpleProgram = Program<"aPosition" | "aColor" | "aUnder", "uPmatrix" | "uMVmatrix" | "uOffset" | "uFade" | "uOutline">;
type BillboardProgram = Program<"aPosition" | "aRadius", "uPmatrix" | "uMVmatrix" | "uTexture" | "uViewport" | "uFade">;
type StarProgram = Program<"aPosition" | "aBrightness", "uPmatrix" | "uVmatrix" | "uSize">;
type DustProgram = Program<"aPosition", "uPmatrix" | "uVmatrix" | "uCamera" | "uSpan" | "uSize" | "uBrightness">;
type AnyProgram = SimpleProgram | BillboardProgram | StarProgram | DustProgram;

/** Width of lines (edges, sticks, grapples) in CSS pixels; picked on the ship designs page */
const LINE_WIDTH = 0.75;

/**
 * Outlines show in full on a shape at least OUTLINE_FULL big on screen (its radius, CSS pixels), and turn the colour
 * of what they outline as it shrinks to OUTLINE_GONE: they stay as wide, and would leave a far ship nothing but outline.
 */
const OUTLINE_FULL = 24;
const OUTLINE_GONE = 8;

/** How much the outlines of a shape this big on screen (radius, CSS pixels) show, 0..1 */
export function outlineShows(radius: number): number {
	return Math.max(0, Math.min(1, (radius - OUTLINE_GONE) / (OUTLINE_FULL - OUTLINE_GONE)));
}

/**
 * Screen shifts (device pixels) that, drawn over one another, turn 1 px lines into lines about `width` px wide:
 * WebGL draws lines one pixel wide whatever lineWidth says
 */
export function lineOffsets(width: number): Array<[number, number]> {
	const radius = (width - 1) / 2;
	const offsets: Array<[number, number]> = [[0, 0]];
	if (radius <= 0) { return offsets; }
	for (const r of (radius > 1 ? [radius / 2, radius] : [radius])) {
		for (let k = 0; k < 8; k++) { offsets.push([r * Math.cos(k * Math.PI / 4), r * Math.sin(k * Math.PI / 4)]); }
	}
	return offsets;
}

const STAR_COUNT = 800;
/** CSS pixels */
const STAR_SIZE = 2;
/** Within the camera's far plane; only the view rotation is applied, so the distance just has to be visible */
const STAR_DISTANCE = 1000;

/** Dust: how many grains, repeating every so many metres, how bright up close (0..1), in CSS pixels */
const DUST_COUNT = 500;
const DUST_SPAN = 120;
const DUST_BRIGHTNESS = 0.9;
const DUST_SIZE = 1.5;

interface Stars {
	points: WebGLBuffer;
	brightness: WebGLBuffer;
	count: number;
}

interface ColoredSet {
	points: WebGLBuffer;
	colors: WebGLBuffer;
	/** What the outlines among them turn on a shape small on screen; none when there are no outlines */
	under?: WebGLBuffer;
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
	/** Grains drifting past show the ship's motion where nothing else around does */
	dust = false;
	/** In a deathmatch: nothing farther than SIGHT_REACH from the camera shows, fading out before */
	limitedSight = false;
	private readonly camera: Camera;
	private readonly gl: WebGLRenderingContext;
	private readonly programs: { simple: SimpleProgram; billboard: BillboardProgram; star: StarProgram; dust: DustProgram };
	private currentProgram: AnyProgram | null = null;
	/** Programs that need the projection matrix uploaded before use (it may change every frame) */
	private readonly staleProjection = new Set<AnyProgram>();
	private readonly entityData = new WeakMap<Entity, EntityData>();
	private readonly stars: Stars;
	private readonly dustPoints: WebGLBuffer;
	/** Line passes in clip units, for the current canvas size and pixel ratio */
	private lineShifts: Array<[number, number]> = [[0, 0]];
	/** How big on screen (CSS pixels) a metre is a metre away, for the current canvas size */
	private pixelsPerRadian = 1;

	constructor(camera: Camera, background = new Color(0)) {
		this.camera = camera;

		const gl = this.node.getContext("webgl", { alpha: false, antialias: false });
		if (!gl) { throw new Error("WebGL not supported"); }
		this.gl = gl;

		this.programs = {
			simple: this.createProgram(
				simpleVert, simpleFrag,
				["aPosition", "aColor", "aUnder"],
				["uPmatrix", "uMVmatrix", "uOffset", "uFade", "uOutline"],
			),
			billboard: this.createProgram(
				billboardVert, billboardFrag,
				["aPosition", "aRadius"],
				["uPmatrix", "uMVmatrix", "uTexture", "uViewport", "uFade"],
			),
			star: this.createProgram(starVert, starFrag, ["aPosition", "aBrightness"], ["uPmatrix", "uVmatrix", "uSize"]),
			dust: this.createProgram(dustVert, starFrag, ["aPosition"], ["uPmatrix", "uVmatrix", "uCamera", "uSpan", "uSize", "uBrightness"]),
		};

		this.stars = this.createStars();
		this.dustPoints = this.buffer(Array.from({ length: 3 * DUST_COUNT }, () => Math.random() * DUST_SPAN));

		gl.enable(gl.CULL_FACE);
		gl.enable(gl.DEPTH_TEST);
		gl.polygonOffset(1, 1); /* faces are drawn a hair behind, so the edge lines on them win */

		const [r, g, b] = background.rgb;
		gl.clearColor(r, g, b, 1);
	}

	render(entities: readonly Entity[]): void {
		const { gl, node } = this;

		if (syncCanvasSize(node)) {
			gl.viewport(0, 0, node.width, node.height);
			this.camera.syncPort(node);
			const width = LINE_WIDTH * (window.devicePixelRatio || 1);
			this.lineShifts = lineOffsets(width).map(([x, y]) => [2 * x / node.width, 2 * y / node.height]);
			this.pixelsPerRadian = this.camera.pMatrix[5] * node.height / 2 / (window.devicePixelRatio || 1);
		}
		this.camera.update();
		for (const program of Object.values(this.programs)) { this.staleProjection.add(program); }

		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		this.drawStars();
		if (this.dust) { this.drawDust(); }
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
		if (!entity.visible || !entity.geometries.length) { return; }

		let data = this.entityData.get(entity);
		if (!data) {
			data = this.createEntityData(entity);
			this.entityData.set(entity, data);
		}

		/* in a deathmatch everything is kept at its copy nearest this ship, which is the only one within sight */
		const distance = vec3.distance(entity.position, this.camera.position);
		const fade = (this.limitedSight ? senseFade(distance, SIGHT_REACH) : 1);
		if (fade <= 0) { return; }

		const { gl } = this;
		const mvMatrix = mat4.multiply(mat4.create(), this.camera.vMatrix, entity.getModelMatrix()) as Float32Array;

		if (data.lines) {
			const outline = (data.lines.under && distance > 0 ? outlineShows(entity.radius / distance * this.pixelsPerRadian) : 1);
			this.drawColored(data.lines, gl.LINES, 2, mvMatrix, fade, outline);
		}
		if (data.triangles) { this.drawColored(data.triangles, gl.TRIANGLES, 3, mvMatrix, fade); }

		if (data.billboards) {
			const program = this.programs.billboard;
			this.useProgram(program);
			const { attributes: a, uniforms: u } = program;

			gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);

			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1i(u.uTexture, 0);

			gl.uniform1f(u.uViewport, this.node.width);
			gl.uniform1f(u.uFade, fade);

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

	/** Background stars: rotate with the view, never get closer; drawn without writing depth */
	private drawStars(): void {
		const { gl, stars } = this;
		const program = this.programs.star;
		this.useProgram(program);
		const { attributes: a, uniforms: u } = program;

		const rotation = mat4.clone(this.camera.vMatrix);
		rotation[12] = rotation[13] = rotation[14] = 0;
		gl.uniformMatrix4fv(u.uVmatrix, false, rotation as Float32Array);
		gl.uniform1f(u.uSize, Math.max(1, Math.round(STAR_SIZE * (window.devicePixelRatio || 1))));

		gl.bindBuffer(gl.ARRAY_BUFFER, stars.points);
		gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, stars.brightness);
		gl.vertexAttribPointer(a.aBrightness, 1, gl.FLOAT, false, 0, 0);

		gl.depthMask(false);
		gl.drawArrays(gl.POINTS, 0, stars.count);
		gl.depthMask(true);
	}

	/** Grains around the camera, wherever it is; drawn without writing depth, before anything they could be behind */
	private drawDust(): void {
		const { gl } = this;
		const program = this.programs.dust;
		this.useProgram(program);
		const { attributes: a, uniforms: u } = program;

		const rotation = mat4.clone(this.camera.vMatrix);
		rotation[12] = rotation[13] = rotation[14] = 0;
		gl.uniformMatrix4fv(u.uVmatrix, false, rotation as Float32Array);
		/* within one span: the shader has few digits, and coordinates can grow large */
		const [x, y, z] = this.camera.position;
		gl.uniform3f(u.uCamera, x % DUST_SPAN, y % DUST_SPAN, z % DUST_SPAN);
		gl.uniform1f(u.uSpan, DUST_SPAN);
		gl.uniform1f(u.uBrightness, DUST_BRIGHTNESS);
		gl.uniform1f(u.uSize, Math.max(1, Math.round(DUST_SIZE * (window.devicePixelRatio || 1))));

		gl.bindBuffer(gl.ARRAY_BUFFER, this.dustPoints);
		gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

		gl.depthMask(false);
		gl.drawArrays(gl.POINTS, 0, DUST_COUNT);
		gl.depthMask(true);
	}

	/** Uniformly distributed on a sphere, mostly dim */
	private createStars(): Stars {
		const points: number[] = [];
		const brightness: number[] = [];

		for (let i = 0; i < STAR_COUNT; i++) {
			points.push(...vec3.random(vec3.create(), STAR_DISTANCE));
			brightness.push(0.35 + 0.65 * Math.random() ** 2);
		}

		return { points: this.buffer(points), brightness: this.buffer(brightness), count: STAR_COUNT };
	}

	/**
	 * @param fade How much of it shows, 0..1: farther away, it darkens into the black of space
	 * @param outline How much the outlines among it show, 0..1
	 */
	private drawColored(set: ColoredSet, mode: GLenum, verticesPerPrimitive: number, mvMatrix: Float32Array, fade: number, outline = 1): void {
		const { gl } = this;
		const program = this.programs.simple;
		this.useProgram(program);
		const { attributes: a, uniforms: u } = program;

		gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);
		gl.uniform1f(u.uFade, fade);
		gl.uniform1f(u.uOutline, outline);

		gl.bindBuffer(gl.ARRAY_BUFFER, set.points);
		gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, set.colors);
		gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, set.under ?? set.colors);
		gl.vertexAttribPointer(a.aUnder, 3, gl.FLOAT, false, 0, 0);

		if (mode == gl.LINES) {
			for (const [x, y] of this.lineShifts) {
				gl.uniform2f(u.uOffset, x, y);
				gl.drawArrays(mode, 0, verticesPerPrimitive * set.count);
			}
			gl.uniform2f(u.uOffset, 0, 0);
		} else {
			gl.enable(gl.POLYGON_OFFSET_FILL);
			gl.drawArrays(mode, 0, verticesPerPrimitive * set.count);
			gl.disable(gl.POLYGON_OFFSET_FILL);
		}
	}

	/** Upload entity geometries; quads are split into triangles */
	private createEntityData(entity: Entity): EntityData {
		const lines = { points: [] as number[], colors: [] as number[], under: [] as number[], outlines: false, count: 0 };
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
					if (geometry.type == "line") {
						const under = (geometry.under ?? geometry.color).rgb;
						lines.under.push(...under, ...under);
						lines.outlines ||= Boolean(geometry.under);
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
			if (lines.outlines) { data.lines.under = this.buffer(lines.under); }
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
		}

		for (const name of uniforms) {
			result.uniforms[name] = gl.getUniformLocation(program, name);
		}

		return result;
	}

	private useProgram(program: AnyProgram): void {
		const { gl } = this;

		if (program != this.currentProgram) {
			/* enable exactly the attribute arrays the new program reads */
			const previous: number[] = (this.currentProgram ? Object.values(this.currentProgram.attributes) : []);
			const next: number[] = Object.values(program.attributes);
			for (const location of previous) {
				if (!next.includes(location)) { gl.disableVertexAttribArray(location); }
			}
			for (const location of next) { gl.enableVertexAttribArray(location); }

			this.currentProgram = program;
			gl.useProgram(program.program);
		}

		if (this.staleProjection.delete(program)) {
			gl.uniformMatrix4fv(program.uniforms.uPmatrix, false, this.camera.pMatrix as Float32Array);
		}
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
