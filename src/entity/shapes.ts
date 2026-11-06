import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { line, shade, triangle, type Geometry } from "../geometry.ts";

/* Ships built from a few simple solids, flat planes and sticks (designed on the ship designs page); pilots' ships are in ./player-ships.ts */

export type Point = readonly [number, number, number];

export type Role = "body" | "wing" | "glass" | "glow";

/** The tightest solid around the points */
export interface Solid { readonly solid: readonly Point[]; readonly role: Role }
/** A flat outline, seen from both sides: a fan around its first point */
export interface Flat { readonly flat: readonly Point[]; readonly role: Role }
/** Thin lines */
export interface Sticks { readonly lines: ReadonlyArray<readonly [Point, Point]> }

export type Piece = Solid | Flat | Sticks;

export interface ShipStyle {
	readonly body: Color;
	readonly wing: Color;
	/** Lines along the creases between faces; null for none */
	readonly edges: Color | null;
	readonly sticks: Color;
	/** Canopies; the body's colour when not given */
	readonly glass?: Color;
	/** Engine mouths, which light themselves; the body's colour when not given */
	readonly glow?: Color;
	/** Faces looking down, on the body; null or not given for none */
	readonly belly?: Color | null;
	/** The belly colour goes on faces of the wing colour too (wings, claws) */
	readonly bellyOnWings?: boolean;
}

/** Faces meeting at a sharper angle than this get an edge line */
const CREASE = Math.cos(10 * Math.PI / 180);
/** Faces whose normal points down more than this count as the underside */
const UNDER = -0.2;

export const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Point) => Math.sqrt(dot(a, a));
const scaled = (a: Point, s: number): Point => [a[0] * s, a[1] * s, a[2] * s];
export function normalize(a: Point): Point | null {
	const l = length(a);
	return (l > 1e-12 ? scaled(a, 1 / l) : null);
}

/** Triangles [i, j, k] of the convex hull of the points, counter-clockwise as seen from outside */
export function convexHull(points: readonly Point[]): Array<[number, number, number]> {
	/* a tiny fixed jitter breaks ties between coplanar points */
	const jitter = (i: number, k: number) => {
		const s = Math.sin((i + 1) * 12.9898 + (k + 1) * 78.233) * 43758.5453;
		return (s - Math.floor(s) - 0.5) * 1e-6;
	};
	const p: Point[] = points.map(([x, y, z], i) => [x + jitter(i, 0), y + jitter(i, 1), z + jitter(i, 2)]);
	const farthest = (score: (i: number) => number) => p.reduce((best, _, i) => (score(i) > score(best) ? i : best), 0);

	const i0 = 0;
	const i1 = farthest(i => length(sub(p[i], p[i0])));
	const i2 = farthest(i => length(cross(sub(p[i1], p[i0]), sub(p[i], p[i0]))));
	const plane = cross(sub(p[i1], p[i0]), sub(p[i2], p[i0]));
	const i3 = farthest(i => Math.abs(dot(plane, sub(p[i], p[i0]))));

	interface Face { a: number; b: number; c: number; n: Point; d: number }
	const face = (a: number, b: number, c: number): Face => {
		const n = normalize(cross(sub(p[b], p[a]), sub(p[c], p[a]))) ?? [0, 0, 0];
		return { a, b, c, n, d: dot(n, p[a]) };
	};
	const center: Point = [0, 1, 2].map(k => (p[i0][k] + p[i1][k] + p[i2][k] + p[i3][k]) / 4) as unknown as Point;
	let faces = ([[i0, i1, i2], [i0, i3, i1], [i1, i3, i2], [i2, i3, i0]] as const).map(([a, b, c]) => {
		const f = face(a, b, c);
		return (dot(f.n, center) - f.d > 0 ? face(a, c, b) : f);
	});

	for (let i = 0; i < p.length; i++) {
		if (i == i0 || i == i1 || i == i2 || i == i3) { continue; }
		const visible = faces.filter(f => dot(f.n, p[i]) - f.d > 1e-9);
		if (!visible.length) { continue; } /* inside */

		const edges = new Set(visible.flatMap(f => [`${f.a},${f.b}`, `${f.b},${f.c}`, `${f.c},${f.a}`]));
		const horizon: Array<[number, number]> = [];
		for (const f of visible) {
			for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) {
				if (!edges.has(`${v},${u}`)) { horizon.push([u, v]); }
			}
		}
		faces = faces.filter(f => !visible.includes(f));
		for (const [u, v] of horizon) { faces.push(face(u, v, i)); }
	}

	return faces.map(f => [f.a, f.b, f.c]);
}

const toVec = (point: Point) => vec3.fromValues(point[0], point[1], point[2]);

/** Geometry of a ship made of pieces, scaled so that its bounding sphere has the given radius */
export function buildShip(pieces: readonly Piece[], radius: number, style: ShipStyle): Geometry[] {
	const pointsOf = (piece: Piece) => ("solid" in piece ? piece.solid : "flat" in piece ? piece.flat : piece.lines.flat());
	const scale = radius / Math.max(...pieces.flatMap(pointsOf).map(length));
	const geometries: Geometry[] = [];

	const faceColor = (role: Role, normal: Point): Color => {
		if (role == "glass") { return style.glass ?? style.body; }
		const below = normal[1] < UNDER && style.belly && (role == "body" || style.bellyOnWings);
		return (below ? style.belly! : role == "wing" ? style.wing : style.body);
	};

	const addFace = (corners: readonly Point[], role: Role): Point | null => {
		const normal = normalize(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
		if (!normal) { return null; }
		const color = (role == "glow" ? (style.glow ?? style.body) : shade(faceColor(role, normal), toVec(normal)));
		geometries.push(triangle(toVec(corners[0]), toVec(corners[1]), toVec(corners[2]), color));
		return normal;
	};
	const addEdge = (from: Point, to: Point) => {
		if (style.edges) { geometries.push(line(toVec(from), toVec(to), style.edges)); }
	};

	for (const piece of pieces) {
		if ("lines" in piece) {
			for (const [from, to] of piece.lines) { geometries.push(line(toVec(scaled(from, scale)), toVec(scaled(to, scale)), style.sticks)); }
			continue;
		}

		if ("flat" in piece) {
			const points = piece.flat.map(point => scaled(point, scale));
			for (let i = 1; i + 1 < points.length; i++) {
				addFace([points[0], points[i], points[i + 1]], piece.role);
				addFace([points[0], points[i + 1], points[i]], piece.role); /* the other side */
			}
			points.forEach((point, i) => addEdge(point, points[(i + 1) % points.length]));
			continue;
		}

		const points = piece.solid.map(point => scaled(point, scale));
		const creases = new Map<string, Point[]>(); /* "i,j" (i < j) → normals of the faces meeting there */
		for (const [a, b, c] of convexHull(points)) {
			const normal = addFace([points[a], points[b], points[c]], piece.role);
			if (!normal) { continue; }
			for (const [u, v] of [[a, b], [b, c], [c, a]]) {
				const key = (u < v ? `${u},${v}` : `${v},${u}`);
				creases.set(key, [...(creases.get(key) ?? []), normal]);
			}
		}
		for (const [key, normals] of creases) {
			if (normals.length == 2 && dot(normals[0], normals[1]) > CREASE) { continue; } /* a diagonal across a flat face */
			const [u, v] = key.split(",").map(Number);
			addEdge(points[u], points[v]);
		}
	}

	return geometries;
}

/* Building blocks; +X right, +Y up, nose towards -Z (before scaling) */

export const mirror = (points: readonly Point[]): Point[] => points.map(([x, y, z]) => [-x, y, z]);
/** An outline of [x, z] points, flat and thickened up and down */
export const plate = (outline: ReadonlyArray<readonly [number, number]>, thickness: number): Point[] =>
	outline.flatMap(([x, z]): Point[] => [[x, thickness / 2, z], [x, -thickness / 2, z]]);
/** Corners of a box between two points */
const box = ([x1, y1, z1]: Point, [x2, y2, z2]: Point): Point[] =>
	[x1, x2].flatMap(x => [y1, y2].flatMap(y => [z1, z2].map((z): Point => [x, y, z])));
/** n points on a circle around the length of the ship, at z */
const ring = (z: number, r: number, n: number, start = 0): Point[] => Array.from({ length: n }, (_, i): Point => {
	const angle = start + 2 * Math.PI * i / n;
	return [r * Math.cos(angle), r * Math.sin(angle), z];
});
/** Rotated about the length of the ship by an angle in degrees */
const roll = (points: readonly Point[], degrees: number): Point[] => {
	const a = degrees * Math.PI / 180;
	return points.map(([x, y, z]): Point => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z]);
};
/** A stick and its mirror image */
const sticks = (from: Point, to: Point): Sticks => ({ lines: [[from, to], [mirror([from])[0], mirror([to])[0]]] });

/**
 * A flat, forward-swept wing hinged on the body's edge from `tail` to `corner`, leaning out towards `toward`:
 * its tip edge lies `reach` from the axis in that direction and runs from z `trail` (back) to z `lead` (front)
 */
function hingedWing(tail: Point, corner: Point, toward: Point, reach: number, trail: number, lead: number): Flat {
	const u = normalize(sub(corner, tail))!;
	const d = normalize(toward)!;
	const v = normalize(sub(d, scaled(u, dot(d, u))))!;
	const tip = (z: number): Point => { /* tail + a·u + b·v with the given reach along d and the given z */
		const [a11, a12, b1] = [dot(u, d), dot(v, d), reach - dot(tail, d)];
		const [a21, a22, b2] = [u[2], v[2], z - tail[2]];
		const det = a11 * a22 - a12 * a21;
		const a = (b1 * a22 - a12 * b2) / det;
		const b = (a11 * b2 - b1 * a21) / det;
		return [tail[0] + a * u[0] + b * v[0], tail[1] + a * u[1] + b * v[1], tail[2] + a * u[2] + b * v[2]];
	};
	return { flat: [tail, corner, tip(lead), tip(trail)], role: "wing" };
}
const toward = (degrees: number): Point => [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180), 0];

/** Builds once, then hands out the same geometry (debris copies what it takes) */
function once(build: () => Geometry[]): () => Geometry[] {
	let geometries: Geometry[] | null = null;
	return () => (geometries ??= build());
}

const body = (solid: readonly Point[]): Solid => ({ solid, role: "body" });
const wing = (solid: readonly Point[]): Solid => ({ solid, role: "wing" });

/** Raider: a spindle, long point forward, with three flat forward-swept wings hinged on its back edges; grey body, olive wings */
export const raiderShape = once(() => {
	const nose: Point = [0, 0, -1.4];
	const right: Point = [0.22, 0, 0.4];
	const left: Point = [-0.22, 0, 0.4];
	const top: Point = [0, 0.22, 0.4];
	const bottom: Point = [0, -0.22, 0.4];
	const tail: Point = [0, 0, 0.9];
	return buildShip([
		body([nose, right, left, top, bottom, tail]),
		hingedWing(tail, top, toward(90), 0.85, 0.3, 0.08),
		hingedWing(tail, right, toward(330), 0.85, 0.3, 0.08),
		hingedWing(tail, left, toward(210), 0.85, 0.3, 0.08),
	], 1, { body: new Color(0x8b97a7), wing: new Color(0xc8c864), edges: null, sticks: new Color(0xc8c864) });
});

/** Hunter: two wedges side by side on a short bar; dark, with orange edges */
export const hunterShape = once(() => {
	const wedge: Point[] = [[0.4, -0.05, -1.1], [0.75, -0.08, 0.6], [0.05, -0.08, 0.6], [0.4, 0.3, 0.6]];
	const dark = new Color(0x333842);
	return buildShip([
		body(wedge),
		body(mirror(wedge)),
		wing(box([-0.4, -0.04, 0], [0.4, 0.04, 0.35])),
	], 1.25, { body: dark, wing: dark, edges: new Color(0xff8229), sticks: new Color(0xff8229) });
});

/** Pirate: a flat diamond with a small pyramid, two sticks forward and two grab sticks down; light grey with white sticks */
export const pirateShape = once(() => {
	const grey = new Color(0xa8b1bd);
	return buildShip([
		wing(plate([[0, -1.3], [0.6, 0.1], [0, 0.9], [-0.6, 0.1]], 0.07)),
		body([[0, 0.035, -0.35], [0.18, 0.035, 0.1], [-0.18, 0.035, 0.1], [0, 0.035, 0.45], [0, 0.22, 0.05]]),
		sticks([0.6, 0, 0.1], [0.6, 0, -0.65]),
		sticks([0.22, -0.035, 0.05], [0.22, -0.6, -0.15]),
	], 1.25, { body: grey, wing: grey, edges: null, sticks: new Color(0xffffff) });
});

/**
 * Gunship: a core with four tapered blades; nose and tail are flat squares as wide as the blades are thick at the root.
 * Dark, with violet edges and a violet stick forward from each side blade's tip.
 */
export const gunshipShape = once(() => {
	const ROOT = 0.07; /* half the blades' thickness at the root */
	const square = (z: number, half = ROOT): Point[] => [[half, half, z], [-half, half, z], [half, -half, z], [-half, -half, z]];
	/* the blades end a hair inside the core's end squares, so the end faces do not fight */
	const bladeEnds = [...square(-1.295, ROOT * 0.97), ...square(0.595, ROOT * 0.97)];
	const dark = new Color(0x333842);
	const violet = new Color(0xc76eff);
	return buildShip([
		body([...square(-1.3), ...square(0.6), ...ring(0.1, 0.2, 4, Math.PI / 4)]),
		...([[0, 0.75], [90, 0.6], [180, 0.75], [270, 0.6]] as const).map(([angle, span]) =>
			wing(roll([...bladeEnds, [span, 0.035, 0.1], [span, -0.035, 0.1], [0.14, ROOT, 0.1], [0.14, -ROOT, 0.1]], angle))),
		sticks([0.75, 0, 0.1], [0.75, 0, -0.75]),
	], 1.7, { body: dark, wing: dark, edges: violet, sticks: violet });
});
