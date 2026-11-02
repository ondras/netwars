/** Game settings that change with the chosen difficulty; read when used, so a change applies at once */
export interface Difficulty {
	readonly label: string;
	/** Shield points a pirate missile takes */
	readonly missileDamage: number;
	/** How fast pirate missiles turn (rad/s); lower is easier to out-turn */
	readonly missileTurnRate: number;
	/** Time between a pirate's missiles, random within the range (s) */
	readonly missileInterval: readonly [number, number];
}

export const DIFFICULTIES = {
	easy: { label: "Easy", missileDamage: 10, missileTurnRate: 1.6, missileInterval: [6, 10] },
	normal: { label: "Normal", missileDamage: 15, missileTurnRate: 2, missileInterval: [4, 8] },
	hard: { label: "Hard", missileDamage: 25, missileTurnRate: 2.5, missileInterval: [3, 6] },
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
