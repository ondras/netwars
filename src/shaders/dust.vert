attribute vec3 aPosition;
uniform mat4 uPmatrix;
/* view rotation only: positions are relative to the camera here */
uniform mat4 uVmatrix;
uniform vec3 uCamera;
uniform float uSpan;
uniform float uSize;
uniform float uBrightness;
varying float vBrightness;

void main(void) {
	/* grains repeat every uSpan metres in all directions: the copy of each nearest the camera is drawn */
	vec3 near = mod(aPosition - uCamera + 0.5 * uSpan, uSpan) - 0.5 * uSpan;
	gl_Position = uPmatrix * uVmatrix * vec4(near, 1.0);
	gl_PointSize = uSize;
	/* gone before a grain gets to where it jumps to the other side */
	vBrightness = uBrightness * max(0.0, 1.0 - length(near) / (0.5 * uSpan));
}
