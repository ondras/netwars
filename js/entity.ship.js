Entity.Ship = function() {
	Entity.call(this);

	this._pilot = null;
	this._weapon = new Weapon();

	this._engine = {
		speed: {
			value: 0,
			changeRate: 15,	/* m/s^2 */
			limit: 15,
			control: 0		/* -1..1 */
		},

		yaw: {
			changeRate: 3.5,	/* rad/s */
			control: 0		/* -1..1 */
		},

		pitch: {
			changeRate: 3.5,	/* rad/s */
			control: 0		/* -1..1 */
		}

	}

}
Entity.Ship.prototype = Object.create(Entity.prototype);

Entity.Ship.prototype.fire = function() {
	return this._weapon.fire(this);
}

Entity.Ship.prototype.update = function(dt) {
	if (this._pilot) {
		var pilotResult = this._pilot.update(dt, this);
	}

	quat.identity(this.rotation);

	this._updateYaw(dt);
	this._updatePitch(dt);
	this._updateSpeed(dt);

	var entityResult = Entity.prototype.update.call(this, dt); /* FIXME */

	return pilotResult || entityResult;
}

Entity.Ship.prototype.setPilot = function(pilot) {
	this._pilot = pilot;
	return this;
}

Entity.Ship.prototype._updateSpeed = function(dt) {
	var speed = this._engine.speed;

	var sign = speed.value ? speed.value/Math.abs(speed.value) : 0;
	var diff = speed.changeRate * dt;

	if (speed.control) { /* force */
		diff *= speed.control;
		if (Math.abs(speed.value + diff) > speed.limit) { diff = sign*speed.limit - speed.value; }
	} else if (sign) { /* decay */
		diff *= -sign;
		if (diff/speed.value < -1) { diff = -speed.value; }
	} else {
		return;
	}

	speed.value += diff;

	vec3.set(this.velocity, 0, 0, -1); /* cardinal direction corresponding to default model orientation */
	vec3.scale(this.velocity, this.velocity, speed.value);
	vec3.transformQuat(this.velocity, this.velocity, this.orientation);
}

Entity.Ship.prototype._updateYaw = function(dt) {
	var yaw = this._engine.yaw;
	var diff = yaw.changeRate * yaw.control;
	quat.rotateY(this.rotation, this.rotation, diff);
}

Entity.Ship.prototype._updatePitch = function(dt) {
	var pitch = this._engine.pitch;
	var diff = pitch.changeRate * pitch.control;
	quat.rotateX(this.rotation, this.rotation, diff);
}
