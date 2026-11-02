import { vec3 } from "gl-matrix";
import { Loop } from "./loop.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import "./renderer.canvas.js"; /* registers Renderer.Canvas */
import "./renderer.webgl.js"; /* registers Renderer.WebGL */
import { Entity } from "./entity.js";
import "./entity.debris.js"; /* registers Entity.Debris, used by Entity#explode */
import "./entity.pod.js"; /* registers Entity.Pod */
import "./entity.ship.js"; /* registers Entity.Ship */
import { Pilot } from "./pilot.js";

var loop = new Loop().start();

var camera = new Camera();

var r1 = new Renderer.Canvas(camera);
document.body.appendChild(r1.getNode());

var r2 = new Renderer.WebGL(camera);
document.body.appendChild(r2.getNode());

var c2 = new Camera();
c2.lookFrom(vec3.fromValues(0, 50, 0), Math.PI/2, 0, 0);
var r3 = new Renderer.Canvas(c2, {width:640, height:480});
document.body.appendChild(r3.getNode());

loop.renderers.push(r1);
loop.renderers.push(r2);
loop.renderers.push(r3);

for (var i=0;i<20;i++) {
	var pod = new Entity.Pod();
	pod.position[0] = (Math.random()-0.5) * 50;
	pod.position[2] = (Math.random()-0.5) * 50;
	pod.position[1] = (Math.random()-0.5) * 5;

	loop.scene.push(pod);
}

var ship = new Entity.Ship().fromNSH("missile");
loop.scene.push(ship);

var pilot = new Pilot.Player(r1);
ship.setPilot(pilot);

camera.follow(ship, vec3.fromValues(0, 1, 3));

var b = document.createElement("button");
b.innerHTML = "EXPLODE THEM ALL";
b.onclick = function() { 
	loop.scene.forEach(function(entity) { entity.explode(); });
}
document.body.appendChild(b);
