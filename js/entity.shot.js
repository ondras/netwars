import { vec3 } from "gl-matrix";
import { Entity } from "./entity.js";
import { Geometry } from "./geometry.js";
import { Color } from "./color.js";

Entity.Shot = function(position, velocity) {
	Entity.call(this);

	vec3.copy(this.position, position);
	vec3.copy(this.velocity, velocity);

	this.geometries = [
		new Geometry.Circle(vec3.create(), 0.5, new Color(0xffffff))
	];
}
Entity.Shot.prototype = Object.create(Entity.prototype);
