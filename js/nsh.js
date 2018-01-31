var NSH = {
	path: "models/",
	_cache: {},
	_palette: [
		new Color(0,	0,		0),
		new Color(0,	0,		0.6),
		new Color(0,	0.6,	0),
		new Color(0,	0.6,	0.6),
		new Color(0.6,	0,		0),
		new Color(0.6,	0,		0.6),
		new Color(0.6,	0.5,	0.2),
		new Color(0.6,	0.6,	0.6),
		new Color(0.3,	0.3,	0.3),
		new Color(0.3,	0.3,	1.0),
		new Color(0.3,	1.0,	0.3),
		new Color(0.3,	1.0,	1.0),
		new Color(1.0,	0.3,	0.3),
		new Color(1.0,	0.3,	1.0),
		new Color(1.0,	1.0,	0.3),
		new Color(1.0,	1.0,	1.0),
		new Color(0,	0,		0),
		new Color(0,	0,		0.4),
		new Color(0,	0.4,	0),
		new Color(0,	0.4,	0.4),
		new Color(0.4,	0,		0),
		new Color(0.4,	0,		0.4),
		new Color(0.4,	0.3,	0.1),
		new Color(0.4,	0.4,	0.4),
		new Color(0.2,	0.2,	0.2),
		new Color(0.2,	0.2,	0.8),
		new Color(0.2,	0.8,	0.2),
		new Color(0.2,	0.8,	0.8),
		new Color(0.8,	0.2,	0.2),
		new Color(0.8,	0.2,	0.8),
		new Color(0.8,	0.8,	0.2),
		new Color(0.8,	0.8,	0.8)
	],

	create: function(data) {
		var parsed = this._parse(data);
		var geometries = [];
		var scale = 1/100;

		var rotation = quat.create();
		quat.rotateX(rotation, rotation, Math.PI);

		parsed.vertices.forEach(function(vertex) {
			vertex[0] *=  scale;
			vertex[1] *= -scale;
			vertex[2] *=  scale;
			vec3.transformQuat(vertex, vertex, rotation);
		});

		var getVertex = function(index) {
			return vec3.fromValues.apply(vec3, parsed.vertices[index]);
		}

		parsed.faces.forEach(function(face) {
			var color = this._palette[face[0] % this._palette.length];
			switch (face[1]) {
				case 2:
					var geometry = new Geometry.Line(
						getVertex(face[2][0]),
						getVertex(face[2][1]),
						color
					);
					geometries.push(geometry);
				break;

				case 3:
					var geometry = new Geometry.Triangle(
						getVertex(face[2][0]),
						getVertex(face[2][1]),
						getVertex(face[2][2]),
						color
					);
					geometries.push(geometry);
				break;

				case 4:
					var geometry = new Geometry.Quad(
						getVertex(face[2][0]),
						getVertex(face[2][1]),
						getVertex(face[2][2]),
						getVertex(face[2][3]),
						color
					);
					geometries.push(geometry);
				break;

				default:
					throw new Error("Wrong face definition: " + face);
				break;
			}

		}, this);

		return geometries;
	},

	load: function(path) {
		path = this.path + path + ".nsh";

		var cache = this._cache;
		if (path in cache) { return Promise.resolve(cache[path]); }

		var promise = new Promise(function(resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open("get", path, true);
			Promise.send(xhr).then(function() {
				try {
					var entity = this.create(xhr.responseText);
					resolve(entity);
				} catch (e) {
					reject(e);
				}
			}.bind(this), reject);
		}.bind(this));

		cache[path] = promise;
		return promise;
	},

	_parse: function(data) {
		data = data.replace(/VECTOR\s+\S+\s*=/g, "\"vertices\":");
		data = data.replace(/SPOLY\s+\S+\s*=/g, "\"faces\":");
		data = data.replace(/;\s*SHAPE[\s\S]*$/g, "");
		data = data.replace(/;/g, ",");
		data = data.replace(/,\s*\}/g, "}");
		data = data.replace(/\{/g, "[");
		data = data.replace(/\}/g, "]");
		data = "{" + data + "}";
		return JSON.parse(data);
	}
}
