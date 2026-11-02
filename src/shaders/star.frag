precision mediump float;
varying float vBrightness;

void main(void) {
	gl_FragColor = vec4(vec3(vBrightness), 1.0);
}
