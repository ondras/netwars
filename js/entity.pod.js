Entity.Pod = function() {
	Entity.call(this);

	this.fromNSH("internal/pod1");
	quat.rotateY(this.rotation, this.rotation, Math.PI);
}
Entity.Pod.prototype = Object.create(Entity.prototype);
