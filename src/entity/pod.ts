import { quat } from "gl-matrix";
import { Entity } from "./entity.ts";

export class Pod extends Entity {
	constructor() {
		super();

		this.fromNSH("internal/pod1");
		quat.rotateY(this.rotation, this.rotation, Math.PI);
	}
}
