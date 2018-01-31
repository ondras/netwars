var Entity = function() {
	this.position = vec3.create();
	this.velocity = vec3.create();
	this.orientation = quat.create();
	this.rotation = quat.create();
	this.scale = vec3.fromValues(1, 1, 1);
	this.geometries = [];
	this.dead = false;

	this._debris = null;
}

Entity.prototype.fromNSH = function(path) {
	NSH.load(path).then(function(geometries) {
		this.geometries = geometries;
	}.bind(this));

	return this;
}

Entity.prototype.getModelMatrix = function() {
	var result = mat4.create();
	mat4.fromRotationTranslation(result, this.orientation, this.position);
	mat4.scale(result, result, this.scale);
	return result;
}

/**
 * @return 
 */
Entity.prototype.update = function(dt) {
	if (this.dead && this._debris) {
		var debris = this._debris;
		this._debris = null;
		return debris;
	}

	vec3.scaleAndAdd(this.position, this.position, this.velocity, dt);

	var tmp = quat.multiply(quat.create(), this.orientation, this.rotation);
	quat.slerp(this.orientation, this.orientation, tmp, dt);
	quat.normalize(this.orientation, this.orientation);
}

/**
 * Destroy this entity, create debris
 */
Entity.prototype.explode = function(force) {
	this.dead = true;

	this._debris = [];
	force = force || 1;

	for (var i=0;i<this.geometries.length;i++) {
		var debris = Entity.Debris.asGeometry(this, this.geometries[i], force);
		this._debris.push(debris);
		var particle = Entity.Debris.asParticle(this, force);
		this._debris.push(particle);
	}

	return this;
}
