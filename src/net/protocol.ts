/*
 * Messages between the browser and the game server (JSON over a WebSocket).
 *
 * Co-op: the server runs the level (pods, enemies, their shots, powerups, shields) and sends snapshots;
 * each browser flies its own ship and reports where it is, what it fired and what it hit.
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
/** Most shield damage a single reported hit may do: a rocket's */
export const MAX_HIT_DAMAGE = 50;

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface PlayerInfo {
	id: number;
	name: string;
}

export type RoomState = "lobby" | "playing" | "over";

export interface RoomInfo {
	code: string;
	/** Player id of the host, who picks the level and starts it */
	host: number;
	players: PlayerInfo[];
	level: number;
	difficulty: DifficultyLevel;
	state: RoomState;
}

/** A ship as its pilot's browser last saw it */
export interface ShipState {
	p: Vec3;
	q: Quat;
	v: Vec3;
	/** Current and target speed (m/s) */
	speed: number;
	target: number;
	/** Steering, -1..1 */
	yaw: number;
	pitch: number;
}

/** A shot fired: where it left the muzzle and its velocity */
export interface ShotReport {
	p: Vec3;
	v: Vec3;
}

/** A rocket launched at an entity */
export interface RocketReport {
	p: Vec3;
	v: Vec3;
	target: number;
}

/** A shot or rocket of yours hit an entity */
export interface HitReport {
	id: number;
	damage: number;
}

export type ClientMessage =
	| { type: "create"; name: string; level: number; difficulty: DifficultyLevel }
	| { type: "join"; code: string; name: string }
	| { type: "name"; name: string }
	/** Host, in the lobby */
	| { type: "setup"; level: number; difficulty: DifficultyLevel }
	/** Host: start a level (the one set up when not given) */
	| { type: "start"; level?: number }
	/** Host: back to the lobby after a level */
	| { type: "lobby" }
	/** About STATE_RATE times a second while flying */
	| { type: "state"; ship: ShipState; shots: ShotReport[]; rockets: RocketReport[]; hits: HitReport[] }
	| { type: "leave" };

/* Entities sent in snapshots, by kind */
export const ENTITY_KINDS = [
	"pod", "pirate", "raider", "hunter", "gunship", "missile", "player", "grapple",
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
	/** A teammate's rocket to show: position, velocity, the shooter's id, the target's id */
	| ["rocket", number, ...Vec3, ...Vec3, number, number]
	/** You collected a powerup */
	| ["powerup", number, PowerupKind];

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
}

export interface StartMessage {
	type: "start";
	level: number;
	difficulty: DifficultyLevel;
	/** Player id → id of their ship's entity */
	ships: Record<number, number>;
	/** Where your ship starts */
	spawn: Vec3;
	podsTotal: number;
}

export interface OutcomeMessage {
	type: "outcome";
	outcome: Outcome;
	podsLeft: number;
	podsTotal: number;
	destroyed: Record<EnemyKind, number>;
}

export type ServerMessage =
	/** You are in a room now */
	| { type: "welcome"; you: number; room: RoomInfo }
	/** The room changed: players, settings or state */
	| { type: "room"; room: RoomInfo }
	| { type: "error"; message: string }
	| StartMessage
	| Snapshot
	| OutcomeMessage;

/** Rounded for sending: centimetres and four decimals are plenty */
export const round = (value: number, digits: number): number => {
	const scale = 10 ** digits;
	return Math.round(value * scale) / scale;
};
