import { isDifficultyLevel } from "./difficulty.ts";
import { DEFAULT_LOOK, isLook } from "./entity/player-ships.ts";
import { FRAG_LIMITS, GAME_MODES, TIME_LIMITS, type GameMode, type RoomSetup } from "./net/protocol.ts";

/** Player settings, remembered in the browser for the next visit */

const VOLUME_KEY = "netwars.volume";
const LOOK_KEY = "netwars.look";
const ROOM_SETUP_KEY = "netwars.room-setup";
const NAMES_KEY = "netwars.names";
const DEFAULT_VOLUME = 0.8;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

let volume = load();
let look = loadLook();
let roomSetup = loadRoomSetup();
let names = loadNames();

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

/** Online: whether other pilots' names show over their ships */
export function namesShown(): boolean {
	return names;
}

export function setNamesShown(shown: boolean): void {
	names = shown;
	try { localStorage.setItem(NAMES_KEY, String(shown)); } catch { /* storage unavailable: not remembered */ }
}

function loadNames(): boolean {
	try {
		return localStorage.getItem(NAMES_KEY) != "false";
	} catch {
		return true; /* no storage (tests, privacy settings) */
	}
}

/** What this player last picked for a room as its host: their next room starts with it; null before the first time */
export function lastRoomSetup(): RoomSetup | null {
	return roomSetup;
}

export function setLastRoomSetup(setup: RoomSetup): void {
	const text = JSON.stringify(setup);
	roomSetup = readRoomSetup(text);
	try { localStorage.setItem(ROOM_SETUP_KEY, text); } catch { /* storage unavailable: not remembered */ }
}

/** A room setup as stored, or null when there is none, or it is not one any more (the choices changed since it was stored) */
export function readRoomSetup(stored: string | null): RoomSetup | null {
	if (stored === null) { return null; }
	try {
		const { mode, level, difficulty, fragLimit, timeLimit } = JSON.parse(stored) as RoomSetup;
		const known = <T>(choices: readonly T[], value: unknown) => choices.includes(value as T);
		if (!known<GameMode>(GAME_MODES, mode) || !Number.isInteger(level) || level < 0 || !isDifficultyLevel(String(difficulty))
			|| !known<number>(FRAG_LIMITS, fragLimit) || !known<number>(TIME_LIMITS, timeLimit)) { return null; }
		return { mode, level, difficulty, fragLimit, timeLimit };
	} catch {
		return null; /* not even JSON, or not an object */
	}
}

function loadRoomSetup(): RoomSetup | null {
	try {
		return readRoomSetup(localStorage.getItem(ROOM_SETUP_KEY));
	} catch {
		return null; /* no storage (tests, privacy settings) */
	}
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
