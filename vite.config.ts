import { defineConfig } from "vite";

/* In development the game server runs on its own port (pnpm start); the page reaches it through Vite */
export default defineConfig({
	server: {
		proxy: {
			"/net": { target: "ws://127.0.0.1:8787", ws: true },
		},
	},
});
