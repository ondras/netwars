import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

/** One line of a recording, in the order things happened */
export type LogEntry =
	/** The match: who is in it (`bot`: not a person) and the side of the cube it is fought in */
	| { k: "start"; time: string; room: string; run: number; mode: string; size: number | null; pilots: Array<{ id: number; name: string; bot: boolean; look: number }> }
	/** Every ship flying, about 22 times a second: [pilot, x, y, z, qx, qy, qz, qw, shields, speed, speed asked for, yaw stick, pitch stick] */
	| { k: "f"; t: number; s: number[][] }
	/** A shot fired, from p with velocity v */
	| { k: "shot"; t: number; by: number; p: number[]; v: number[] }
	/** A rocket launched at a pilot */
	| { k: "rocket"; t: number; by: number }
	/** Shields lost */
	| { k: "hit"; t: number; by: number | null; on: number; damage: number }
	/** A ship destroyed; `by` is null when nobody gets the frag */
	| { k: "kill"; t: number; by: number | null; on: number }
	| { k: "spawn"; t: number; by: number }
	| { k: "powerup"; t: number; by: number; kind: string }
	| { k: "end"; t: number; reason: string };

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
