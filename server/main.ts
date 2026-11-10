/* NetWars game server: `pnpm start`. PORT sets the port (default 8787); RECORD_DIR, if set, is where every match is recorded to. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startGameServer } from "./server.ts";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const server = await startGameServer({
	port: Number(process.env.PORT ?? 8787),
	staticDir: (existsSync(dist) ? dist : null),
	modelsDir: fileURLToPath(new URL("../public/models", import.meta.url)),
	...(process.env.RECORD_DIR ? { recordDir: process.env.RECORD_DIR } : {}),
});

console.log(`NetWars server on port ${server.port}${existsSync(dist) ? ", serving the built game" : " (game connection only)"}`);
if (process.env.RECORD_DIR) { console.log(`Recording matches to ${process.env.RECORD_DIR}`); }

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => { server.close().then(() => process.exit(0)); });
}
