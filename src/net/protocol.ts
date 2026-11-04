/*
 * Messages between the browser and the game server (JSON over a WebSocket).
 *
 * The server runs the level (pods, enemies, their shots, rockets, powerups, shields) and sends snapshots;
 * each browser flies its own ship and reports where it is, what it fired and what it hit, and the server
 * checks all of that (server/checks.ts).
 */
import type { SoundName } from "../audio/sounds.ts";
import type { DifficultyLevel } from "../difficulty.ts";
import type { PowerupKind } from "../entity/powerup.ts";
import type { EnemyKind, Outcome } from "../levels.ts";

/** Where the server takes WebSocket connections */
export const NET_PATH = "/net";
export const MAX_PLAYERS = 4;
/** Room codes: capital letters that cannot be mistaken for one another or for digits */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 4;
/** How often browsers report their ship (per second) */
export const STATE_RATE = 30;
/** Simulation steps between snapshots: 45 ms, about 22 a second */
export const SNAPSHOT_STEPS = 3;
/** How long a player whose connection dropped keeps their place in the room (s); their ship holds course meanwhile */
export const RECONNECT_GRACE = 30;
/** The server sends something at least this often (s), so that browsers can tell a dead connection */
export const HEARTBEAT = 1;
/** A connection silent for this long (s) is taken for dead, at either end */
export const SILENCE_LIMIT = 5;
/** WebSocket close code: the same player came back on another connection (another tab) */
export const CLOSE_REPLACED = 4000;

export const GAME_MODES = ["coop", "deathmatch"] as const;
export type GameMode = (typeof GAME_MODES)[number];
/** Deathmatch: what the host can pick from; a match ends at whichever comes first */
export const FRAG_LIMITS = [5, 10, 20, 30] as const;
export const DEFAULT_FRAG_LIMIT = 10;
/** Minutes */
export const TIME_LIMITS = [3, 5, 10, 15] as const;
export const DEFAULT_TIME_LIMIT = 5;
/** Deathmatch: side of the cube; leaving it on one side is entering it on the other (m) */
export const ARENA_SIZE = 400;
/** Deathmatch: from being destroyed to flying again (s) */
export const RESPAWN_DELAY = 3;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PlayerInfo {
	id: number;
	name: string;
	/** Their connection dropped; they may come back within RECONNECT_GRACE */
	away: boolean;
}

export type RoomState = "lobby" | "playing" | "over";

/** What the host picks in the lobby */
export interface RoomSetup {
	mode: GameMode;
	/** Co-op */
	level: number;
	difficulty: DifficultyLevel;
	/** Deathmatch: frags that end the match */
	fragLimit: number;
	/** Deathmatch: minutes that end the match */
	timeLimit: number;
}

export interface RoomInfo extends RoomSetup {
	code: string;
	/** Player id of the host, who picks the level and starts it */
	host: number;
	players: PlayerInfo[];
	state: RoomState;
}

/** A ship as its pilot's browser last saw it */
export interface ShipState {
	p: Vec3;
	q: Quat;
	/** Current and target speed (m/s) */
	speed: number;
	target: number;
	/** Steering, -1..1 */
	yaw: number;
	pitch: number;
}

/** A shot fired: where it left the muzzle and its velocity */
export interface ShotReport {
	/** Numbers this pilot's shots, for HitReport */
	n: number;
	/** The server time the pilot's screen was showing */
	t: number;
	p: Vec3;
	v: Vec3;
}

/** A rocket launched at an entity; the server flies it, and decides what it hits */
export interface RocketReport {
	p: Vec3;
	target: number;
}

/** A shot of yours hit an entity on your screen */
export interface HitReport {
	/** ShotReport.n */
	shot: number;
	id: number;
	/** The server time your screen was showing */
	t: number;
}

export type ClientMessage =
	| { type: "create"; name: string; level: number; difficulty: DifficultyLevel }
	| { type: "join"; code: string; name: string }
	| { type: "name"; name: string }
	/** Host, in the lobby */
	| ({ type: "setup" } & RoomSetup)
	/** Host: start a level (the one set up when not given) */
	| { type: "start"; level?: number }
	/** Host: back to the lobby after a level */
	| { type: "lobby" }
	/** About STATE_RATE times a second while flying; without a ship, a destroyed ship's shots still landing */
	| { type: "state"; ship?: ShipState; shots: ShotReport[]; rockets: RocketReport[]; hits: HitReport[] }
	| { type: "leave" }
	/** On a new connection, after the old one dropped or the page was reloaded: take my place in my room back */
	| { type: "resume"; token: string };

/* Entities sent in snapshots, by kind */
export const ENTITY_KINDS = [
	"pod", "pirate", "raider", "hunter", "gunship", "missile", "rocket", "player", "grapple",
	"powerup-shields", "powerup-rapid", "powerup-boost", "powerup-rockets",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const powerupKind = (kind: PowerupKind): EntityKind => `powerup-${kind}`;

/**
 * [id, kind (index in ENTITY_KINDS), x, y, z, qx, qy, qz, qw, extra]
 * extra: shields of ships, length of grapples, otherwise 0
 */
export type EntityRecord = [number, number, number, number, number, number, number, number, number, number];

/* Things that happened, each with the server time (s) it happened at */
export type GameEvent =
	/** A sound effect; without a position it is heard as if at the listener */
	| ["sound", number, SoundName, ...([] | Vec3)]
	/** An entity blew up: its id */
	| ["explode", number, number]
	/** A shot to show (it cannot hurt): position, velocity, colour, life span, the shooter's id, 1 if it can only hit players */
	| ["shot", number, ...Vec3, ...Vec3, number, number, number, number]
	/** You collected a powerup */
	| ["powerup", number, PowerupKind]
	/** Deathmatch: who destroyed whom (player ids) */
	| ["frag", number, number, number];

/** Deathmatch, as it stands */
export interface MatchState {
	/** Time left (s) */
	left: number;
	/** Player id → frags */
	frags: Record<number, number>;
}

export interface Snapshot {
	type: "snapshot";
	/** Server simulation time (s) */
	t: number;
	e: EntityRecord[];
	/** Events since the previous snapshot */
	ev: GameEvent[];
	/** Enemies still to come or present */
	enemies: number;
	pods: number;
	/** Your ship's shield points */
	shields: number;
	/** Your ship's id: not among the entities while it is destroyed, a new one once you fly again */
	ship: number;
	match?: MatchState;
}

/** A level started; sent again, as it is now, to a player who comes back while it goes on */
export interface StartMessage {
	type: "start";
	/** Counts the room's levels: tells a level that went on while the connection was down from a new one */
	run: number;
	level: number;
	difficulty: DifficultyLevel;
	/** Player id → id of their ship's entity */
	ships: Record<number, number>;
	/** Your ship: where it is, which way it faces, rockets left; not alive when it was destroyed */
	spawn: Vec3;
	facing: Quat;
	rockets: number;
	alive: boolean;
	podsTotal: number;
	/** Deathmatch: where it is fought and what ends it; null in co-op */
	arena: { size: number; fragLimit: number } | null;
}

export interface Standing {
	id: number;
	name: string;
	frags: number;
}

/** How a deathmatch ended */
export interface MatchResult {
	reason: "frags" | "time";
	/** Most frags first */
	standings: Standing[];
}

export interface OutcomeMessage {
	type: "outcome";
	outcome: Outcome;
	podsLeft: number;
	podsTotal: number;
	destroyed: Record<EnemyKind, number>;
	match?: MatchResult;
}

export type ServerMessage =
	/** You are in a room now (again, after a resume); the token is for resuming */
	| { type: "welcome"; you: number; room: RoomInfo; token: string }
	/** The room changed: players, settings or state */
	| { type: "room"; room: RoomInfo }
	| { type: "error"; message: string }
	| StartMessage
	| Snapshot
	| OutcomeMessage
	/** Every HEARTBEAT: the connection is alive */
	| { type: "ping" };

/** Rounded for sending: centimetres and four decimals are plenty */
export const round = (value: number, digits: number): number => {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
};
