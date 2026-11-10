attribute vec3 aPosition;
attribute float aBrightness;
uniform mat4 uPmatrix;
/* view rotation only: stars are infinitely far away */
uniform mat4 uVmatrix;
uniform float uSize;
varying float vBrightness;

void main(void) {
	gl_Position = uPmatrix * uVmatrix * vec4(aPosition, 1.0);
	gl_PointSize = uSize;
	vBrightness = aBrightness;
}
