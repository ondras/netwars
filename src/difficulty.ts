/** Game settings that change with the chosen difficulty; read when used, so a change applies at once */
export interface Difficulty {
	readonly label: string;
	/** Shield points a pirate missile takes */
	readonly missileDamage: number;
	/** How fast pirate missiles turn (rad/s); lower is easier to out-turn */
	readonly missileTurnRate: number;
	/** Time between a pirate's missiles, random within the range (s) */
	readonly missileInterval: readonly [number, number];
	/** Shield points a hunter's shot takes */
	readonly hunterDamage: number;
	/**
	 * How many pod thieves come, as a multiple of what the level has (levels.ts, enemyWaves): they come sooner and more at once,
	 * so that the level lasts about as long. The other enemies come after the pilots, and their damage is what makes it harder for them.
	 */
	readonly thieves: number;
	/** How fast pod thieves fly, as a multiple of their own speed */
	readonly thiefSpeed: number;
}

/*
 * Tuned on 2026-11-08 with bots in co-op levels (`pnpm arena coop`), destroyed ships flying again: more thieves rather than tougher ones.
 * Alone, a bot that reacts like the user (COOP_PILOTS.person) never dies on easy and loses about 0.2 pods a level; on normal it loses
 * about 0.9 and dies about twice in each of the last two levels, never in the first two. A quicker one (COOP_PILOTS.ace) loses
 * about 1.1 on hard, 2.7 in the last level, dying about as often as the other on normal.
 */
export const DIFFICULTIES = {
	easy: { label: "Easy", missileDamage: 8, missileTurnRate: 1.6, missileInterval: [6, 10], hunterDamage: 3, thieves: 0.75, thiefSpeed: 0.6 },
	normal: { label: "Normal", missileDamage: 9, missileTurnRate: 2, missileInterval: [4, 8], hunterDamage: 10, thieves: 1, thiefSpeed: 1 },
	hard: { label: "Hard", missileDamage: 9, missileTurnRate: 2.5, missileInterval: [3, 6], hunterDamage: 12, thieves: 1.75, thiefSpeed: 1 },
} as const satisfies Record<string, Difficulty>;

export type DifficultyLevel = keyof typeof DIFFICULTIES;

const STORAGE_KEY = "netwars.difficulty";

let level: DifficultyLevel = load() ?? "normal";

export function difficulty(): Difficulty {
	return DIFFICULTIES[level];
}

export function difficultyLevel(): DifficultyLevel {
	return level;
}

/** Applies at once and is remembered for the next visit */
export function setDifficulty(value: DifficultyLevel): void {
	level = value;
	try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable: not remembered */ }
}

export function isDifficultyLevel(value: string): value is DifficultyLevel {
	return Object.hasOwn(DIFFICULTIES, value);
}

function load(): DifficultyLevel | null {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return (value && isDifficultyLevel(value) ? value : null);
	} catch {
		return null; /* no storage (tests, privacy settings) */
	}
}
