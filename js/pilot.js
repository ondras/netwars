var Pilot = function() {
}

Pilot.Player = function(renderer) {
	Pilot.call(this);

	this._firing = false;
	this._speed = 0;
	this._yaw = 0;
	this._pitch = 0;
	var node = renderer.getNode();
	node.addEventListener("mousemove", this);
	node.addEventListener("mousedown", this);

	window.addEventListener("mouseup", this);
	window.addEventListener("keydown", this);
}
Pilot.Player.prototype = Object.create(Pilot.prototype);

Pilot.Player.prototype.update = function(dt, ship) {
	ship._engine.speed.control = this._speed;
	ship._engine.yaw.control = this._yaw;
	ship._engine.pitch.control = this._pitch;

	if (this._firing) { return ship.fire(); }
}

Pilot.Player.prototype.handleEvent = function(e) {
	switch (e.type) {
		case "mousemove":
			var box = e.currentTarget.getBoundingClientRect();
			var x = (e.clientX - box.left) / box.width;
			var y = (e.clientY - box.top) / box.height;

			x = x*2-1;
			y = y*2-1;

			this._yaw = -x;
			this._pitch = -y;
		break;

		case "mousedown":
			this._firing = true;
		break;

		case "mouseup":
			this._firing = false;
		break;

		case "keydown":
			switch (e.keyCode) {
				case 16: // shift
					this._speed += 0.2;
				break;

				case 17: // ctrl
					this._speed -= 0.2;
				break;
			}
		break;
	}
}
