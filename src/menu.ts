import { DIFFICULTIES, difficultyLevel, isDifficultyLevel, setDifficulty } from "./difficulty.ts";
import type { LevelConfig } from "./levels.ts";

export interface ResultAction {
	label: string;
	action: () => void;
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The main menu and the end-of-level panel (markup in index.html) */
export class Menu {
	/** Called with the chosen level index */
	onStart: ((level: number) => void) | null = null;

	private readonly menu = element<HTMLElement>("menu");
	private readonly levelSelect = element<HTMLSelectElement>("level");
	private readonly levelDescription = element<HTMLElement>("level-description");
	private readonly difficultySelect = element<HTMLSelectElement>("difficulty");
	private readonly result = element<HTMLElement>("result");
	private readonly levels: readonly LevelConfig[];

	constructor(levels: readonly LevelConfig[]) {
		this.levels = levels;

		levels.forEach((level, i) => this.levelSelect.append(new Option(`${i + 1}. ${level.name}`, String(i))));
		this.levelSelect.onchange = () => this.describeLevel();

		for (const [value, { label }] of Object.entries(DIFFICULTIES)) { this.difficultySelect.append(new Option(label, value)); }
		this.difficultySelect.value = difficultyLevel();
		this.difficultySelect.onchange = () => {
			if (isDifficultyLevel(this.difficultySelect.value)) { setDifficulty(this.difficultySelect.value); }
		};

		element<HTMLButtonElement>("start").onclick = () => this.start();
	}

	get visible(): boolean {
		return !this.menu.hidden;
	}

	show(level: number): void {
		this.hideResult();
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

	showResult(title: string, text: string, actions: readonly ResultAction[]): void {
		element<HTMLElement>("result-title").textContent = title;
		element<HTMLElement>("result-text").textContent = text;

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

		this.result.hidden = false;
		(buttons.firstElementChild as HTMLElement | null)?.focus();
	}

	hideResult(): void {
		this.result.hidden = true;
	}

	private describeLevel(): void {
		const level = this.levels[Number(this.levelSelect.value)];
		this.levelDescription.textContent = level?.description ?? "";
	}
}
