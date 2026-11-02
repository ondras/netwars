import { Camera } from "./camera.ts";
import { explode } from "./entity/debris.ts";
import { Pod } from "./entity/pod.ts";
import { Ship } from "./entity/ship.ts";
import { Loop } from "./loop.ts";
import { PlayerPilot } from "./pilot.ts";
import { HUD } from "./render/hud.ts";
import { WebGLRenderer } from "./render/webgl.ts";

const container = document.querySelector<HTMLElement>("#game")!;
const loop = new Loop().start();
const camera = new Camera();

const ship = new Ship().fromNSH("missile");
ship.visible = false; /* cockpit view */
loop.scene.push(ship);
ship.setPilot(new PlayerPilot(container));
camera.follow(ship);

for (let i = 0; i < 20; i++) {
	const pod = new Pod();
	pod.position[0] = (Math.random() - 0.5) * 50;
	pod.position[2] = (Math.random() - 0.5) * 50;
	pod.position[1] = (Math.random() - 0.5) * 5;

	loop.scene.push(pod);
}

const scene = new WebGLRenderer(camera);
const hud = new HUD(camera, ship);
hud.node.className = "hud";
container.append(scene.node, hud.node);
loop.renderers.push(scene, hud);

const button = document.createElement("button");
button.id = "explode";
button.textContent = "EXPLODE THEM ALL";
button.onclick = () => {
	for (const entity of loop.scene) { explode(entity, loop); }
};
document.body.append(button);
