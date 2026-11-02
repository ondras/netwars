import { vec3 } from "gl-matrix";
import type { Color } from "./color.ts";

export type Texture = HTMLCanvasElement | HTMLImageElement;

export interface Line {
	readonly type: "line";
	points: [vec3, vec3];
	color: Color;
}

export interface Triangle {
	readonly type: "triangle";
	points: [vec3, vec3, vec3];
	color: Color;
}

export interface Quad {
	readonly type: "quad";
	points: [vec3, vec3, vec3, vec3];
	color: Color;
}

/** Screen-aligned textured square centered at points[0] */
export interface Billboard {
	readonly type: "billboard";
	points: [vec3];
	radius: number;
	/** Called by renderers, so that textures are only created when drawn */
	getTexture: () => Texture;
}

export type Geometry = Line | Triangle | Quad | Billboard;
export type GeometryType = Geometry["type"];

export function line(p1: vec3, p2: vec3, color: Color): Line {
	return { type: "line", points: [p1, p2], color };
}

export function triangle(p1: vec3, p2: vec3, p3: vec3, color: Color): Triangle {
	return { type: "triangle", points: [p1, p2, p3], color };
}

export function quad(p1: vec3, p2: vec3, p3: vec3, p4: vec3, color: Color): Quad {
	return { type: "quad", points: [p1, p2, p3, p4], color };
}

export function billboard(center: vec3, radius: number, getTexture: () => Texture): Billboard {
	return { type: "billboard", points: [center], radius, getTexture };
}

/** Billboard showing a filled circle */
export function circle(center: vec3, radius: number, color: Color): Billboard {
	const key = color.toString();
	return billboard(center, radius, () => circleTexture(key));
}

/** Deep copy of the points; color and texture are shared */
export function cloneGeometry<T extends Geometry>(geometry: T): T {
	return { ...geometry, points: geometry.points.map(point => vec3.clone(point)) } as T;
}

/** Radius of a bounding sphere centered at the model origin */
export function boundingRadius(geometries: readonly Geometry[]): number {
	let radius = 0;

	for (const geometry of geometries) {
		const extra = (geometry.type == "billboard" ? geometry.radius : 0);
		for (const point of geometry.points) {
			radius = Math.max(radius, vec3.length(point) + extra);
		}
	}

	return radius;
}

const circleTextures = new Map<string, HTMLCanvasElement>();

/** Shared per color */
function circleTexture(color: string): HTMLCanvasElement {
	let texture = circleTextures.get(color);

	if (!texture) {
		const r = 32;
		texture = document.createElement("canvas");
		texture.width = texture.height = 2 * r;
		const ctx = texture.getContext("2d")!;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(r, r, r, 0, 2 * Math.PI, true);
		ctx.fill();
		circleTextures.set(color, texture);
	}

	return texture;
}
