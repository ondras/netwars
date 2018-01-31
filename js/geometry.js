var Geometry = {
	LINE: 1,
	TRIANGLE: 2,
	QUAD: 3,
	BILLBOARD: 4,
	_cache: {},

	Line: function(p1, p2, color) {
		this.type = Geometry.LINE;
		this.points = [p1, p2];
		this.color = color;
	},

	Triangle: function(p1, p2, p3, color) {
		this.type = Geometry.TRIANGLE;
		this.points = [p1, p2, p3];
		this.color = color;
	},

	Quad: function(p1, p2, p3, p4, color) {
		this.type = Geometry.QUAD;
		this.points = [p1, p2, p3, p4];
		this.color = color;
	},

	/**
	 * @param {vec3}
	 * @param {number}
	 * @param {HTMLImageElement || HTMLCanvasElement}
	 */
	Billboard: function(p1, radius, texture) {
		this.type = Geometry.BILLBOARD;
		this.points = [p1];
		this.radius = radius;
		this.texture = texture;
	},

	Circle: function(p1, radius, color) {
		var key = color.toString();
		var cache = Geometry._cache;
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

		Geometry.Billboard.call(this, p1, radius, cache[key]);
	}
}
