import { vec3 } from "gl-matrix";

export class Color {
	/** Components in the 0..1 range */
	readonly rgb = vec3.create();

	/** @param hex 0xRRGGBB */
	constructor(hex: number);
	/** Components in the 0..1 range */
	constructor(r: number, g: number, b: number);
	constructor(r: number, g?: number, b?: number) {
		if (g === undefined || b === undefined) {
			vec3.set(this.rgb, (r >> 16 & 255) / 255, (r >> 8 & 255) / 255, (r & 255) / 255);
		} else {
			vec3.set(this.rgb, r, g, b);
		}
	}

	/** How bright it looks, 0..1 */
	get luminance(): number {
		const [r, g, b] = this.rgb;
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}

	toString(): string {
		const [r, g, b] = this.rgb;
		return `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`;
	}
}
