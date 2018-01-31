var Weapon = function() {
	this._lastFired = 0;
}

Weapon.prototype.fire = function(ship) {
	var now = Date.now();
	if (now - this._lastFired < 150) { return; } /* FIXME */
	this._lastFired = now;

	var velocity = vec3.fromValues(0, 0, -1);
	vec3.transformQuat(velocity, velocity, ship.orientation);

	var position = vec3.clone(ship.position);
	vec3.scaleAndAdd(position, position, velocity, 1);

	vec3.scale(velocity, velocity, 50); /* fixme */

	return [new Entity.Shot(position, velocity)];
}
