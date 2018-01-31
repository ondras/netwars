Renderer.WebGL = function(camera, options) {
	Renderer.apply(this, arguments);

	this._program = null;
	this._programs = {};

	var o = {alpha:false, antialias:false};
	for (var p in options) { o[p] = options[p]; }
	var gl = this._node.getContext("webgl", o) || this._node.getContext("experimental-webgl", o);
	if (!gl) { throw new Error("WebGL not supported"); }
	this._ctx = gl;

	this._programs.simple = this._createProgram(
		"#vs", "#fs",
		["aPosition", "aColor"],
		["uPmatrix", "uMVmatrix"]
	);
	this._programs.billboard = this._createProgram(
		"#vs-billboard", "#fs-billboard",
		["aPosition", "aRadius"],
		["uPmatrix", "uMVmatrix", "uTexture", "uViewport"]
	);

	gl.enable(gl.CULL_FACE);
	gl.enable(gl.DEPTH_TEST);

	var c = this._options.color.rgb;
	gl.clearColor(c[0], c[1], c[2], 1);
}

Renderer.WebGL.prototype = Object.create(Renderer.prototype);

Renderer.WebGL.prototype.render = function(entities) {
	Renderer.prototype.render.call(this, entities);
	var gl = this._ctx;

	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	entities.forEach(this._renderEntity, this);
}

Renderer.WebGL.prototype._renderEntity = function(entity) {
	if (!entity.geometries.length) { return; }

	var gl = this._ctx;
	var data = this._getPrivateData(entity, true);

	var mvMatrix = mat4.multiply(mat4.create(), this._camera.vMatrix, entity.getModelMatrix());

	for (var type in data) {
		var dataSet = data[type];
		switch (parseInt(type)) {
			case Geometry.LINE:
			case Geometry.TRIANGLE:
			case Geometry.QUAD:
				this._useProgram(this._programs.simple);
				var a = this._program.attributes;
				var u = this._program.uniforms;

				gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);

				gl.bindBuffer(gl.ARRAY_BUFFER, dataSet.points);
				gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

				gl.bindBuffer(gl.ARRAY_BUFFER, dataSet.colors);
				gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, 0, 0);

				if (type == Geometry.LINE) {
					gl.drawArrays(gl.LINES, 0, 2*dataSet.count);
				} else {
					gl.drawArrays(gl.TRIANGLES, 0, 3*dataSet.count);
				}
			break;

			case Geometry.BILLBOARD:
				this._useProgram(this._programs.billboard);
				var a = this._program.attributes;
				var u = this._program.uniforms;

				gl.uniformMatrix4fv(u.uMVmatrix, false, mvMatrix);

				gl.activeTexture(gl.TEXTURE0);
				gl.uniform1i(u.uTexture, 0);

				gl.uniform1f(u.uViewport, this._node.width);

				gl.bindBuffer(gl.ARRAY_BUFFER, dataSet.points);
				gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 0, 0);

				gl.bindBuffer(gl.ARRAY_BUFFER, dataSet.radiuses);
				gl.vertexAttribPointer(a.aRadius, 1, gl.FLOAT, false, 0, 0);

				dataSet.textures.forEach(function(texture, index) {
					gl.bindTexture(gl.TEXTURE_2D, texture);
					gl.drawArrays(gl.POINTS, index, 1);
				}, this);

			break;
		}
	}
}

Renderer.WebGL.prototype._shaderFromNode = function(q) {
	var node = document.querySelector(q);
	if (!node) { throw new Error("Cannot find shader for selector '"+q+"'"); }

	var gl = this._ctx;

	var src = "";
	var child = node.firstChild;

	while (child) {
		if (child.nodeType == child.TEXT_NODE) { src += child.textContent; }
		child = child.nextSibling;
	}

	if (node.type == "x-shader/x-fragment") {
		var type = gl.FRAGMENT_SHADER;
	} else if (node.type == "x-shader/x-vertex") {
		var type = gl.VERTEX_SHADER;
	} else {
		throw new Error("Unknown shader type '" + node.type +"'");
	}

	return this._shaderFromString(type, src);
}

Renderer.WebGL.prototype._shaderFromString = function(type, str) {
	var gl = this._ctx;

	var shader = gl.createShader(type);
	gl.shaderSource(shader, str);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		throw new Error("Could not compile shader: " + gl.getShaderInfoLog(shader));
	}
	return shader;
}

Renderer.WebGL.prototype._createProgram = function(vsId, fsId, attributes, uniforms) {
	var gl = this._ctx;
	var result = {
		program: null,
		attributes: {},
		uniforms: {}
	};

	var vs = this._shaderFromNode(vsId);
	var fs = this._shaderFromNode(fsId);

	result.program = gl.createProgram();
	gl.attachShader(result.program, vs);
	gl.attachShader(result.program, fs);
	gl.linkProgram(result.program);

	if (!gl.getProgramParameter(result.program, gl.LINK_STATUS)) {
		throw new Error("Could not link the shader program");
	}

	gl.deleteShader(vs);
	gl.deleteShader(fs);

	attributes.forEach(function(name) {
		result.attributes[name] = gl.getAttribLocation(result.program, name);
		gl.enableVertexAttribArray(result.attributes[name]);
	}, this);

	uniforms.forEach(function(name) {
		result.uniforms[name] = gl.getUniformLocation(result.program, name);
	}, this);


	return result;
}

Renderer.WebGL.prototype._useProgram = function(program) {
	if (program == this._program) { return; }
	this._program = program;

	var gl = this._ctx;
	gl.useProgram(this._program.program);

	gl.uniformMatrix4fv(this._program.uniforms.uPmatrix, false, this._camera.pMatrix);
}

Renderer.WebGL.prototype._createPrivateData = function(entity) {
	var data = {};
	data[Geometry.LINE] = {
		points: [],
		colors: [],
		count: 0
	};
	data[Geometry.TRIANGLE] = {
		points: [],
		colors: [],
		count: 0
	};
	data[Geometry.QUAD] = {
		points: [],
		colors: [],
		count: 0
	};
	data[Geometry.BILLBOARD] = {
		points: [],
		radiuses: [],
		textures: [],
		count: 0
	}

	var push = [].push;

	entity.geometries.forEach(function(geometry) {
		var type = geometry.type;
		var dataSet = data[type];
		if (!dataSet) { return; }

		switch (type) {
			case Geometry.LINE:
			case Geometry.TRIANGLE:
				dataSet.count++;
				for (var i=0;i<geometry.points.length;i++) {
					push.apply(dataSet.points, geometry.points[i]);
					push.apply(dataSet.colors, geometry.color.rgb);
				}
			break;

			case Geometry.QUAD:
				dataSet.count += 2;
				var indices = [0, 1, 2, 0, 2, 3];
				indices.forEach(function(index) {
					push.apply(dataSet.points, geometry.points[index]);
					push.apply(dataSet.colors, geometry.color.rgb);
				});
			break;

			case Geometry.BILLBOARD:
				dataSet.count++;
				dataSet.textures.push(geometry.texture);
				push.apply(dataSet.points, geometry.points[0]);
				dataSet.radiuses.push(geometry.radius);
			break;
		}
	});

	for (var type in data) {
		var dataSet = data[type];
		if (!dataSet.count) { 
			delete data[type];
			continue; 
		}

		for (var p in dataSet) {
			var value = dataSet[p];
			if (!(value instanceof Array)) { continue; } 

			if (typeof(value[0]) == "number") {
				dataSet[p] = this._buffer(value);
			} else {
				dataSet[p] = value.map(this._texture, this);
			}
		}
	}

	return data;
}

Renderer.WebGL.prototype._texture = function(source) {
	var gl = this._ctx;

	var texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); 

	return texture;
}

Renderer.WebGL.prototype._buffer = function(array) {
	var gl = this._ctx;

	var buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(array), gl.STATIC_DRAW);
	return buffer;
}

Renderer.WebGL.prototype.deletePrivateData = function(entity) {
	var data = this._getPrivateData(entity, false);
	if (!data) { return; }

	var gl = this._ctx;

	for (var type in data) {
		var dataSet = data[type];

		for (var p in dataSet) {
			var value = dataSet[p];
			if (value instanceof WebGLBuffer) {
				gl.deleteBuffer(value);
			} else if (value instanceof Array) {
				while (value.length) { gl.deleteTexture(value.pop()); }
			}
		}

		delete data[type];
	}
}