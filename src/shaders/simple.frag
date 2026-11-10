precision mediump float;
varying vec3 vColor;
/** How much of it shows, 0..1: far away, things darken into the black of space */
uniform float uFade;

void main(void) {
	gl_FragColor = vec4(vColor * uFade, 1.0);
}
