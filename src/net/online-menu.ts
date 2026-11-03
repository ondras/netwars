import { DIFFICULTIES, isDifficultyLevel, type DifficultyLevel } from "../difficulty.ts";
import type { LevelConfig } from "../levels.ts";
import { CODE_LENGTH, MAX_PLAYERS, type RoomInfo } from "./protocol.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Link that opens the game with a room's code filled in */
export function inviteLink(code: string): string {
	const url = new URL(location.href);
	url.search = `?room=${code}`;
	url.hash = "";
	return url.toString();
}

/** The room code in this page's address, if it was opened from an invite link */
export function invitedTo(): string | null {
	const code = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
	return (code.length == CODE_LENGTH ? code : null);
}

/** The "Play online" panel (create a room or join one by code) and the room's lobby (markup in index.html) */
export class OnlineMenu {
	onCreate: ((name: string) => void) | null = null;
	onJoin: ((code: string, name: string) => void) | null = null;
	onBack: (() => void) | null = null;
	/** Host: level or difficulty changed */
	onSetup: ((level: number, difficulty: DifficultyLevel) => void) | null = null;
	onStart: (() => void) | null = null;
	onLeave: (() => void) | null = null;

	private readonly panel = element<HTMLElement>("online");
	private readonly lobby = element<HTMLElement>("lobby");
	private readonly nameInput = element<HTMLInputElement>("online-name");
	private readonly codeInput = element<HTMLInputElement>("online-code");
	private readonly error = element<HTMLElement>("online-error");
	private readonly levelSelect = element<HTMLSelectElement>("lobby-level");
	private readonly difficultySelect = element<HTMLSelectElement>("lobby-difficulty");
	private readonly levels: readonly LevelConfig[];

	constructor(levels: readonly LevelConfig[]) {
		this.levels = levels;

		element<HTMLButtonElement>("online-create").onclick = () => this.onCreate?.(this.nameInput.value);
		element<HTMLFormElement>("online-join").onsubmit = event => {
			event.preventDefault();
			const code = this.codeInput.value.trim().toUpperCase();
			if (code.length != CODE_LENGTH) {
				this.showError(`A room code has ${CODE_LENGTH} letters.`);
				this.codeInput.focus();
				return;
			}
			this.onJoin?.(code, this.nameInput.value);
		};
		this.codeInput.oninput = () => { this.codeInput.value = this.codeInput.value.toUpperCase(); };
		element<HTMLButtonElement>("online-back").onclick = () => this.onBack?.();

		levels.forEach((level, i) => this.levelSelect.append(new Option(`${i + 1}. ${level.name}`, String(i))));
		for (const [value, { label }] of Object.entries(DIFFICULTIES)) { this.difficultySelect.append(new Option(label, value)); }
		const setup = () => {
			const difficulty = this.difficultySelect.value;
			if (isDifficultyLevel(difficulty)) { this.onSetup?.(Number(this.levelSelect.value), difficulty); }
		};
		this.levelSelect.onchange = setup;
		this.difficultySelect.onchange = setup;

		element<HTMLButtonElement>("lobby-start").onclick = () => this.onStart?.();
		element<HTMLButtonElement>("lobby-leave").onclick = () => this.onLeave?.();
		const copy = element<HTMLButtonElement>("lobby-copy");
		copy.onclick = () => {
			const link = element<HTMLInputElement>("lobby-link");
			navigator.clipboard.writeText(link.value).then(
				() => { copy.textContent = "Copied"; },
				() => { link.select(); }, /* no clipboard access: selected, for the keyboard */
			);
		};
	}

	get visible(): boolean {
		return !this.panel.hidden || !this.lobby.hidden;
	}

	get lobbyVisible(): boolean {
		return !this.lobby.hidden;
	}

	/** The panel for creating or joining a room; with a code (from an invite link) ready to join */
	showJoin(name: string, code = ""): void {
		this.lobby.hidden = true;
		this.error.hidden = true;
		this.setBusy(false);
		this.nameInput.value = name;
		if (code) { this.codeInput.value = code; }
		this.panel.hidden = false;
		(code ? element<HTMLButtonElement>("online-join-button") : element<HTMLButtonElement>("online-create")).focus();
	}

	showError(message: string): void {
		this.setBusy(false);
		this.error.textContent = message;
		this.error.hidden = false;
		if (this.panel.hidden) { this.showJoin(this.nameInput.value); this.error.hidden = false; }
	}

	/** While connecting: no second click */
	setBusy(busy: boolean): void {
		for (const button of this.panel.querySelectorAll("button")) { button.disabled = busy; }
	}

	/** The room as it is now; `me` is this player's id */
	showLobby(room: RoomInfo, me: number): void {
		const host = room.host == me;
		const firstShow = this.lobby.hidden;
		this.panel.hidden = true;
		this.lobby.hidden = false;

		element<HTMLElement>("lobby-code").textContent = room.code;
		element<HTMLInputElement>("lobby-link").value = inviteLink(room.code);
		if (firstShow) { element<HTMLButtonElement>("lobby-copy").textContent = "Copy link"; }

		element<HTMLElement>("lobby-players").replaceChildren(...room.players.map(({ id, name, away }) => {
			const item = document.createElement("li");
			const tags = [id == room.host ? "host" : "", id == me ? "you" : "", away ? "reconnecting…" : ""].filter(Boolean);
			item.textContent = name + (tags.length ? ` (${tags.join(", ")})` : "");
			return item;
		}));
		element<HTMLElement>("lobby-count").textContent = `${room.players.length} of ${MAX_PLAYERS} pilots`;

		this.levelSelect.value = String(room.level);
		this.difficultySelect.value = room.difficulty;
		this.levelSelect.disabled = this.difficultySelect.disabled = !host;
		element<HTMLElement>("lobby-description").textContent = this.levels[room.level]?.description ?? "";

		const start = element<HTMLButtonElement>("lobby-start");
		start.hidden = !host;
		element<HTMLElement>("lobby-note").textContent = (room.state == "over"
			? "The others are just finishing a level. The host starts the next one."
			: host ? "Send the link to your wingmates. Start when everyone is in." : "The host picks the level and starts it.");
		if (firstShow) { (host ? start : element<HTMLButtonElement>("lobby-leave")).focus(); }
	}

	hide(): void {
		this.panel.hidden = true;
		this.lobby.hidden = true;
	}
}
