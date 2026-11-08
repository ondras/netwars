import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

/** One line of a recording, in the order things happened */
export type LogEntry =
	/** The match: who is in it (`bot`: not a person) and the side of the cube it is fought in */
	| { k: "start"; time: string; room: string; run: number; mode: string; size: number | null; pilots: Array<{ id: number; name: string; bot: boolean; look: number }> }
	/**
	 * Every ship flying, about 22 times a second: [pilot, x, y, z, qx, qy, qz, qw, shields, speed, speed asked for, yaw stick, pitch stick];
	 * in co-op also every enemy: [enemy, x, y, z, shields, 1 when carrying a pod]
	 */
	| { k: "f"; t: number; s: number[][]; e?: number[][] }
	/** A shot fired, from p with velocity v */
	| { k: "shot"; t: number; by: number; p: number[]; v: number[] }
	/** A rocket launched at a pilot */
	| { k: "rocket"; t: number; by: number }
	/** Shields lost */
	| { k: "hit"; t: number; by: number | null; on: number; damage: number }
	/** A ship destroyed; `by` is null when nobody gets the frag, as in co-op */
	| { k: "kill"; t: number; by: number | null; on: number }
	| { k: "spawn"; t: number; by: number }
	/** Co-op: an enemy arrives */
	| { k: "enemy"; t: number; id: number; kind: string }
	/** Co-op: an enemy loses shields, to a pilot's shot or rocket (`by`), and survives */
	| { k: "struck"; t: number; by: number | null; on: number; damage: number }
	/** Co-op: an enemy destroyed, by a pilot's shot or rocket (`by`) */
	| { k: "downed"; t: number; by: number | null; on: number }
	/** Co-op: a pirate grabs a pod, and gets away with it */
	| { k: "grab"; t: number; by: number }
	| { k: "escaped"; t: number; on: number }
	/** Co-op: a pod destroyed by a pilot's fire */
	| { k: "podShot"; t: number; by: number | null }
	| { k: "powerup"; t: number; by: number; kind: string }
	/** Co-op: with the pods left of how many, and the enemies destroyed of each kind */
	| { k: "end"; t: number; reason: string; pods?: [left: number, total: number]; destroyed?: Record<string, number> };

export interface MatchLog {
	write(entry: LogEntry): void;
	close(): void;
}

/** Makes the log of a match that starts */
export type MatchLogs = (room: string, run: number) => MatchLog;

/** One file per match, a JSON object per line */
export function fileLogs(dir: string): MatchLogs {
	mkdirSync(dir, { recursive: true });
	return (room, run) => {
		const time = new Date().toISOString().replace(/[:.]/g, "-");
		const stream = createWriteStream(join(dir, `${time}-${room}-${run}.jsonl`));
		return {
			write: entry => { stream.write(`${JSON.stringify(entry)}\n`); },
			close: () => { stream.end(); },
		};
	};
}
