attribute vec3 aPosition;
attribute float aRadius;
uniform mat4 uMVmatrix;
uniform mat4 uPmatrix;
uniform float uViewport;

void main(void) {
	vec4 center = uMVmatrix * vec4(aPosition, 1.0);
	vec4 offset = center;
	offset.x += aRadius;

	gl_Position = uPmatrix * center;
	vec4 offsetPosition = uPmatrix * offset;

	gl_PointSize = (offsetPosition.x/offsetPosition.w - gl_Position.x/gl_Position.w) * uViewport;
}
