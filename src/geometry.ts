import { vec3, type ReadonlyVec3 } from "gl-matrix";
import { Color } from "./color.ts";

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

/** Faces are lit from this direction (model space) */
const LIGHT = vec3.normalize(vec3.create(), vec3.fromValues(0.4, 1, 0.6));

/**
 * Triangle or quad of a solid, facing away from `inside`: wound counter-clockwise as seen from outside,
 * so that it survives back-face culling, and shaded by the direction it faces
 * @param points 3 or 4, in order around the face
 */
export function facet(points: vec3[], inside: ReadonlyVec3, color: Color): Triangle | Quad {
	const [a, b, c] = points;
	const normal = vec3.cross(vec3.create(), vec3.subtract(vec3.create(), b, a), vec3.subtract(vec3.create(), c, a));
	const centroid = vec3.create();
	for (const point of points) { vec3.scaleAndAdd(centroid, centroid, point, 1 / points.length); }
	if (vec3.dot(normal, vec3.subtract(vec3.create(), centroid, inside)) < 0) {
		points = [...points].reverse();
		vec3.negate(normal, normal);
	}

	vec3.normalize(normal, normal);
	const shaded = shade(color, normal);

	const [p1, p2, p3, p4] = points;
	return (p4 ? quad(p1, p2, p3, p4, shaded) : triangle(p1, p2, p3, shaded));
}

/** The colour of a face pointing along `normal` (unit): lit from above and in front, never darker than about half */
export function shade(color: Color, normal: ReadonlyVec3): Color {
	const amount = 0.55 + 0.45 * Math.max(0, vec3.dot(normal, LIGHT));
	const [r, g, b] = color.rgb;
	return new Color(r * amount, g * amount, b * amount);
}

/** Axis-aligned box between two opposite corners */
export function cuboid(from: ReadonlyVec3, to: ReadonlyVec3, color: Color): Quad[] {
	const center = vec3.lerp(vec3.create(), from, to, 0.5);
	const corner = ([x, y, z]: readonly number[]) => vec3.fromValues(x ? to[0] : from[0], y ? to[1] : from[1], z ? to[2] : from[2]);
	const faces = [
		[[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
		[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
		[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
	];
	return faces.map(face => facet(face.map(corner), center, color) as Quad);
}

/** Torus around the Y axis: `radius` to the middle of the tube, `thickness` the tube radius */
export function ring(radius: number, thickness: number, color: Color, segments = 16, sides = 6): Quad[] {
	const point = (i: number, j: number) => {
		const around = 2 * Math.PI * i / segments;
		const tube = 2 * Math.PI * j / sides;
		const r = radius + thickness * Math.cos(tube);
		return vec3.fromValues(r * Math.cos(around), thickness * Math.sin(tube), r * Math.sin(around));
	};

	const quads: Quad[] = [];
	for (let i = 0; i < segments; i++) {
		const middle = 2 * Math.PI * (i + 0.5) / segments;
		const tubeCenter = vec3.fromValues(radius * Math.cos(middle), 0, radius * Math.sin(middle));
		for (let j = 0; j < sides; j++) {
			quads.push(facet([point(i, j), point(i, j + 1), point(i + 1, j + 1), point(i + 1, j)], tubeCenter, color) as Quad);
		}
	}
	return quads;
}

/** Square pyramid on the Y axis: base of half-width `halfBase` at height `baseY`, apex at `apexY` */
export function pyramid(baseY: number, apexY: number, halfBase: number, color: Color): Geometry[] {
	const corners = () => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => vec3.fromValues(x * halfBase, baseY, z * halfBase));
	const inside = vec3.fromValues(0, baseY + (apexY - baseY) / 4, 0);
	const base = corners();
	return [
		...base.map((_, i) => {
			const side = corners();
			return facet([side[i], side[(i + 1) % 4], vec3.fromValues(0, apexY, 0)], inside, color);
		}),
		facet(base, inside, color),
	];
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
