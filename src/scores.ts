import { DIFFICULTIES, isDifficultyLevel, type DifficultyLevel } from "./difficulty.ts";
import type { EnemyKind } from "./levels.ts";
import { isMechanics, type Mechanics } from "./mechanics.ts";

/** Per pod left when the level is won */
export const POD_POINTS = 100;
/** Per enemy destroyed, won or lost */
export const ENEMY_POINTS: Record<EnemyKind, number> = { pirate: 50, raider: 75, hunter: 100, gunship: 200 };
/** Per shield point left when the level is won */
export const SHIELD_POINTS = 2;
export const DIFFICULTY_FACTOR: Record<DifficultyLevel, number> = { easy: 0.5, normal: 1, hard: 1.5 };

/** Entries kept per level */
export const BOARD_SIZE = 10;
/** Longest player name (characters) */
export const NAME_LENGTH = 16;
const DEFAULT_NAME = "Pilot";

export interface Run {
	won: boolean;
	podsLeft: number;
	/** Missing kinds count as none */
	destroyed: Readonly<Partial<Record<EnemyKind, number>>>;
	shields: number;
	difficulty: DifficultyLevel;
}

export interface ScoreLine {
	label: string;
	points: number;
}

export interface Score {
	lines: ScoreLine[];
	total: number;
}

const count = (n: number, noun: string) => `${n} ${noun}${n == 1 ? "" : "s"}`;

export function score(run: Run): Score {
	const lines: ScoreLine[] = [];

	if (run.won && run.podsLeft) { lines.push({ label: `${count(run.podsLeft, "pod")} saved`, points: run.podsLeft * POD_POINTS }); }
	for (const kind of Object.keys(ENEMY_POINTS) as EnemyKind[]) {
		const destroyed = run.destroyed[kind] ?? 0;
		if (destroyed) { lines.push({ label: `${count(destroyed, kind)} destroyed`, points: destroyed * ENEMY_POINTS[kind] }); }
	}
	const shields = Math.round(run.shields);
	if (run.won && shields > 0) { lines.push({ label: `${shields} shields left`, points: shields * SHIELD_POINTS }); }

	const base = lines.reduce((sum, line) => sum + line.points, 0);
	const factor = DIFFICULTY_FACTOR[run.difficulty];
	const total = Math.round(base * factor);
	if (base && factor != 1) { lines.push({ label: `${DIFFICULTIES[run.difficulty].label} ×${factor}`, points: total - base }); }

	return { lines, total };
}

export interface Entry {
	readonly id: string;
	name: string;
	readonly score: number;
	readonly difficulty: DifficultyLevel;
	/** Missing from scores saved before there was a choice: those are classic */
	readonly mechanics?: Mechanics;
	/** ISO date and time */
	readonly date: string;
}

/** The part of Web Storage used here */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const SCORES_KEY = "netwars.scores";
const NAME_KEY = "netwars.name";

/** localStorage, or null where there is none or it is blocked */
export function browserStorage(): KeyValueStore | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export function cleanName(name: string): string {
	return name.trim().slice(0, NAME_LENGTH) || DEFAULT_NAME;
}

function isEntry(value: unknown): value is Entry {
	const entry = value as Entry;
	return (typeof entry == "object" && entry !== null
		&& typeof entry.id == "string" && typeof entry.name == "string" && typeof entry.date == "string"
		&& Number.isFinite(entry.score) && isDifficultyLevel(String(entry.difficulty))
		&& (entry.mechanics === undefined || isMechanics(String(entry.mechanics))));
}

/**
 * Best scores per level (by level name), highest first; ties keep the earlier score first.
 * Kept in the browser's storage; without storage it lasts until the page is closed.
 */
export class Leaderboard {
	private readonly store: KeyValueStore | null;
	private readonly boards: Record<string, Entry[]>;
	private name: string;

	constructor(store: KeyValueStore | null = browserStorage()) {
		this.store = store;
		this.boards = this.load();
		this.name = cleanName(this.read(NAME_KEY) ?? "");
	}

	/** Name used for the last saved score */
	get lastName(): string {
		return this.name;
	}

	entries(level: string): readonly Entry[] {
		return this.boards[level] ?? [];
	}

	/** @returns 1-based place the score would take, or null when it is 0 or not good enough */
	rankOf(level: string, score: number): number | null {
		if (score <= 0) { return null; }
		const entries = this.entries(level);
		const rank = entries.filter(entry => entry.score >= score).length + 1;
		return (rank <= BOARD_SIZE ? rank : null);
	}

	/** Save the score under the last name used, if it makes the board */
	add(level: string, score: number, difficulty: DifficultyLevel, mechanics: Mechanics = "classic"): Entry | null {
		const rank = this.rankOf(level, score);
		if (rank === null) { return null; }

		const entry: Entry = {
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			name: this.name,
			score,
			difficulty,
			mechanics,
			date: new Date().toISOString(),
		};
		const entries = [...this.entries(level)];
		entries.splice(rank - 1, 0, entry);
		this.boards[level] = entries.slice(0, BOARD_SIZE);
		this.save();
		return entry;
	}

	/** The name to save the next score under (and to fly under online) */
	remember(name: string): void {
		this.name = cleanName(name);
		this.write(NAME_KEY, this.name);
	}

	/** Rename a saved score; the name is also remembered for the next one */
	rename(level: string, id: string, name: string): void {
		this.remember(name);

		const entry = this.entries(level).find(entry => entry.id == id);
		if (entry) {
			entry.name = this.name;
			this.save();
		}
	}

	private load(): Record<string, Entry[]> {
		try {
			const parsed: unknown = JSON.parse(this.read(SCORES_KEY) ?? "{}");
			const boards: Record<string, Entry[]> = {};
			for (const [level, entries] of Object.entries(parsed as object)) {
				if (Array.isArray(entries)) {
					boards[level] = entries.filter(isEntry).sort((a, b) => b.score - a.score).slice(0, BOARD_SIZE);
				}
			}
			return boards;
		} catch {
			return {}; /* missing or damaged: start afresh */
		}
	}

	private save(): void {
		this.write(SCORES_KEY, JSON.stringify(this.boards));
	}

	private read(key: string): string | null {
		try {
			return this.store?.getItem(key) ?? null;
		} catch {
			return null;
		}
	}

	private write(key: string, value: string): void {
		try {
			this.store?.setItem(key, value);
		} catch {
			/* full or blocked: kept for this visit only */
		}
	}
}
