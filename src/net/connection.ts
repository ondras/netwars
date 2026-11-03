import { NET_PATH, type ClientMessage, type ServerMessage } from "./protocol.ts";

/**
 * The game server's address: VITE_GAME_SERVER when the game is built to be hosted apart from the server
 * (e.g. wss://example.com/net), otherwise the page's own host
 */
export function serverUrl(): string {
	const configured = import.meta.env?.VITE_GAME_SERVER as string | undefined;
	if (configured) { return configured; }
	return `${location.protocol == "https:" ? "wss" : "ws"}://${location.host}${NET_PATH}`;
}

/** A WebSocket to the game server, speaking JSON messages */
export class Connection {
	onMessage: ((message: ServerMessage) => void) | null = null;
	/** The server went away (not called after close()) */
	onClose: (() => void) | null = null;

	private readonly socket: WebSocket;

	private constructor(socket: WebSocket) {
		this.socket = socket;
		socket.onmessage = event => {
			let message: ServerMessage;
			try {
				message = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				return;
			}
			this.onMessage?.(message);
		};
		socket.onclose = () => this.onClose?.();
	}

	static open(url = serverUrl()): Promise<Connection> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			socket.onopen = () => resolve(new Connection(socket));
			socket.onerror = () => reject(new Error("Cannot reach the game server."));
		});
	}

	send(message: ClientMessage): void {
		if (this.socket.readyState == WebSocket.OPEN) { this.socket.send(JSON.stringify(message)); }
	}

	close(): void {
		this.onClose = null;
		this.onMessage = null;
		this.socket.close();
	}
}
