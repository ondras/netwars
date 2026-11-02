import { vec3 } from "gl-matrix";
import { Camera } from "./camera.ts";
import { explode } from "./entity/debris.ts";
import { Pod } from "./entity/pod.ts";
import { Ship } from "./entity/ship.ts";
import { Loop } from "./loop.ts";
import { PlayerPilot } from "./pilot.ts";
import { CanvasRenderer } from "./render/canvas.ts";
import { WebGLRenderer } from "./render/webgl.ts";

const loop = new Loop().start();

const camera = new Camera();

const r1 = new CanvasRenderer(camera);
document.body.appendChild(r1.node);

const r2 = new WebGLRenderer(camera);
document.body.appendChild(r2.node);

const c2 = new Camera();
c2.lookFrom(vec3.fromValues(0, 50, 0), Math.PI / 2, 0, 0);
const r3 = new CanvasRenderer(c2, { width: 640, height: 480 });
document.body.appendChild(r3.node);

loop.renderers.push(r1, r2, r3);

for (let i = 0; i < 20; i++) {
	const pod = new Pod();
	pod.position[0] = (Math.random() - 0.5) * 50;
	pod.position[2] = (Math.random() - 0.5) * 50;
	pod.position[1] = (Math.random() - 0.5) * 5;

	loop.scene.push(pod);
}

const ship = new Ship().fromNSH("missile");
loop.scene.push(ship);

ship.setPilot(new PlayerPilot(r1.node));

camera.follow(ship, vec3.fromValues(0, 1, 3));

const button = document.createElement("button");
button.textContent = "EXPLODE THEM ALL";
button.onclick = () => {
	for (const entity of loop.scene) { explode(entity); }
};
document.body.appendChild(button);
