import { DIFFICULTIES, difficultyLevel, isDifficultyLevel, setDifficulty } from "./difficulty.ts";
import { helpMarkup } from "./help.ts";
import type { LevelConfig } from "./levels.ts";
import type { Entry, Leaderboard, Score } from "./scores.ts";

export interface ResultAction {
	label: string;
	action: () => void;
}

export interface ResultScore {
	score: Score;
	/** Name of the level played, which names its board */
	level: string;
	/** The score as saved on the board just now (under the last name used), or null when it did not make it */
	entry: Entry | null;
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Table row of [text, class name] cells */
function row(cells: ReadonlyArray<readonly [string, string]>, className = ""): HTMLTableRowElement {
	const tr = document.createElement("tr");
	tr.className = className;
	for (const [text, cellClass] of cells) {
		const td = tr.insertCell();
		td.textContent = text;
		td.className = cellClass;
	}
	return tr;
}

function renderBoard(table: HTMLTableElement, entries: readonly Entry[], current: string | null = null): void {
	if (!entries.length) {
		const empty = row([["No scores yet", "empty"]]);
		empty.cells[0].colSpan = 4;
		table.replaceChildren(empty);
		return;
	}

	table.replaceChildren(...entries.map((entry, i) => row([
		[`${i + 1}.`, "number"],
		[entry.name, "name"],
		[DIFFICULTIES[entry.difficulty].label, ""],
		[String(entry.score), "number"],
	], entry.id == current ? "current" : "")));
}

function renderScore(table: HTMLTableElement, { lines, total }: Score): void {
	const sign = (points: number) => (points < 0 ? String(points) : `+${points}`);
	table.replaceChildren(
		...lines.map(({ label, points }) => row([[label, ""], [sign(points), "number"]])),
		row([["Score", ""], [String(total), "number"]], "total"),
	);
}

/** The main menu, the end-of-level, pause and settings panels (markup in index.html) */
export class Menu {
	/** Called with the chosen level index */
	onStart: ((level: number) => void) | null = null;
	onResume: (() => void) | null = null;
	/** Leave the paused level for the main menu */
	onLeave: (() => void) | null = null;
	/** The effects volume slider moves (0..1) */
	onVolume: ((volume: number) => void) | null = null;
	/** The effects volume slider is let go */
	onVolumeSet: (() => void) | null = null;

	private readonly menu = element<HTMLElement>("menu");
	private readonly levelSelect = element<HTMLSelectElement>("level");
	private readonly levelDescription = element<HTMLElement>("level-description");
	private readonly difficultySelect = element<HTMLSelectElement>("difficulty");
	private readonly result = element<HTMLElement>("result");
	private readonly pause = element<HTMLElement>("pause");
	private readonly settings = element<HTMLElement>("settings");
	private readonly help = element<HTMLElement>("help-panel");
	/** Settings or help, open in place of another panel which comes back when it closes */
	private modal: { panel: HTMLElement; from: HTMLElement } | null = null;
	private readonly levels: readonly LevelConfig[];
	private readonly leaderboard: Leaderboard;

	constructor(levels: readonly LevelConfig[], leaderboard: Leaderboard, volume: number) {
		this.levels = levels;
		this.leaderboard = leaderboard;

		levels.forEach((level, i) => this.levelSelect.append(new Option(`${i + 1}. ${level.name}`, String(i))));
		this.levelSelect.onchange = () => this.describeLevel();

		for (const [value, { label }] of Object.entries(DIFFICULTIES)) { this.difficultySelect.append(new Option(label, value)); }
		this.difficultySelect.value = difficultyLevel();
		this.difficultySelect.onchange = () => {
			if (isDifficultyLevel(this.difficultySelect.value)) { setDifficulty(this.difficultySelect.value); }
		};

		element<HTMLButtonElement>("start").onclick = () => this.start();
		const volumeSlider = element<HTMLInputElement>("effects-volume");
		element<HTMLButtonElement>("menu-settings").onclick = () => this.openModal(this.settings, this.menu, volumeSlider);
		element<HTMLButtonElement>("pause-settings").onclick = () => this.openModal(this.settings, this.pause, volumeSlider);
		element<HTMLButtonElement>("settings-back").onclick = () => this.closeModal();

		element<HTMLElement>("help-content").innerHTML = helpMarkup();
		element<HTMLButtonElement>("menu-help").onclick = () => this.openModal(this.help, this.menu, this.help); /* the panel, not its button at the bottom, so it opens scrolled to the top */
		element<HTMLButtonElement>("help-back").onclick = () => this.closeModal();
		element<HTMLButtonElement>("resume").onclick = () => this.onResume?.();
		element<HTMLButtonElement>("leave").onclick = () => this.onLeave?.();

		const slider = element<HTMLInputElement>("effects-volume");
		const showVolume = () => { element<HTMLOutputElement>("effects-volume-value").value = `${slider.value} %`; };
		slider.value = String(Math.round(volume * 100));
		showVolume();
		slider.oninput = () => {
			showVolume();
			this.onVolume?.(Number(slider.value) / 100);
		};
		slider.onchange = () => this.onVolumeSet?.();
	}

	get visible(): boolean {
		return !this.menu.hidden;
	}

	/** Settings or help is open */
	get modalVisible(): boolean {
		return this.modal !== null;
	}

	showPause(): void {
		this.pause.hidden = false;
		element<HTMLButtonElement>("resume").focus();
	}

	hidePause(): void {
		this.pause.hidden = true;
		this.dropModal();
		(document.activeElement as HTMLElement | null)?.blur(); /* give the keyboard back to the game */
	}

	/** Back to the panel the settings or help were opened from */
	closeModal(): void {
		const modal = this.modal;
		if (!modal) { return; }
		this.dropModal();

		modal.from.hidden = false;
		(modal.from.querySelector("button") as HTMLButtonElement | null)?.focus();
	}

	show(level: number): void {
		this.hideResult();
		this.pause.hidden = true;
		this.dropModal();
		this.levelSelect.value = String(level);
		this.describeLevel();
		this.menu.hidden = false;
		element<HTMLButtonElement>("start").focus();
	}

	start(): void {
		this.menu.hidden = true;
		(document.activeElement as HTMLElement | null)?.blur(); /* give the keyboard back to the game */
		this.onStart?.(Number(this.levelSelect.value));
	}

	/** End-of-level panel; when the score made the board, it first asks for the player's name */
	showResult(title: string, text: string, actions: readonly ResultAction[], { score, level, entry }: ResultScore): void {
		element<HTMLElement>("result-title").textContent = title;
		element<HTMLElement>("result-text").textContent = text;
		renderScore(element<HTMLTableElement>("result-score"), score);

		element<HTMLElement>("result-board-title").textContent = `Best scores · ${level}`;
		const board = () => renderBoard(element<HTMLTableElement>("result-board"), this.leaderboard.entries(level), entry?.id);
		board();

		const buttons = element<HTMLElement>("result-actions");
		buttons.replaceChildren(...actions.map(({ label, action }) => {
			const button = document.createElement("button");
			button.textContent = label;
			button.onclick = () => {
				this.hideResult();
				button.blur();
				action();
			};
			return button;
		}));
		const focusActions = () => (buttons.firstElementChild as HTMLElement | null)?.focus();

		const form = element<HTMLFormElement>("result-name");
		form.hidden = !entry;
		this.result.hidden = false;

		if (!entry) {
			focusActions();
			return;
		}

		const rank = this.leaderboard.entries(level).findIndex(({ id }) => id == entry.id) + 1;
		element<HTMLElement>("result-rank").textContent = `New best score: number ${rank} on ${level}`;

		/* the score is saved already; typing renames it, so leaving the panel any way keeps it */
		const input = element<HTMLInputElement>("player-name");
		input.value = entry.name;
		input.oninput = () => {
			this.leaderboard.rename(level, entry.id, input.value);
			board();
		};
		form.onsubmit = event => {
			event.preventDefault();
			input.value = entry.name; /* trimmed, or the default name for an empty field */
			form.hidden = true;
			focusActions();
		};

		input.focus();
		input.select();
	}

	hideResult(): void {
		this.result.hidden = true;
	}

	private openModal(panel: HTMLElement, from: HTMLElement, focus: HTMLElement): void {
		from.hidden = true;
		panel.hidden = false;
		panel.scrollTop = 0;
		this.modal = { panel, from };
		focus.focus();
	}

	/** Hide the settings or help without showing what they were opened from */
	private dropModal(): void {
		if (this.modal) { this.modal.panel.hidden = true; }
		this.modal = null;
	}

	private describeLevel(): void {
		const level = this.levels[Number(this.levelSelect.value)];
		this.levelDescription.textContent = level?.description ?? "";
		if (!level) { return; }

		element<HTMLElement>("menu-board-title").textContent = `Best scores · ${level.name}`;
		renderBoard(element<HTMLTableElement>("menu-board"), this.leaderboard.entries(level.name));
	}
}
