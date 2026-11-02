precision mediump float;
uniform sampler2D uTexture;

void main(void) {
	gl_FragColor = texture2D(uTexture, gl_PointCoord);
	if (gl_FragColor.a < 0.5) { discard; }
}
