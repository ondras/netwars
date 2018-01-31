var scene = [];

var tmp = new Entity();
tmp.position[2] = -20;
tmp.geometries.push(new Geometry.Line(vec3.fromValues(-5, 0, 0), vec3.fromValues(5, 0, 0), new Color(0xff8800)));

var canvas = document.createElement("canvas");
canvas.width = canvas.height = 50;
var ctx = canvas.getContext("2d");
ctx.fillStyle = "red";
ctx.fillRect(0, 0, canvas.width, canvas.height);

tmp.geometries.push(new Geometry.Billboard(vec3.fromValues(0, 0, 0), 2, canvas));

scene.push(tmp);

var loop = new Loop();
loop.start();
loop.entities = scene;

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

	scene.push(pod);
}

var ship = new Entity.Ship().fromNSH("missile");
scene.push(ship);
ship.position[2] = 0;
ship._engine.yaw.control = 1;

camera.follow(ship, vec3.fromValues(0, 1, 3));
