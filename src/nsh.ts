/**
 * Loader for NSH model files (C-like source with VECTOR vertex and SPOLY face arrays)
 */
import { quat, vec3 } from "gl-matrix";
import { Color } from "./color.ts";
import { line, quad, triangle, type Geometry } from "./geometry.ts";

/* import.meta.env is Vite's; the game server runs this file in plain Node, where it is missing */
const MODELS_PATH = `${import.meta.env?.BASE_URL ?? "/"}models/`;

/** Reads a model file's text by name (e.g. "internal/pod1") */
export type ModelSource = (name: string) => Promise<string>;

/** In the browser: fetched from the models directory */
const fetchModel: ModelSource = async name => {
	const url = `${MODELS_PATH}${name}.nsh`;
	const response = await fetch(url);
	if (!response.ok) { throw new Error(`Cannot load ${url}: HTTP ${response.status}`); }
	return response.text();
};

let source: ModelSource = fetchModel;

/** Where models come from from now on (the server reads them from disk); forgets models loaded before */
export function setModelSource(next: ModelSource): void {
	source = next;
	cache.clear();
}

/** Model units per meter */
const SCALE = 1 / 100;

const PALETTE = [
	new Color(0, 0, 0),
	new Color(0, 0, 0.6),
	new Color(0, 0.6, 0),
	new Color(0, 0.6, 0.6),
	new Color(0.6, 0, 0),
	new Color(0.6, 0, 0.6),
	new Color(0.6, 0.5, 0.2),
	new Color(0.6, 0.6, 0.6),
	new Color(0.3, 0.3, 0.3),
	new Color(0.3, 0.3, 1.0),
	new Color(0.3, 1.0, 0.3),
	new Color(0.3, 1.0, 1.0),
	new Color(1.0, 0.3, 0.3),
	new Color(1.0, 0.3, 1.0),
	new Color(1.0, 1.0, 0.3),
	new Color(1.0, 1.0, 1.0),
	new Color(0, 0, 0),
	new Color(0, 0, 0.4),
	new Color(0, 0.4, 0),
	new Color(0, 0.4, 0.4),
	new Color(0.4, 0, 0),
	new Color(0.4, 0, 0.4),
	new Color(0.4, 0.3, 0.1),
	new Color(0.4, 0.4, 0.4),
	new Color(0.2, 0.2, 0.2),
	new Color(0.2, 0.2, 0.8),
	new Color(0.2, 0.8, 0.2),
	new Color(0.2, 0.8, 0.8),
	new Color(0.8, 0.2, 0.2),
	new Color(0.8, 0.2, 0.8),
	new Color(0.8, 0.8, 0.2),
	new Color(0.8, 0.8, 0.8),
];

/** [palette index, vertex count, vertex indices] */
type Face = [number, number, number[]];

interface ParsedModel {
	vertices: number[][];
	faces: Face[];
}

const cache = new Map<string, Promise<Geometry[]>>();

/**
 * @param name Model path relative to the models directory, without extension (e.g. "internal/pod1")
 */
export function loadNSH(name: string): Promise<Geometry[]> {
	let promise = cache.get(name);
	if (!promise) {
		promise = source(name).then(createNSH);
		cache.set(name, promise);
	}

	return promise;
}

/** Settles once every model asked for so far has loaded, or failed to: entities then have their shapes */
export async function modelsLoaded(): Promise<void> {
	await Promise.allSettled(cache.values());
}

export function createNSH(data: string): Geometry[] {
	const parsed = parseNSH(data);

	const rotation = quat.create();
	quat.rotateX(rotation, rotation, Math.PI);

	for (const vertex of parsed.vertices) {
		vertex[0] *= SCALE;
		vertex[1] *= -SCALE;
		vertex[2] *= SCALE;
		vec3.transformQuat(vertex, vertex, rotation);
	}

	const getVertex = (index: number): vec3 => {
		const v = parsed.vertices[index];
		return vec3.fromValues(v[0], v[1], v[2]);
	};

	return parsed.faces.map(([colorIndex, count, indices]): Geometry => {
		const color = PALETTE[colorIndex % PALETTE.length];
		const v = indices.slice(0, count).map(getVertex); /* line faces carry a trailing -1 index */

		switch (count) {
			case 2: return line(v[0], v[1], color);
			case 3: return triangle(v[0], v[1], v[2], color);
			case 4: return quad(v[0], v[1], v[2], v[3], color);
			default: throw new Error(`Wrong face definition: ${colorIndex},${count},${indices}`);
		}
	});
}

/** Rewrites the C array syntax to JSON */
export function parseNSH(data: string): ParsedModel {
	data = data.replace(/VECTOR\s+\S+\s*=/g, "\"vertices\":");
	data = data.replace(/SPOLY\s+\S+\s*=/g, "\"faces\":");
	data = data.replace(/;\s*SHAPE[\s\S]*$/g, "");
	data = data.replace(/;/g, ",");
	data = data.replace(/,\s*\}/g, "}");
	data = data.replace(/\{/g, "[");
	data = data.replace(/\}/g, "]");
	return JSON.parse(`{${data}}`) as ParsedModel;
}
