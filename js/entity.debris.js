Entity.Debris = function(parent, velocity) {
	Entity.call(this);
	this._time = 4 + 3*Math.random(); /* life span */

	this.position = vec3.clone(parent.position);

	/* adjust randomly */
	this._initialVelocity = vec3.scale(vec3.create(), velocity, 1 + (Math.random()-0.5));

	/* do not forget to also add parent's velocity part */
	vec3.scaleAndAdd(this._initialVelocity, this._initialVelocity, parent.velocity, 0.5);
}
Entity.Debris.prototype = Object.create(Entity.prototype);

Entity.Debris.COLORS = [0xff1111, 0xff4411, 0xff7711, 0xffaa11, 0xffdd11];

/**
 * Create new debris representing an old geometry component
 */
Entity.Debris.asGeometry = function(parent, geometry, explosionForce) {
	var position = vec3.create();

	/* rotate all points */
	geometry.points.forEach(function(point) {
		vec3.transformQuat(point, point, parent.orientation);
	}, this);

	/* compute debris center */
	geometry.points.forEach(function(point) {
		vec3.add(position, position, point);
	}, this);
	vec3.scale(position, position, 1/geometry.points.length);

	/* adjust geometry points with respect to the center */
	geometry.points.forEach(function(point) {
		vec3.subtract(point, point, position);
	}, this);

	/* convert parent-relative position to velocity */
	var velocity = vec3.normalize(vec3.create(), position);
	vec3.scale(velocity, velocity, explosionForce);

	var debris = new this(parent, velocity);
	debris.geometries.push(geometry);

	/* debris shares position with a parent; adjust it to mirror previous geometry position */
	vec3.add(debris.position, debris.position, position);

	/* add some random rotation */
	var axis = vec3.random(vec3.create());
	quat.setAxisAngle(debris.rotation, axis, Math.random() * 2 * Math.PI);

	return debris;
}

/**
 * Create new debris representing a generic particle circle
 */
Entity.Debris.asParticle = function(parent, explosionForce) {
	var velocity = vec3.random(vec3.create());
	vec3.scale(velocity, velocity, explosionForce);

	var debris = new this(parent, velocity);

	var color = this.COLORS[Math.floor(Math.random() * this.COLORS.length)];
	var circle = new Geometry.Circle(vec3.create(), Math.random()/4, new Color(color));
	debris.geometries.push(circle);

	return debris;
}

Entity.Debris.prototype.update = function(dt) {
	this._time -= dt;
	if (this._time <= 0) {
		this.dead = true;
		return;
	}

	vec3.scale(this.velocity, this._initialVelocity, Math.pow(this._time, 2)/20);
	
	return Entity.prototype.update.call(this, dt);
}
