import type { vec3 } from "gl-matrix";
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
	texture: Texture;
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

export function billboard(center: vec3, radius: number, texture: Texture): Billboard {
	return { type: "billboard", points: [center], radius, texture };
}

const circleTextures = new Map<string, HTMLCanvasElement>();

/** Billboard showing a filled circle; textures are shared per color */
export function circle(center: vec3, radius: number, color: Color): Billboard {
	const key = color.toString();
	let texture = circleTextures.get(key);

	if (!texture) {
		const r = 32;
		texture = document.createElement("canvas");
		texture.width = texture.height = 2 * r;
		const ctx = texture.getContext("2d")!;
		ctx.fillStyle = key;
		ctx.beginPath();
		ctx.arc(r, r, r, 0, 2 * Math.PI, true);
		ctx.fill();
		circleTextures.set(key, texture);
	}

	return billboard(center, radius, texture);
}
