var Control = function() {
	this._ship = null;
}

Control.prototype.setShip = function(ship) {
	this._ship = ship;
	return this;
}

Control.Player = function(renderer) {
	Control.call(this);

	var node = renderer.getNode();
	node.addEventListener("mousemove", this);

	window.addEventListener("keydown", this);
}
Control.Player.prototype = Object.create(Control.prototype);

Control.Player.prototype.handleEvent = function(e) {
	if (!this._ship) { return; }

	switch (e.type) {
		case "mousemove":
		break;
			var box = e.currentTarget.getBoundingClientRect();
			var x = (e.clientX - box.left) / box.width;
			var y = (e.clientY - box.top) / box.height;

			x = x*2-1;
			y = y*2-1;

			this._ship._engine.yaw.control = -x;
			this._ship._engine.pitch.control = -y;
		break;

		case "keydown":
			switch (e.keyCode) {
				case 16: // shift
					this._ship._engine.speed.control += 0.2;
				break;

				case 17: // ctrl
					this._ship._engine.speed.control -= 0.2;
				break;
			}
		break;
	}
}
