Entity.Circle = function(radius, color) {
	Entity.call(this);
	this._build(radius, color);
}
Entity.Circle.prototype = Object.create(Entity.prototype);

Entity.Circle._cache = {};

Entity.Circle.prototype._build = function(radius, color) {
	var canvas = this._getCanvas(color);
	var billboard = new Geometry.Billboard(vec3.fromValues(0, 0, 0), radius, canvas);
	this.geometries.push(billboard);
}

Entity.Circle.prototype._getCanvas = function(color) {
	var key = color.toString();
	var cache = Entity.Circle._cache;
	var r = 32;

	if (!(key in cache)) {
		var canvas = document.createElement("canvas");
		canvas.width = canvas.height = 2*r;
		var ctx = canvas.getContext("2d");
		ctx.fillStyle = key;
		ctx.beginPath();
		ctx.arc(r, r, r, 0, 2*Math.PI, true);
		ctx.fill();
		cache[key] = canvas;
	}

	return cache[key];
}