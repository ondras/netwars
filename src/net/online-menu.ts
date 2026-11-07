import { DIFFICULTIES, isDifficultyLevel, type DifficultyLevel } from "../difficulty.ts";
import { lookName, shipGeometries } from "../entity/player-ships.ts";
import type { LevelConfig } from "../levels.ts";
import { shipIcon } from "../render/ship-icon.ts";
import { ARENA_SIZE, CODE_LENGTH, FRAG_LIMITS, GAME_MODES, MAX_PLAYERS, TIME_LIMITS, type GameMode, type RoomInfo, type RoomSetup } from "./protocol.ts";

const MODE_LABELS: Record<GameMode, string> = { coop: "Co-op", deathmatch: "Deathmatch" };

const PILOT_ICON_SIZE = 28;

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

/** The multiplayer panel (create a room or join one by code) and the room's lobby (markup in index.html) */
export class OnlineMenu {
	onCreate: ((name: string) => void) | null = null;
	onJoin: ((code: string, name: string) => void) | null = null;
	onBack: (() => void) | null = null;
	/** Host: mode, level, difficulty or a limit changed */
	onSetup: ((setup: RoomSetup) => void) | null = null;
	onStart: (() => void) | null = null;
	onLeave: (() => void) | null = null;
	/** The button for picking your ship pressed */
	onShip: (() => void) | null = null;
	/** Host: add a bot to the room, or take one out */
	onAddBot: (() => void) | null = null;
	onRemoveBot: ((id: number) => void) | null = null;

	private readonly panel = element<HTMLElement>("online");
	private readonly backButton = element<HTMLButtonElement>("online-back");
	private readonly lobby = element<HTMLElement>("lobby");
	private readonly nameInput = element<HTMLInputElement>("online-name");
	private readonly codeInput = element<HTMLInputElement>("online-code");
	private readonly error = element<HTMLElement>("online-error");
	private readonly modeSelect = element<HTMLSelectElement>("lobby-mode");
	private readonly levelSelect = element<HTMLSelectElement>("lobby-level");
	private readonly difficultySelect = element<HTMLSelectElement>("lobby-difficulty");
	private readonly fragSelect = element<HTMLSelectElement>("lobby-frags");
	private readonly timeSelect = element<HTMLSelectElement>("lobby-time");
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
		this.backButton.onclick = () => this.onBack?.();

		levels.forEach((level, i) => this.levelSelect.append(new Option(`${i + 1}. ${level.name}`, String(i))));
		for (const [value, { label }] of Object.entries(DIFFICULTIES)) { this.difficultySelect.append(new Option(label, value)); }
		for (const mode of GAME_MODES) { this.modeSelect.append(new Option(MODE_LABELS[mode], mode)); }
		for (const frags of FRAG_LIMITS) { this.fragSelect.append(new Option(`${frags} frags`, String(frags))); }
		for (const minutes of TIME_LIMITS) { this.timeSelect.append(new Option(`${minutes} minutes`, String(minutes))); }
		element<HTMLElement>("lobby-match-description").textContent =
			`Every pilot for themselves in a cube of ${ARENA_SIZE} m: fly out of one side and you come back in on the other. A destroyed ship flies again after a moment. The match ends at the frag limit or the time limit, whichever comes first.`;

		const setup = () => {
			const difficulty = this.difficultySelect.value as DifficultyLevel;
			if (!isDifficultyLevel(difficulty)) { return; }
			this.onSetup?.({
				mode: this.modeSelect.value as GameMode,
				level: Number(this.levelSelect.value),
				difficulty,
				fragLimit: Number(this.fragSelect.value),
				timeLimit: Number(this.timeSelect.value),
			});
		};
		for (const select of [this.modeSelect, this.levelSelect, this.difficultySelect, this.fragSelect, this.timeSelect]) { select.onchange = setup; }

		element<HTMLButtonElement>("lobby-start").onclick = () => this.onStart?.();
		element<HTMLButtonElement>("lobby-leave").onclick = () => this.onLeave?.();
		element<HTMLButtonElement>("lobby-ship").onclick = () => this.onShip?.();
		element<HTMLButtonElement>("lobby-add-bot").onclick = () => this.onAddBot?.();
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

	/** Esc: the panel's Back button, if the panel is open and not busy connecting */
	back(): void {
		if (!this.panel.hidden && !this.backButton.disabled) { this.onBack?.(); }
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

		element<HTMLElement>("lobby-players").replaceChildren(...room.players.map(({ id, name, away, look, bot }) => {
			const item = document.createElement("li");
			item.title = lookName(look);
			const tags = [id == room.host ? "host" : "", id == me ? "you" : "", away ? "reconnecting…" : "", bot ? "bot" : ""].filter(Boolean);
			item.innerHTML = shipIcon(shipGeometries(look), PILOT_ICON_SIZE);
			item.append(name + (tags.length ? ` (${tags.join(", ")})` : ""));
			if (bot && host) {
				const remove = document.createElement("button");
				remove.type = "button";
				remove.textContent = "Remove";
				remove.onclick = () => this.onRemoveBot?.(id);
				item.append(remove);
			}
			return item;
		}));
		element<HTMLButtonElement>("lobby-add-bot").hidden = !host || room.players.length >= MAX_PLAYERS;
		const mine = room.players.find(({ id }) => id == me);
		if (mine) { element<HTMLButtonElement>("lobby-ship").textContent = lookName(mine.look); }
		element<HTMLElement>("lobby-count").textContent = `${room.players.length} of ${MAX_PLAYERS} pilots`;

		this.modeSelect.value = room.mode;
		this.levelSelect.value = String(room.level);
		this.difficultySelect.value = room.difficulty;
		this.fragSelect.value = String(room.fragLimit);
		this.timeSelect.value = String(room.timeLimit);
		for (const select of [this.modeSelect, this.levelSelect, this.difficultySelect, this.fragSelect, this.timeSelect]) { select.disabled = !host; }
		element<HTMLElement>("lobby-description").textContent = this.levels[room.level]?.description ?? "";
		element<HTMLElement>("lobby-coop").hidden = room.mode != "coop";
		element<HTMLElement>("lobby-match").hidden = room.mode != "deathmatch";

		const start = element<HTMLButtonElement>("lobby-start");
		start.hidden = !host;
		element<HTMLElement>("lobby-note").textContent = (room.state == "over"
			? "The others are just finishing a level. The host starts the next one."
			: host ? "Send the link to the other pilots. Start when everyone is in." : "The host sets up the game and starts it.");
		if (firstShow) { (host ? start : element<HTMLButtonElement>("lobby-leave")).focus(); }
	}

	hide(): void {
		this.panel.hidden = true;
		this.lobby.hidden = true;
	}
}
