import { CLOSE_REPLACED, NET_PATH, SILENCE_LIMIT, type ClientMessage, type ServerMessage } from "./protocol.ts";

/**
 * The game server's address: VITE_GAME_SERVER when the game is built to be hosted apart from the server
 * (e.g. wss://example.com/net), otherwise the page's own host
 */
export function serverUrl(): string {
	const configured = import.meta.env?.VITE_GAME_SERVER as string | undefined;
	if (configured) { return configured; }
	return `${location.protocol == "https:" ? "wss" : "ws"}://${location.host}${NET_PATH}`;
}

/** Why a connection ended: it dropped (or went silent), or this player came back on another connection */
export type CloseReason = "lost" | "replaced";

/** A WebSocket to the game server, speaking JSON messages */
export class Connection {
	onMessage: ((message: ServerMessage) => void) | null = null;
	/** The connection ended without close() being called */
	onClose: ((reason: CloseReason) => void) | null = null;

	private readonly socket: WebSocket;
	/** When the server was last heard from (ms); it sends something at least every HEARTBEAT */
	private heard = performance.now();
	private readonly watchdog: ReturnType<typeof setInterval>;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.onmessage = event => {
			this.heard = performance.now();
			let message: ServerMessage;
			try {
				message = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				return;
			}
			this.onMessage?.(message);
		};
		socket.onclose = event => this.end(event.code == CLOSE_REPLACED ? "replaced" : "lost");
		/* a network that went away may leave the socket open, with nothing coming through */
		this.watchdog = setInterval(() => {
			if (performance.now() - this.heard > SILENCE_LIMIT * 1000) { this.end("lost"); }
		}, 1000);
	}

	/** Fails when the server cannot be reached, or does not answer within SILENCE_LIMIT */
	static open(url = serverUrl()): Promise<Connection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			const fail = () => {
				clearTimeout(timer);
				socket.onopen = socket.onerror = null;
				socket.close();
				reject(new Error("Cannot reach the game server."));
			};
			const timer = setTimeout(fail, SILENCE_LIMIT * 1000);
			socket.onerror = fail;
			socket.onopen = () => {
				clearTimeout(timer);
				socket.onerror = null;
				resolve(new Connection(socket));
			};
		});
	}

	send(message: ClientMessage): void {
		if (this.socket.readyState == WebSocket.OPEN) { this.socket.send(JSON.stringify(message)); }
	}

	close(): void {
		this.onClose = null;
		this.end("lost");
	}

	private end(reason: CloseReason): void {
		clearInterval(this.watchdog);
		this.onMessage = null;
		this.socket.onclose = null;
		this.socket.close();
		const onClose = this.onClose;
		this.onClose = null;
		onClose?.(reason);
	}
}
