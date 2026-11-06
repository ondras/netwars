import { Color } from "../color.ts";
import type { Geometry } from "../geometry.ts";
import { buildShip, cross, dot, length, mirror, normalize, plate, sub, type Flat, type Piece, type Point, type Role, type Solid, type ShipStyle } from "./shapes.ts";

/*
 * The ships pilots choose from, each in three colour schemes (designed on the player ships page).
 * +X right, +Y up, nose towards -Z, before scaling.
 *
 * Hulls are rows of cross-sections whose neighbours share their corners, and other parts are joined along
 * hull edges or on faces, so that nothing floats beside the hull or is half sunk into it.
 */

/** All of them this big: hits go by the bounding sphere, so no ship is easier to hit than another */
const RADIUS = 0.75;

type Section = readonly Point[];
type Part = Point | Section;

const isPoint = (part: Part): part is Point => typeof part[0] == "number";
/** Single points and lists of points, as one list */
const gather = (parts: readonly Part[]): Point[] => parts.flatMap(part => (isPoint(part) ? [part] : part));
const solid = (role: Role) => (...parts: Part[]): Solid => ({ solid: gather(parts), role });
const body = solid("body");
/** A solid in the wing colour */
const shell = solid("wing");
const glass = solid("glass");
const glow = solid("glow");
/** A flat panel, seen from both sides; a fan around its first point */
const panel = (...points: Point[]): Flat => ({ flat: points, role: "wing" });
/** Thin lines along paths of points */
const lines = (...paths: ReadonlyArray<readonly Point[]>): Piece => ({
	lines: paths.flatMap(path => path.slice(1).map((point, i): readonly [Point, Point] => [path[i], point])),
});
/** The piece and its mirror image */
function both(piece: Piece): Piece[] {
	if ("lines" in piece) {
		return [piece, { lines: piece.lines.map(([from, to]): readonly [Point, Point] => [[-from[0], from[1], from[2]], [-to[0], to[1], to[2]]]) }];
	}
	return [piece, ("solid" in piece ? { ...piece, solid: mirror(piece.solid) } : { ...piece, flat: mirror(piece.flat) })];
}
const twin = (pieces: readonly Piece[]): Piece[] => pieces.flatMap(both);

/** An oval cross-section at z */
const oval = (z: number, rx: number, ry: number, n = 8): Point[] => Array.from({ length: n }, (_, i): Point => {
	const angle = 2 * Math.PI * (i + 0.5) / n;
	return [rx * Math.cos(angle), ry * Math.sin(angle), z];
});
const at = (points: Section, [dx, dy, dz]: Point): Point[] => points.map(([x, y, z]): Point => [x + dx, y + dy, z + dz]);
/** A tapering square rod between two points */
function rod(a: Point, b: Point, ra: number, rb = ra): Point[] {
	const along = normalize(sub(b, a))!;
	const u = normalize(cross(along, (Math.abs(along[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])))!;
	const v = cross(along, u);
	const corners = (p: Point, r: number) => ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([s, t]): Point => [
		p[0] + r * (s * u[0] + t * v[0]), p[1] + r * (s * u[1] + t * v[1]), p[2] + r * (s * u[2] + t * v[2]),
	]);
	return [...corners(a, ra), ...corners(b, rb)];
}
/** A hard-edged hull section at z: flat on top, widest at the sides, narrower underneath */
const hex = (z: number, w: number, h: number, y = 0, under = 0.6): Point[] => [
	[w * 0.55, y + h, z], [-w * 0.55, y + h, z], [w, y, z], [-w, y, z], [w * 0.6, y - h * under, z], [-w * 0.6, y - h * under, z],
];
/** The right-hand corners of a hex section; their mirror images are the next index up */
const [TOP, SIDE, BOTTOM] = [0, 2, 4];

/** A glowing engine mouth at z */
const nozzle = (x: number, y: number, z: number, r: number) => glow(at(oval(z, r, r), [x, y, 0]), at(oval(z + 0.02, r * 0.9, r * 0.9), [x, y, 0]));
/** A square gun barrel along the ship */
const gun = (x: number, y: number, z1: number, z2: number, r = 0.02) => body(rod([x, y, z1], [x, y, z2], r));

/** A hull of cross-sections in a row: each neighbouring pair is one solid, so they share their corners exactly and nothing overlaps */
const loftAs = (make: (...parts: Part[]) => Solid, ...sections: Part[]): Solid[] => sections.slice(1).map((section, i) => make(sections[i], section));
const loft = (...sections: Part[]): Solid[] => loftAs(body, ...sections);
/** The point a fraction t of the way along an edge */
const onEdge = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** A section part of the way between two sections */
const between = (a: Section, b: Section, t: number): Point[] => a.map((point, i) => onEdge(point, b[i], t));
/** A section shrunk towards its centre and moved along the ship */
function inset(section: Section, s: number, dz: number): Point[] {
	const [cx, cy] = [0, 1].map(k => section.reduce((sum, point) => sum + point[k], 0) / section.length);
	return section.map(([x, y, z]): Point => [cx + (x - cx) * s, cy + (y - cy) * s, z + dz]);
}
/** A glowing engine mouth that repeats the shape of the section it closes */
const mouth = (section: Section, s = 0.82) => glow(inset(section, s, 0), inset(section, s, 0.01));
/** Four corners around a point, facing along the ship */
const square = ([x, y, z]: Point, r: number): Point[] => [[x + r, y + r, z], [x - r, y + r, z], [x + r, y - r, z], [x - r, y - r, z]];

/**
 * A hex section with the given right-hand corners, and their mirror images, each split into two points d apart from it along the outline.
 * Lofted to a plain section, each split corner makes a sharp triangle on the hull, a base to mount something on.
 * `ring` is the new section, `feet` the two points of each right-hand corner.
 */
function chamfer(section: Section, corners: readonly number[], d: number): { ring: Point[]; feet: Record<number, readonly [Point, Point]> } {
	const around = [0, 2, 4, 5, 3, 1];
	const split = new Set(corners.flatMap(corner => [corner, corner + 1]));
	const feet: Record<number, readonly [Point, Point]> = {};
	const ring = around.flatMap((corner, i): Point[] => {
		const point = section[corner];
		if (!split.has(corner)) { return [point]; }
		const toward = (other: Point): Point => onEdge(point, other, d / length(sub(other, point)));
		const pair = [toward(section[around[(i + 1) % 6]]), toward(section[around[(i + 5) % 6]])] as const;
		feet[corner] = pair;
		return [...pair];
	});
	return { ring, feet };
}

/** A spike growing out of the hull from the given base points, ending in a small square at the given point */
const prong = (base: Section, tip: Point, r: number) => body(base, square(tip, r));
/** An engine pod from z1 to z2, with its mouth */
const pod = (x: number, y: number, z1: number, z2: number, r: number): Piece[] => [
	body(at(oval(z1, r * 0.55, r * 0.55), [x, y, 0]), at(oval(z1 + (z2 - z1) * 0.3, r, r), [x, y, 0]), at(oval(z2, r * 0.9, r * 0.9), [x, y, 0])),
	nozzle(x, y, z2, r * 0.72),
];
/**
 * A turbine pod with a strut joining it to the hull: from the given base points to the pod's facet nearest them.
 * The pod keeps its whole round shape; only the strut touches the hull.
 */
function mounted(base: Section, x: number, y: number, z1: number, z2: number, r: number): Piece[] {
	const [cx, cy] = [0, 1].map(k => base.reduce((sum, point) => sum + point[k], 0) / base.length);
	const off = (point: Point) => Math.hypot(point[0] - cx, point[1] - cy);
	const nearest = (z: number, radius: number) => at(oval(z, radius, radius), [x, y, 0]).sort((p, q) => off(p) - off(q)).slice(0, 2);
	return [...pod(x, y, z1, z2, r), body(base, nearest(z1 + (z2 - z1) * 0.3, r), nearest(z2, r * 0.9))];
}
/**
 * The plane through a hull edge from `back` to `front`, leaning out at an angle (degrees: 0 right, 90 up),
 * as a function from (distance out in that direction, z) to a point in it
 */
function wingPlane(back: Point, front: Point, lean: number): (reach: number, z: number) => Point {
	const u = normalize(sub(front, back))!;
	const d: Point = [Math.cos(lean * Math.PI / 180), Math.sin(lean * Math.PI / 180), 0];
	const along = dot(d, u);
	const v = normalize(sub(d, [u[0] * along, u[1] * along, u[2] * along]))!;
	return (reach, z) => {
		const [a11, a12, b1] = [dot(u, d), dot(v, d), reach - dot(back, d)];
		const [a21, a22, b2] = [u[2], v[2], z - back[2]];
		const det = a11 * a22 - a12 * a21;
		const a = (b1 * a22 - a12 * b2) / det;
		const b = (a11 * b2 - b1 * a21) / det;
		return [back[0] + a * u[0] + b * v[0], back[1] + a * u[1] + b * v[1], back[2] + a * u[2] + b * v[2]];
	};
}
/** A flat wing hinged exactly on a hull edge; its tip edge lies `reach` out and runs from z `trail` to z `lead` */
function hinged(back: Point, front: Point, lean: number, reach: number, trail: number, lead: number): Flat {
	const point = wingPlane(back, front, lean);
	return panel(back, front, point(reach, lead), point(reach, trail));
}
/** The height of the top face between two sections, a hair lower so that what stands on it sits in it */
const deckOf = (a: Section, b: Section) => (z: number) => a[TOP][1] + (z - a[TOP][2]) * (b[TOP][1] - a[TOP][1]) / (b[TOP][2] - a[TOP][2]) - 0.002;
/** A canopy lying on the top face between two sections */
function canopyOn(a: Section, b: Section, z1: number, z2: number, w: number, h: number): Solid {
	const deck = deckOf(a, b);
	const mid = z1 + (z2 - z1) * 0.45;
	return glass([0, deck(z1), z1], [w, deck(mid), mid], [-w, deck(mid), mid], [0, deck(mid) + h, mid], [w * 0.7, deck(z2), z2], [-w * 0.7, deck(z2), z2], [0, deck(z2) + h * 0.55, z2]);
}

const skate = (): Piece[] => {
	const [a, b, c, d, e] = [hex(-0.75, 0.16, 0.08), hex(-0.2, 0.3, 0.13), hex(0.35, 0.26, 0.11), hex(0.72, 0.16, 0.07), hex(0.82, 0.13, 0.055)];
	const front = chamfer(a, [SIDE], 0.03);
	const mid = between(a, b, 0.35);
	const chord = (x: number, y: number, lead: number, trail: number, t: number): Point[] => [[x, y + t / 2, lead], [x, y - t / 2, lead], [x, y + t / 2, trail], [x, y - t / 2, trail]];
	const knee = chord(1, 0.03, 0.12, 0.4, 0.02);
	const tip = chord(1.35, 0.04, 0.62, 0.76, 0.012);
	return [
		body([0, -0.02, -1.2], front.ring), ...loft(front.ring, mid, b, c, d, e), mouth(e, 0.8),
		canopyOn(a, b, -0.7, -0.25, 0.085, 0.09),
		...both(shell(b[SIDE], c[SIDE], b[BOTTOM], c[BOTTOM], knee)),
		...both(shell(knee, tip)),
		...both(shell(tip, chord(1.4, 0.36, 0.84, 0.94, 0.008))),
		...both(prong([mid[SIDE], ...front.feet[SIDE]], [0.2, 0, -1.05], 0.016)),
	];
};

const devilfish = (): Piece[] => {
	const [a, b, c, d] = [hex(-0.6, 0.34, 0.16), hex(-0.05, 0.5, 0.24), hex(0.5, 0.42, 0.2), hex(0.8, 0.3, 0.14)];
	const deck = deckOf(b, c);
	return [
		body([0, 0, -0.95], a), ...loft(a, b, c, d),
		canopyOn(a, b, -0.5, -0.1, 0.14, 0.14),
		...both(shell(a[SIDE], onEdge(a[SIDE], b[SIDE], 0.4), a[BOTTOM], onEdge(a[BOTTOM], b[BOTTOM], 0.4), [0.46, 0.05, -1.1], [0.3, 0.05, -1.2], [0.46, -0.05, -1.1], [0.3, -0.05, -1.2])),
		...both(body(square([0.38, 0, -1.12], 0.03), square([0.38, 0, -1.5], 0.02))),
		...both(hinged(c[SIDE], b[SIDE], -14, 1.35, 0.6, 0.38)),
		...twin(mounted([onEdge(b[TOP], c[TOP], 0.6), c[TOP], onEdge(b[SIDE], c[SIDE], 0.6), c[SIDE]], 0.36, 0.22, 0.35, 0.95, 0.16)),
		panel([0, deck(0.05), 0.05], [0, 0.55, 0.62], [0, 0.55, 0.78], [0, deck(0.48), 0.48]),
	];
};

const kraken = (): Piece[] => {
	const [a, b, c, e] = [hex(-0.6, 0.2, 0.2, 0, 0.9), hex(0, 0.3, 0.28, 0, 0.9), hex(0.35, 0.22, 0.2, 0, 0.9), hex(0.55, 0.14, 0.13, 0, 0.9)];
	const aft = chamfer(e, [TOP, SIDE, BOTTOM], 0.04);
	const boom = (corner: number, elbow: Point, tip: Point): Piece[] => [
		body(c[corner], aft.feet[corner], square(elbow, 0.04)),
		shell(square(elbow, 0.04), tip),
	];
	const long: Point = [0.42, 0, 1.4];
	return [
		body([0, 0, -1.1], a), ...loft(a, b, c, aft.ring), mouth(aft.ring),
		...both(panel([0.18, 0, -0.85], [0.75, 0, -0.45], [0.24, 0, -0.05])), /* their front ends stick out on purpose, as two points beside the nose */
		canopyOn(a, b, -0.55, -0.1, 0.09, 0.11),
		...twin(boom(TOP, [0.34, 0.38, 0.78], [0.2, 0.24, 1.3])),
		...twin(boom(BOTTOM, [0.34, -0.34, 0.78], [0.2, -0.22, 1.3])),
		...both(body(c[SIDE], aft.feet[SIDE], square([0.62, 0, 0.7], 0.04))),
		...both(shell(square([0.62, 0, 0.7], 0.04), square(long, 0.02))),
		...both(glow(square(long, 0.02), square([0.41, 0, 1.46], 0.02))),
	];
};

const sunbird = (): Piece[] => {
	const [n, a, b, c, e] = [hex(-0.55, 0.035, 0.035, 0, 0.9), hex(-0.4, 0.14, 0.14, 0, 0.9), hex(0, 0.26, 0.26, 0, 0.9), hex(0.38, 0.2, 0.2, 0, 0.9), hex(0.62, 0.12, 0.12, 0, 0.9)];
	const aft = chamfer(c, [SIDE], 0.05);
	return [
		body([0, 0, -1.45], n), ...loft(n, a, b, aft.ring, e), mouth(e),
		canopyOn(a, b, -0.36, -0.02, 0.07, 0.1),
		...both(hinged(c[TOP], b[TOP], 42, 1.25, 0.5, 0.3)),
		...both(hinged(c[BOTTOM], b[BOTTOM], -37, 0.75, 0.38, 0.22)),
		...twin(mounted([b[SIDE], ...aft.feet[SIDE]], 0.33, 0, 0.02, 0.62, 0.085)),
		...both(hinged(e[BOTTOM], c[BOTTOM], -12, 0.42, 1.02, 0.88)),
	];
};

const vesper = (): Piece[] => {
	const [a, b, c, w1, w2] = [hex(-0.8, 0.14, 0.1), hex(-0.42, 0.22, 0.16), hex(-0.15, 0.16, 0.12), hex(-0.05, 0.05, 0.05), hex(0.05, 0.05, 0.05)];
	const [r1, r2, r3, r4, r5] = [hex(0.12, 0.12, 0.1), hex(0.28, 0.24, 0.19), hex(0.46, 0.28, 0.22), hex(0.66, 0.24, 0.19), hex(0.84, 0.18, 0.14)];
	const waist = chamfer(r3, [SIDE], 0.05);
	return [
		body([0, -0.02, -1.15], a), ...loft(a, b, c, w1, w2, r1, r2),
		shell(r2, waist.ring), body(waist.ring, r4), shell(r4, r5), body(r5, [0, -0.04, 1.25]),
		canopyOn(a, b, -0.76, -0.44, 0.075, 0.085),
		...both(hinged(c[TOP], b[TOP], 12, 1.2, 0.24, 0.05)),
		...twin(mounted([r2[SIDE], ...waist.feet[SIDE]], 0.38, 0.02, 0.08, 0.6, 0.07)),
	];
};

const gadfly = (): Piece[] => {
	const [a, b, c] = [hex(-0.78, 0.14, 0.1), hex(-0.4, 0.22, 0.17), hex(-0.12, 0.16, 0.12)];
	const [w1, w2] = [hex(-0.02, 0.05, 0.05, -0.02), hex(0.06, 0.05, 0.05, -0.05)];
	const [r1, r2, r3] = [hex(0.14, 0.14, 0.1, -0.08), hex(0.5, 0.28, 0.2, -0.16), hex(0.92, 0.16, 0.12, -0.3)];
	const front = chamfer(a, [BOTTOM], 0.03);
	const mid = between(a, b, 0.5);
	const LEFT_BOTTOM = BOTTOM + 1;
	return [
		body([0, -0.02, -1.1], front.ring), ...loft(front.ring, mid, b, c, w1, w2), ...loftAs(shell, w2, r1, r2, r3),
		...both(nozzle(0.08, -0.29, 0.92, 0.055)),
		shell(r3[BOTTOM], r3[LEFT_BOTTOM], onEdge(r2[BOTTOM], r3[BOTTOM], 0.6), onEdge(r2[LEFT_BOTTOM], r3[LEFT_BOTTOM], 0.6), [0, -0.46, 1.38]),
		canopyOn(a, b, -0.72, -0.42, 0.07, 0.09),
		...both(prong([mid[BOTTOM], ...front.feet[BOTTOM]], [0.09, -0.08, -1.14], 0.014)),
		...both(hinged(c[TOP], b[TOP], 18, 1.12, 0.25, 0.05)),
		...both(hinged(c[BOTTOM], b[BOTTOM], -18, 1.05, 0.1, -0.08)),
	];
};

const skimmer = (): Piece[] => {
	const [a, b, c, d, e] = [hex(-0.9, 0.13, 0.1), hex(-0.5, 0.2, 0.16), hex(-0.15, 0.14, 0.12), hex(-0.02, 0.05, 0.05), hex(1, 0.035, 0.035)];
	const aft = chamfer(c, [BOTTOM], 0.035);
	return [
		body([0, -0.01, -1.2], a), ...loft(a, b, aft.ring, d, e), body(e, [0, 0, 1.12]),
		canopyOn(a, b, -0.86, -0.52, 0.065, 0.09),
		...both(hinged(b[TOP], onEdge(a[TOP], b[TOP], 0.45), 11, 1.62, -0.44, -0.58)),
		...both(hinged(c[SIDE], onEdge(b[SIDE], c[SIDE], 0.35), -11, 1.5, 0, -0.12)),
		...both(hinged(e[TOP], onEdge(d[TOP], e[TOP], 0.8), 25, 0.34, 1.3, 1.2)),
		...twin(mounted([b[BOTTOM], ...aft.feet[BOTTOM]], 0.2, -0.12, -0.35, 0.1, 0.06)),
	];
};

const raptor = (): Piece[] => {
	const [a, b, c, d, e] = [hex(-0.85, 0.12, 0.1, -0.02), hex(-0.4, 0.2, 0.16), hex(0.15, 0.2, 0.15), hex(0.7, 0.1, 0.07), hex(0.82, 0.08, 0.055)];
	const inner = hinged(c[SIDE], b[SIDE], 19, 0.75, 0.35, 0);
	const [, , bendFront, bendBack] = inner.flat;
	const [tipFront, tipBack]: Point[] = [[1.25, 0.01, 0.72], [1.25, 0.01, 0.9]];
	/* a patch under both wing panels around the bend, a hair below them so that the surfaces do not fight */
	const patch = [bendFront, bendBack, onEdge(bendFront, b[SIDE], 0.2), onEdge(bendBack, c[SIDE], 0.2), onEdge(bendFront, tipFront, 0.18), onEdge(bendBack, tipBack, 0.18)]
		.map(([x, y, z]): Point => [x, y - 0.004, z]);
	return [
		body([0, -0.1, -1.25], a), ...loft(a, b, c, d, e), mouth(e),
		canopyOn(a, b, -0.78, -0.42, 0.06, 0.1),
		...both(inner),
		...both(panel(bendFront, tipFront, tipBack, bendBack)),
		...twin(mounted(patch, bendFront[0], bendFront[1] - 0.11, -0.05, 0.55, 0.09)),
		...both(hinged(d[TOP], onEdge(c[TOP], d[TOP], 0.45), 50, 0.42, 1.12, 1)),
	];
};

const stag = (): Piece[] => {
	/** The right half of a section, with an inner wall: armour plates that part towards the back */
	const half = (z: number, w: number, h: number, y: number, gap: number): Point[] => [[gap, y + h, z], [w * 0.55, y + h, z], [w, y, z], [w * 0.6, y - h * 0.6, z], [gap, y - h * 0.6, z]];
	const [f1, f2] = [hex(-0.8, 0.22, 0.1, 0.02), hex(-0.35, 0.42, 0.18, 0.04)];
	const [s0, s1, s2] = [half(-0.35, 0.42, 0.18, 0.04, 0.002), half(0.1, 0.52, 0.3, 0.06, 0.05), half(0.7, 0.4, 0.22, 0.05, 0.1)];
	const [c1, c2] = [hex(-0.3, 0.1, 0.1, 0.05), hex(0.85, 0.1, 0.1, 0.05)];
	const elbow: Point[] = [[0.38, 0.07, -1.06], [0.38, -0.01, -1.06], [0.54, 0.07, -1], [0.54, -0.01, -1]];
	return [
		body([0, 0.01, -0.95], f1), ...loft(f1, f2), ...loft(c1, c2), mouth(c2, 0.8),
		...twin(loftAs(shell, s0, s1, s2)),
		...both(mouth(s2, 0.7)),
		canopyOn(f1, f2, -0.72, -0.4, 0.1, 0.09),
		...both(shell(f1[SIDE], onEdge(f1[SIDE], f2[SIDE], 0.55), f1[BOTTOM], onEdge(f1[BOTTOM], f2[BOTTOM], 0.55), elbow)),
		...both(shell(elbow, [0.24, 0.045, -1.2], [0.24, 0.015, -1.2], [0.2, 0.03, -1.5])),
		...both(gun(0.12, 0.02, -1.3, -0.8, 0.018)),
	];
};

const reaper = (): Piece[] => {
	const head = hex(-0.95, 0.24, 0.09, 0.02, 0.8);
	const neckFront = hex(-0.84, 0.07, 0.07);
	const neckBack = hex(-0.52, 0.085, 0.08);
	const chest = hex(-0.36, 0.2, 0.12);
	const waist = hex(0.2, 0.3, 0.14);
	const rear = hex(0.8, 0.16, 0.08);
	const tail = hex(0.9, 0.12, 0.055);

	/* the arm grows from where the neck widens into the chest: its upper face enters along the side edge, its lower face along the bottom edge */
	const shoulder = [neckBack[SIDE], chest[SIDE], neckBack[BOTTOM], chest[BOTTOM]];
	/* the forearm is one angular blade: a point in front, a spur sticking out behind the elbow */
	const [elbowTop, elbowBottom]: Point[] = [[0.5, 0.07, -0.88], [0.5, -0.01, -0.88]];
	const spur: Point = [0.7, 0.03, -0.6];
	const forearm: Point[] = [elbowTop, elbowBottom, [0.62, 0.07, -0.82], [0.62, -0.01, -0.82], [0.4, 0.055, -1.02], [0.4, 0.015, -1.02], [0.34, 0.035, -1.42], spur];
	/* the upper arm ends exactly on the forearm's inner face */
	const elbow = [elbowTop, elbowBottom, onEdge(elbowTop, spur, 0.32), onEdge(elbowBottom, spur, 0.32)];
	const deck = deckOf(chest, waist);

	return [
		body([0, -0.02, -1.25], head),
		...loft(head, neckFront, neckBack, chest, waist, rear, tail),
		mouth(tail),
		glass([0, deck(-0.3), -0.3], [0.085, deck(-0.12), -0.12], [-0.085, deck(-0.12), -0.12], [0, deck(-0.1) + 0.085, -0.1], [0.07, deck(0.1), 0.1], [-0.07, deck(0.1), 0.1], [0, deck(0.1) + 0.045, 0.1]),
		...both(shell(shoulder, elbow)),
		...both(shell(forearm)),
		...both(hinged(onEdge(waist[TOP], rear[TOP], 0.62), waist[TOP], 12, 0.78, 0.66, 0.44)),
		...both(hinged(onEdge(waist[BOTTOM], rear[BOTTOM], 0.8), waist[BOTTOM], -28, 0.9, 0.8, 0.55)),
	];
};

const lumen = (): Piece[] => {
	const nose: Point = [0, 0, -0.7];
	const [a, b, c] = [hex(-0.35, 0.14, 0.12), hex(0.2, 0.16, 0.13), hex(0.55, 0.1, 0.08)];
	const front = chamfer(a, [SIDE], 0.03);
	const mid = between(a, b, 0.35);
	const foreBack = onEdge(a[TOP], b[TOP], 0.67);
	const fore = wingPlane(foreBack, a[TOP], 11);
	const hind = wingPlane(c[SIDE], b[SIDE], 7);
	const lifted = ([x, y, z]: Point): Point => [x, y + 0.008, z];
	return [
		body(nose, front.ring), ...loft(front.ring, mid, b, c), mouth(c),
		canopyOn(a, b, -0.3, 0.02, 0.065, 0.075),
		...both(panel(a[TOP], fore(1.6, -0.55), fore(1.3, 0.12), foreBack)),
		...both(panel(b[SIDE], hind(1.05, 0.22), hind(1, 0.62), hind(0.6, 0.92), c[SIDE])),
		...both(lines([lifted(onEdge(a[TOP], b[TOP], 0.3)), lifted(fore(1.45, -0.25))], [lifted(onEdge(b[SIDE], c[SIDE], 0.5)), lifted(hind(0.85, 0.6))])),
		...both(prong([mid[SIDE], ...front.feet[SIDE]], [0.1, 0, -1], 0.012)),
	];
};

const stinger = (): Piece[] => {
	const [a, b, c, d, e] = [hex(-0.65, 0.24, 0.07), hex(-0.25, 0.38, 0.13), hex(0.25, 0.34, 0.12), hex(0.6, 0.2, 0.09), hex(0.72, 0.15, 0.065)];
	const deck = deckOf(c, d);
	const pincer: Array<[number, number]> = [[0.52, -0.75], [0.76, -0.75], [0.78, -1.1], [0.64, -1.35], [0.54, -1.12]];
	const [keelFront, keelBack]: Point[] = [[0, 0.44, 0.36], [0, 0.5, 0.74]];
	const [tipFront, tipBack]: Point[] = [[0, 0.96, 0.12], [0, 0.92, 0.34]];
	return [
		body([0, 0, -0.84], a), ...loft(a, b, c, d, e), mouth(e),
		canopyOn(a, b, -0.58, -0.27, 0.1, 0.08),
		/* the arm ends exactly on the rear face of the pincer */
		...both(shell(a[SIDE], onEdge(a[SIDE], b[SIDE], 0.6), a[BOTTOM], onEdge(a[BOTTOM], b[BOTTOM], 0.6), [0.6, 0.035, -0.75], [0.6, -0.035, -0.75], [0.68, 0.035, -0.75], [0.68, -0.035, -0.75])),
		...both(shell(plate(pincer, 0.09))),
		...both(gun(0.66, 0, -1.5, -1.2)),
		...both(hinged(c[SIDE], b[SIDE], -4, 1, 0.42, 0.2)),
		panel([0, deck(0.28), 0.28], [0, deck(0.58), 0.58], keelBack, keelFront),
		panel(keelFront, keelBack, tipBack, tipFront),
		lines([tipFront, [0, 0.96, -0.6]]),
	];
};

export interface ShipSkin {
	readonly name: string;
	readonly style: ShipStyle;
}

export interface PlayerShipDesign {
	readonly name: string;
	/** The animal it hints at */
	readonly kind: string;
	readonly pieces: readonly Piece[];
	readonly skins: readonly ShipSkin[];
}

/** bellyOnWings: the underside colour also goes on wings and claws; otherwise they look the same from below as from above */
function skin(name: string, body: number, wing: number, belly: number | null, glass: number, glow: number, edges: number | null, sticks: number, bellyOnWings = false): ShipSkin {
	return {
		name,
		style: {
			body: new Color(body),
			wing: new Color(wing),
			belly: (belly === null ? null : new Color(belly)),
			glass: new Color(glass),
			glow: new Color(glow),
			edges: (edges === null ? null : new Color(edges)),
			sticks: new Color(sticks),
			bellyOnWings,
		},
	};
}

export const PLAYER_SHIPS: readonly PlayerShipDesign[] = [
	{ name: "Skate", kind: "Manta", pieces: skate(), skins: [
		skin("Manta", 0x2b4a6b, 0x2f5a85, 0xdfe9f2, 0x7fc4e8, 0x5fe3ff, 0x0f1c29, 0xdfe9f2, true),
		skin("Reef", 0xe8eef2, 0x18a0a8, 0x5f8b94, 0x0e3a44, 0xffd35c, 0x16323a, 0x18a0a8),
		skin("Sunset", 0xd9603a, 0xf0b048, 0x813932, 0x1c2533, 0xfff0a0, 0x34140e, 0xf0b048),
	] },
	{ name: "Devilfish", kind: "Manta", pieces: devilfish(), skins: [
		skin("Deep", 0x3a4a66, 0x56708f, 0xd4dde6, 0x8fd0e8, 0x4ff0e0, 0x121a26, 0xd4dde6, true),
		skin("Midnight", 0x27407a, 0xd4a83a, 0x1e2a4a, 0x7fa3d8, 0xffd35c, null, 0xd4a83a),
		skin("Carmine", 0xb3202e, 0x56606e, 0x801923, 0x10181e, 0xff8a3c, 0x1a0a0c, 0xf2f2f2),
	] },
	{ name: "Kraken", kind: "Squid", pieces: kraken(), skins: [
		skin("Squid", 0x8e2f3d, 0xd98a7a, 0xe8c8bc, 0x12202a, 0xff9a5c, 0x2a0d12, 0xe8c8bc, true),
		skin("Abyss", 0x243046, 0x243046, null, 0x0c1a24, 0x5fffe0, 0x00992e, 0x5fffe0),
		skin("Bone", 0xe6dfc8, 0x8e2f3d, 0xa8997a, 0x1c1a14, 0xff5c4c, 0x2c261a, 0xe6dfc8),
	] },
	{ name: "Sunbird", kind: "Hummingbird", pieces: sunbird(), skins: [
		skin("Emerald", 0x1e9e6e, 0x2d6e8e, 0xc23a52, 0x0e2420, 0xffd35c, 0x0a2a20, 0xe8f5e8),
		skin("Ruby", 0xd02f50, 0x1e9e6e, 0xbd284b, 0x141c20, 0xb8ff6a, 0x300a14, 0xffd9e0),
		skin("Pearl", 0xf0ece4, 0x4fb0c8, 0xa8b4bc, 0x123444, 0xffb340, 0x2a3038, 0xf0ece4, true),
	] },
	{ name: "Vesper", kind: "Wasp", pieces: vesper(), skins: [
		skin("Hornet", 0xf2c21a, 0x4a4d55, 0x8a6d10, 0x10181e, 0xff6a2b, 0x15161a, 0xf2c21a, true),
		skin("Rust", 0xd8451f, 0xf2c21a, 0x862c13, 0x12181c, 0xffd35c, 0x2a0f08, 0xf2c21a),
		skin("Graphite", 0x3f4552, 0x9be03a, 0x434956, 0x0e1416, 0x9be03a, 0x12151a, 0x9be03a),
	] },
	{ name: "Gadfly", kind: "Wasp", pieces: gadfly(), skins: [
		skin("Horsefly", 0x7a6a4f, 0xc9bfa6, 0x4a3f2e, 0x3fb86a, 0xffb340, 0x211a10, 0xc9bfa6, true),
		skin("Orange", 0xf08a1c, 0x585c66, 0x7a4410, 0x10181e, 0xffd35c, 0x1f1408, 0xf08a1c),
		skin("Ice", 0xdfeaf2, 0x3aa0d0, 0x7a93a8, 0x103248, 0x5fe3ff, 0x1c2a36, 0xdfeaf2),
	] },
	{ name: "Skimmer", kind: "Dragonfly", pieces: skimmer(), skins: [
		skin("Dragonfly", 0x1f86a8, 0xbcd8e0, 0x135468, 0x0c2a34, 0x5fffe0, 0x0a2a36, 0xbcd8e0),
		skin("Fire", 0xc9332a, 0xf0c8a0, 0xac2920, 0x141a1e, 0xffb340, 0x2a0c0a, 0xf0c8a0),
		skin("Malachite", 0x2a9a5c, 0xd8efc0, 0x15603a, 0x0c2418, 0xb8ff6a, 0x0a2415, 0xd8efc0),
	] },
	{ name: "Raptor", kind: "Falcon", pieces: raptor(), skins: [
		skin("Peregrine", 0x5c6a7d, 0x4a586b, 0xe8dfc8, 0xd8a820, 0xffb340, 0x141a22, 0xe8dfc8, true),
		skin("Kestrel", 0xb8622e, 0x5f7488, 0xe8d4b0, 0x18222a, 0xffd35c, 0x2a160a, 0xe8d4b0, true),
		skin("Viper", 0x333842, 0x333842, null, 0x0f1719, 0x6eff8c, 0x00b324, 0x6eff8c),
	] },
	{ name: "Stag", kind: "Beetle", pieces: stag(), skins: [
		skin("Chitin", 0x4a3428, 0x8c4a22, 0x624637, 0xc8a040, 0xffb340, 0x160d08, 0xc8a040, true),
		skin("Scarab", 0xc8a040, 0x2fb07a, 0x123f31, 0x0e2a24, 0xb8ff6a, 0x0b1f19, 0xc8a040),
		skin("Copper", 0xc26b3a, 0x2b6e72, 0x6e3a20, 0x0f2a2e, 0x4ff0e0, 0x27140b, 0xf0c9a8),
	] },
	{ name: "Reaper", kind: "Mantis", pieces: reaper(), skins: [
		skin("Mantis", 0x8fc84a, 0x4f8a3a, 0xd8e8a0, 0x102010, 0xe8ff6a, 0x1a2c10, 0xd8e8a0),
		skin("Sand", 0xd8c498, 0x8a7448, 0x6a5838, 0x1c1a12, 0xff8a3c, 0x2c2414, 0xf0e4c4),
		skin("Crimson", 0x4a4f5a, 0xc0262e, 0x505662, 0x0e1014, 0xff4a3c, 0x0e1014, 0xc0262e),
	] },
	{ name: "Lumen", kind: "Moth", pieces: lumen(), skins: [
		skin("Moth", 0x8a7458, 0xd8c8a8, 0x6e5b45, 0x1c1a12, 0xffd35c, 0x2c2418, 0x5a4a38, true),
		skin("Luna", 0xe8f0d8, 0x8fdcb0, 0x5a9a80, 0x123428, 0xf0ff9a, 0x1c3a2c, 0xe8f0d8),
		skin("Sail", 0x3a4866, 0xe0b040, 0x425270, 0x7fa3d8, 0xffd35c, 0x141a28, 0xfff0b0),
	] },
	{ name: "Stinger", kind: "Scorpion", pieces: stinger(), skins: [
		skin("Desert", 0xc8a060, 0x8a6a3a, 0x6a5030, 0x1a1510, 0xff8a3c, 0x2a1e0e, 0xf0dcb0),
		skin("Night", 0x3a3f4c, 0x3a3f4c, null, 0x0e1014, 0x4fe9ff, 0x009bb3, 0x4fe9ff),
		skin("Venom", 0x4a505e, 0x9be03a, 0x4e5465, 0x0e1416, 0xc8ff5a, 0x12151a, 0x9be03a),
	] },
];

/** A ship and its colours, as they travel between browsers and the server: an index into this list */
const LOOKS = PLAYER_SHIPS.flatMap((design, ship) => design.skins.map((_, skinIndex) => ({ design, ship, skin: skinIndex })));

export const DEFAULT_LOOK = 0;

export const isLook = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < LOOKS.length;

/** The look of a ship in one of its colour schemes */
export const lookOf = (ship: number, skinIndex: number): number => LOOKS.findIndex(look => look.ship == ship && look.skin == skinIndex);

/** Which ship and colour scheme a look is; an unknown look reads as the default one */
export const lookParts = (look: number): { ship: number; skin: number } => LOOKS[isLook(look) ? look : DEFAULT_LOOK];

/** For menus */
export function lookName(look: number): string {
	const { ship, skin: skinIndex } = lookParts(look);
	return `${PLAYER_SHIPS[ship].name} · ${PLAYER_SHIPS[ship].skins[skinIndex].name}`;
}

const built = new Map<number, readonly Geometry[]>();

/** Built once per look, then the same objects are handed out (debris copies what it takes) */
export function shipGeometries(look: number): readonly Geometry[] {
	const known = (isLook(look) ? look : DEFAULT_LOOK);
	let geometries = built.get(known);
	if (!geometries) {
		const { design, skin: skinIndex } = LOOKS[known];
		geometries = buildShip(design.pieces, RADIUS, design.skins[skinIndex].style);
		built.set(known, geometries);
	}
	return geometries;
}
