precision mediump float;
uniform sampler2D uTexture;
/** How much of it shows, 0..1: far away, things darken into the black of space */
uniform float uFade;

void main(void) {
	gl_FragColor = texture2D(uTexture, gl_PointCoord);
	if (gl_FragColor.a < 0.5) { discard; }
	gl_FragColor.rgb *= uFade;
}
