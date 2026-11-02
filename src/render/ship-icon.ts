import { quat, vec3 } from "gl-matrix";
import type { Geometry } from "../geometry.ts";

/** Icon view: nearly straight down onto the top, where the outlines read best; nose up and to the right */
const VIEW = (() => {
	const view = quat.create();
	quat.rotateZ(view, view, -Math.PI / 4); /* applied last: on screen, nose up and right */
	quat.rotateX(view, view, 1.25); /* about 72°: look down onto the top */
	quat.rotateY(view, view, 0.2); /* applied first: show a little of one side */
	return view;
})();

interface Item {
	depth: number;
	markup: string;
}

const number = (value: number) => Number(value.toFixed(3));

/**
 * A ship's geometry flattened into an SVG drawing, `size` CSS pixels square: faces facing the viewer,
 * far ones first, and lines in their place among them (static markup)
 */
export function shipIcon(geometries: readonly Geometry[], size: number): string {
	const items: Item[] = [];
	const xs: number[] = [];
	const ys: number[] = [];

	const project = (point: vec3) => {
		const p = vec3.transformQuat(vec3.create(), point, VIEW);
		xs.push(p[0]);
		ys.push(-p[1]); /* SVG y grows downwards */
		return p;
	};
	const pointList = (points: vec3[]) => points.map(p => `${number(p[0])},${number(-p[1])}`).join(" ");

	for (const geometry of geometries) {
		if (geometry.type == "billboard") { continue; }
		const color = geometry.color.toString();

		if (geometry.type == "line") {
			const [a, b] = geometry.points.map(project);
			items.push({
				depth: (a[2] + b[2]) / 2 + 0.01, /* just in front of a face it lies on */
				markup: `<line x1="${number(a[0])}" y1="${number(-a[1])}" x2="${number(b[0])}" y2="${number(-b[1])}" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linecap="round"/>`,
			});
			continue;
		}

		const corners = geometry.points.map(point => vec3.transformQuat(vec3.create(), point, VIEW));
		const [a, b, c] = corners;
		const facing = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); /* z of the normal: towards the viewer when positive */
		if (facing <= 0) { continue; }
		corners.forEach(p => {
			xs.push(p[0]);
			ys.push(-p[1]);
		});
		items.push({
			depth: corners.reduce((sum, p) => sum + p[2], 0) / corners.length,
			/* a hairline of the same colour hides the seams between neighbouring triangles */
			markup: `<polygon points="${pointList(corners)}" fill="${color}" stroke="${color}" stroke-width="0.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`,
		});
	}

	items.sort((p, q) => p.depth - q.depth);

	const margin = 0.08;
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const extent = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) * (1 + 2 * margin);
	const left = (minX + Math.max(...xs)) / 2 - extent / 2;
	const top = (minY + Math.max(...ys)) / 2 - extent / 2;

	return `<svg viewBox="${number(left)} ${number(top)} ${number(extent)} ${number(extent)}" width="${size}" height="${size}" aria-hidden="true">`
		+ items.map(item => item.markup).join("")
		+ "</svg>";
}
