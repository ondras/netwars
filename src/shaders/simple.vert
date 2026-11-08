attribute vec3 aPosition;
attribute vec3 aColor;
/* What an outline turns as its shape gets small on screen; the same as aColor for anything else */
attribute vec3 aUnder;
uniform mat4 uMVmatrix;
uniform mat4 uPmatrix;
/* Shift on screen (clip units); lines drawn several times, slightly shifted, come out thicker */
uniform vec2 uOffset;
/* How much outlines show, 0..1 */
uniform float uOutline;
varying vec3 vColor;

void main(void) {
	gl_Position = uPmatrix * uMVmatrix * vec4(aPosition, 1.0);
	gl_Position.xy += uOffset * gl_Position.w;
	vColor = mix(aUnder, aColor, uOutline);
}
