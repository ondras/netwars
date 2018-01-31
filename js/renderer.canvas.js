Renderer.Canvas = function(camera, options) {
	Renderer.apply(this, arguments);
	this.ctx = this._node.getContext("2d");
}

Renderer.Canvas.prototype = Object.create(Renderer.prototype);

Renderer.Canvas.prototype.render = function(entities) {
	Renderer.prototype.render.call(this, entities);

	this._clear();
	this.ctx.setTransform(1, 0, 0, -1, this._node.width/2, this._node.height/2);

	var data = this._projectAndSortEntities(entities);
	data.forEach(function(entity) {
		entity.geometries.forEach(this._renderGeometry, this);
	}, this);

	this.ctx.setTransform(1, 0, 0, 1, 0, 0);
}

Renderer.Canvas.prototype._projectAndSortEntities = function(entities) {
	var results = [];

	/* View-Projection, computed once, multiplied with Model matrix for each entity */
	var vpMatrix = mat4.multiply(mat4.create(), this._camera.pMatrix, this._camera.vMatrix);
	
	/* Model-View-Projection, re-used for each entity */
	var mvpMatrix = mat4.create();

	/* Model-View for billboards, re-used for each entity */
	var mvMatrix = mat4.create();

	for (var i=0;i<entities.length;i++) {
		var entity = entities[i];
		if (!entity.geometries.length) { continue; }

		var mMatrix = entity.getModelMatrix();

		mat4.multiply(mvpMatrix, vpMatrix, mMatrix);
		mat4.multiply(mvMatrix, this._camera.vMatrix, mMatrix);

		var pos = this._project(vec3.create(), mvpMatrix);
		var limit = 1.1;
		if (Math.abs(pos[0]) > limit || Math.abs(pos[1]) > limit) { continue; }
		if (pos[2] > 1 || pos[2] < 0) { continue; }

		var item = {
			depth: pos[2],
			geometries: this._projectAndSortGeometries(entity.geometries, mvpMatrix, mvMatrix)
		}
		results.push(item);

	}

	return results.sort(this._depthSort);
}

/**
 * @param {object[]} geometries
 * @param {mat4} mvpMatrix Complete MVP matrix
 * @param {mat4} mvMatrix Model-View matrix necessary for billboard size computation
 */
Renderer.Canvas.prototype._projectAndSortGeometries = function(geometries, mvpMatrix, mvMatrix) {
	var results = [];

	for (var i=0;i<geometries.length;i++) {
		var geometry = geometries[i];

		var points = [];
		var count = geometry.points.length;
		var z = 0;

		for (var j=0;j<count;j++) {
			var projected = this._project(geometry.points[j], mvpMatrix);
			z += projected[2];
			points.push(projected);
		}

		if (geometry.type == Geometry.TRIANGLE || geometry.type == Geometry.QUAD) {  /* backface culling */
			var v1 = vec3.subtract(vec3.create(), points[1], points[0]);
			var v2 = vec3.subtract(vec3.create(), points[2], points[0]);
			var cross = vec3.cross(vec3.create(), v1, v2);
			/* FIXME optimize */
			if (cross[2] < 0) { continue; }
		}

		var item = {
			type: geometry.type,
			color: geometry.color,
			texture: geometry.texture,
			points: points,
			depth: z/count
		}

		if (geometry.type == Geometry.BILLBOARD) {
			var center = geometry.points[0];
			var mvCenter = this._project(center, mvMatrix);
			var mvOffset = vec3.clone(mvCenter);
			mvOffset[0] += geometry.radius;

			var ndcCenter = this._project(mvCenter, this._camera.pMatrix);
			var ndcOffset = this._project(mvOffset, this._camera.pMatrix);
			item.radius = (ndcOffset[0]-ndcCenter[0]) * this._node.width/2;
		}
		results.push(item);

	}

	return results.sort(this._depthSort);
}

Renderer.Canvas.prototype._renderGeometry = function(geometry) {
	var p = geometry.points.map(this._toScreen, this);

	switch (geometry.type) {
		case Geometry.LINE:
			this.ctx.beginPath();
			this.ctx.moveTo(p[0][0], p[0][1]);
			this.ctx.lineTo(p[1][0], p[1][1]);
			this.ctx.strokeStyle = geometry.color.toString();
			this.ctx.stroke();
		break;

		case Geometry.TRIANGLE:
		case Geometry.QUAD:
			this.ctx.beginPath();
			this.ctx.moveTo(p[0][0], p[0][1]);
			for (var i=1;i<p.length;i++) {
				this.ctx.lineTo(p[i][0], p[i][1]);
			}
			this.ctx.fillStyle = geometry.color.toString();
			this.ctx.fill();
		break;

		case Geometry.BILLBOARD:
			var r = geometry.radius;
			this.ctx.drawImage(geometry.texture, p[0][0]-r, p[0][1]-r, 2*r, 2*r);
		break;
	}
}

Renderer.Canvas.prototype._project = function(position, mvpMatrix) {
	return vec3.transformMat4(vec3.create(), position, mvpMatrix);
}

Renderer.Canvas.prototype._toScreen = function(position) {
	return vec2.fromValues(position[0] * this._node.width/2, position[1] * this._node.height/2);
}

Renderer.Canvas.prototype._depthSort = function(part1, part2) {
	return part2.depth - part1.depth;
}

Renderer.Canvas.prototype._clear = function() {
	this.ctx.fillStyle = this._options.color.toString();
	this.ctx.fillRect(0, 0, this._node.width, this._node.height);
}
