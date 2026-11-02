import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { circle } from "../geometry.ts";
import { Entity } from "./entity.ts";

export class Shot extends Entity {
	constructor(position: vec3, velocity: vec3) {
		super();

		vec3.copy(this.position, position);
		vec3.copy(this.velocity, velocity);

		this.geometries = [circle(vec3.create(), 0.5, new Color(0xffffff))];
	}
}
