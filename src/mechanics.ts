/**
 * How the game plays, picked in the settings between games: classic, as it always did, or modern, where pilots strafe
 * and hunters and gunships allow for it (Difficulty, MODERN in ./difficulty.ts). Online, the room plays its creator's pick.
 */
export const MECHANICS = {
	classic: { label: "Classic", strafing: false, description: "Ships fly where they point." },
	modern: { label: "Modern", strafing: true, description: "Strafe with A / D. Hunters and gunships lead their shots and hit harder." },
} as const;

export type Mechanics = keyof typeof MECHANICS;

const STORAGE_KEY = "netwars.mechanics";

let current: Mechanics = load() ?? "classic";

export function mechanics(): Mechanics {
	return current;
}

/** Remembered for the next visit; it applies from the next level or room on */
export function setMechanics(value: Mechanics): void {
	current = value;
	try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable: not remembered */ }
}

export function isMechanics(value: string): value is Mechanics {
	return Object.hasOwn(MECHANICS, value);
}

function load(): Mechanics | null {
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return (value && isMechanics(value) ? value : null);
	} catch {
		return null; /* no storage (tests, privacy settings) */
	}
}
