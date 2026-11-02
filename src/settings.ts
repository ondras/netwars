/** Player settings, remembered in the browser for the next visit */

const VOLUME_KEY = "netwars.volume";
const DEFAULT_VOLUME = 0.8;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

let volume = load();

/** Sound effects volume, 0..1 */
export function effectsVolume(): number {
	return volume;
}

export function setEffectsVolume(value: number): void {
	volume = clamp(value);
	try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* storage unavailable: not remembered */ }
}

function load(): number {
	try {
		const stored = localStorage.getItem(VOLUME_KEY);
		const value = Number(stored);
		return (stored !== null && Number.isFinite(value) ? clamp(value) : DEFAULT_VOLUME);
	} catch {
		return DEFAULT_VOLUME; /* no storage (tests, privacy settings) */
	}
}
