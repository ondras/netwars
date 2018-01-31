var Timer = function(options) {
	this._options = {
		interval: 30, /* ms */
		timeStep: 15 /* cca 60fps */
	}
	for (var p in options) { this._options[p] = options[p]; }

	this._running = 0;
	this._ts = 0;
	this._remainingTime = 0;


	this._tickRender = this._tickRender.bind(this);
	this._tickTimeStep = this._tickTimeStep.bind(this);

	this.entities = [];
	this.renderers = [];
}

Timer.prototype.start = function() {
	if (!this._running) {
		this._ts = Date.now();
		this._remainingTime = 0;
		this._running = setInterval(this._tickTimeStep, this._options.interval);
		this._tickRender();
	}
	return this;
}

Timer.prototype.stop = function() {
	if (this._running) { 
		clearInterval(this._running);
		this._running = 0;
	}
	return this;
}

Timer.prototype._tickRender = function() {
	this.renderers.forEach(this._render, this);
	Promise.requestAnimationFrame().then(this._tickRender);
}

Timer.prototype._render = function(renderer) {
	renderer.render(this.entities);
}

Timer.prototype._tickTimeStep = function() {
	var ts = Date.now();
	var delta = ts - this._ts;
	this._ts = ts;

	this._remainingTime += delta;

	while (this._remainingTime >= this._options.timeStep) {
		this._remainingTime -= this._options.timeStep;
		this.entities.forEach(this._timeStep, this);
	}
}

Timer.prototype._timeStep = function(entity) {
	entity.timeStep(this._options.timeStep / 1000);
}
