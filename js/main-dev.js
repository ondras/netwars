var scene = [];

var tmp = new Entity();
tmp.position[2] = -20;
quat.rotateY(tmp.rotation, tmp.rotation, 0.5);
tmp.geometries.push(new Geometry.Triangle(vec3.fromValues(0, 5, 0), vec3.fromValues(-5, 0, 0), vec3.fromValues(5, 0, 0), new Color(0xff8800)));

var canvas = document.createElement("canvas");
canvas.width = canvas.height = 50;
var ctx = canvas.getContext("2d");
ctx.fillStyle = "red";
ctx.fillRect(0, 0, canvas.width, canvas.height);
tmp.geometries.push(new Geometry.Billboard(vec3.fromValues(3, 0, 0.1), 1, canvas));

var canvas = document.createElement("canvas");
canvas.width = canvas.height = 50;
var ctx = canvas.getContext("2d");
ctx.fillStyle = "blue";
ctx.fillRect(0, 0, canvas.width, canvas.height);
tmp.geometries.push(new Geometry.Billboard(vec3.fromValues(-3, 0, 0.1), 1, canvas));

scene.push(tmp);

var tmp = new Entity.Circle(1, new Color(0x33ff33));
tmp.position[2] = -10;
scene.push(tmp);

var loop = new Loop();
loop.start();
loop.scene = scene;

var camera = new Camera();

camera.update = function() {
	mat4.rotateZ(this.vMatrix, this.vMatrix, 0.02);
}

var r1 = new Renderer.Canvas(camera);
document.body.appendChild(r1.getNode());

var r2 = new Renderer.WebGL(camera);
document.body.appendChild(r2.getNode());

loop.renderers.push(r1);
loop.renderers.push(r2);
