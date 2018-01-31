var Color = function(r, g, b) {
	this.rgb = vec3.create();

	if (arguments.length == 3) {
		vec3.copy(this.rgb, arguments);
	} else if (typeof(arguments[0]) == "string") { 
		/* FIXME */
	} else if (typeof(arguments[0]) == "number") {
		vec3.set(this.rgb, (r >> 16 & 255)/255, (r >> 8 & 255)/255, (r & 255)/255);
	}
}

Color.prototype.toString = function() {
	return "rgb(" + Math.round(255*this.rgb[0]) + "," + Math.round(255*this.rgb[1]) + "," + Math.round(255*this.rgb[2]) + ")";
}