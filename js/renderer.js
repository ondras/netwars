var Renderer = function(camera, options) {
	this._node = document.createElement("canvas");

	this._id = Math.random();
	this._camera = camera;
	this._options = {
		width: 400,
		height: 300,
		color: new Color(0)
	};

	this.setOptions(options);
}

Renderer.prototype.setOptions = function(options) {
	for (var p in options) { this._options[p] = options[p]; }
	this._node.width = this._options.width;
	this._node.height = this._options.height;

	this._camera.syncPort(this._node);
	return this;
}

Renderer.prototype.getNode = function() {
	return this._node;
}

Renderer.prototype.render = function(entities) {
	this._camera.update();
}

Renderer.prototype.deletePrivateData = function(entity) {
}

Renderer.prototype._getPrivateData = function(entity, createIfNone) {
	var allData = entity.__private;
	if (!allData) { /* data storage does not exist */
		if (!createIfNone) { return null; } /* create flag disabled */
		entity.__private = allData = {};
	}

	var myData = allData[this._id];
	if (myData) { /* our data exists */
		return myData;
	} else if (createIfNone) { /* our data does not exist, create flag enabled */
		var data = allData[this._id] = this._createPrivateData(entity);
		return data;
	} else { /* our data does not exist, create flag disabled */
		return null;
	}
}

Renderer.prototype._createPrivateData = function(entity) {
}
