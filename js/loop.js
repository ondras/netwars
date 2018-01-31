var Loop = function(options) {
	this._options = {
		interval: 30, /* ms */
		update: 15 /* cca 60fps */
	}
	for (var p in options) { this._options[p] = options[p]; }

	this._running = 0;
	this._ts = 0;
	this._remainingTime = 0;


	this._tickRender = this._tickRender.bind(this);
	this._tickUpdate = this._tickUpdate.bind(this);

	this.scene = [];
	this.renderers = [];
}

Loop.prototype.start = function() {
	if (!this._running) {
		this._ts = Date.now();
		this._remainingTime = 0;
		this._running = setInterval(this._tickUpdate, this._options.interval);
		this._tickRender();
	}
	return this;
}

Loop.prototype.stop = function() {
	if (this._running) { 
		clearInterval(this._running);
		this._running = 0;
	}
	return this;
}

Loop.prototype._tickRender = function() {
	this.renderers.forEach(this._render, this);
	Promise.requestAnimationFrame().then(this._tickRender);
}

Loop.prototype._render = function(renderer) {
	renderer.render(this.scene);
}

Loop.prototype._tickUpdate = function() {
	var ts = Date.now();
	var delta = ts - this._ts;
	this._ts = ts;

	this._remainingTime += delta;

	while (this._remainingTime >= this._options.update) {
		this._remainingTime -= this._options.update;
		this._updateScene();
	}
}

Loop.prototype._updateScene = function() {
	var scene = this.scene;
	var newEntities = scene.map(this._update, this);
	var i=0;

	while (i<scene.length) {
		var entity = scene[i];
		if (entity.dead) {
			scene.splice(i, 1);
			this._deleteEntity(entity);
		} else {
			i++;
		}
	}

	var push = Array.prototype.push;

	newEntities.forEach(function(newSet) {
		if (!newSet || !newSet.length) { return; }
		push.apply(scene, newSet);
	})

}

Loop.prototype._update = function(entity) {
	return entity.update(this._options.update / 1000);
}

Loop.prototype._deleteEntity = function(entity) {
	this.renderers.forEach(function(renderer) {
		renderer.deletePrivateData(entity);
	});
}
