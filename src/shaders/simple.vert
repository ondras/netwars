attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMVmatrix;
uniform mat4 uPmatrix;
varying vec3 vColor;

void main(void) {
	gl_Position = uPmatrix * uMVmatrix * vec4(aPosition, 1.0);
	vColor = aColor;
}
