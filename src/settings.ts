import { DEFAULT_LOOK, isLook } from "./entity/player-ships.ts";

/** Player settings, remembered in the browser for the next visit */

const VOLUME_KEY = "netwars.volume";
const LOOK_KEY = "netwars.look";
const DEFAULT_VOLUME = 0.8;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

let volume = load();
let look = loadLook();

/** Sound effects volume, 0..1 */
export function effectsVolume(): number {
	return volume;
}

export function setEffectsVolume(value: number): void {
	volume = clamp(value);
	try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* storage unavailable: not remembered */ }
}

/** Which ship and colours this player flies (./entity/player-ships.ts) */
export function shipLook(): number {
	return look;
}

export function setShipLook(value: number): void {
	look = (isLook(value) ? value : DEFAULT_LOOK);
	try { localStorage.setItem(LOOK_KEY, String(look)); } catch { /* storage unavailable: not remembered */ }
}

function loadLook(): number {
	try {
		const stored = localStorage.getItem(LOOK_KEY);
		const value = Number(stored);
		return (stored !== null && isLook(value) ? value : DEFAULT_LOOK);
	} catch {
		return DEFAULT_LOOK; /* no storage (tests, privacy settings) */
	}
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
