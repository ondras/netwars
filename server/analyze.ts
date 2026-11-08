/*
 * What a recording says about how each pilot flies and shoots: `pnpm analyze recordings/<file>.jsonl`.
 * People and bots are measured the same way, so that their numbers can be set side by side.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { quat, vec3 } from "gl-matrix";
import { nearestCopy } from "../src/world.ts";
import type { LogEntry } from "./match-log.ts";

/** Top speed without a boost (m/s) */
const TOP_SPEED = 15;
/** A target this far off the nose, and this close, counts as being in the sights (rad, m) */
const SIGHTS_CONE = 10 * Math.PI / 180;
const SIGHTS_RANGE = 150;
/** Within this another ship counts as close, beyond this as far; closer than FIGHT_RANGE a fight is on (m) */
const CLOSE_RANGE = 40;
const MIDDLE_RANGE = 80;
const FAR_RANGE = 150;
const FIGHT_RANGE = 100;
/** Far off, a nose this close to a ship is heading for it (rad) */
const HEADING_CONE = 30 * Math.PI / 180;
/** Shots further apart than this are separate bursts (s) */
const BURST_GAP = 0.35;
/** A hit that takes this much is the plain gun's; more is a rocket or a power shot */
const GUN_DAMAGE = 25;
/** The gun's shots leave this fast (m/s) */
const GUN_SPEED = 120;
/** Frames kept, to look back at when a shot that hit was fired: longer than a shot lives */
const RECENT_FRAMES = 60;
/** The gun's shots last this long (s) */
const SHOT_LIFE = 1.5;

export interface PilotStats {
	id: number;
	name: string;
	bot: boolean;
	/** Time spent flying (s) */
	flying: number;
	frags: number;
	deaths: number;
	shots: number;
	shotsPerMinute: number;
	/** Hits per shot */
	hitRate: number;
	/** The plain gun's hits per shot, within CLOSE_RANGE and from there to MIDDLE_RANGE: where fights are won */
	hitRateClose: number;
	hitRateMiddle: number;
	/** Shots fired from beyond MIDDLE_RANGE, as a share of all */
	longShots: number;
	/** Distance to the nearest other ship when firing (m), median */
	rangeAtFire: number;
	/** How far shots would pass from the nearest ship, if it flew straight on (m), median */
	missBy: number;
	/** Distance to the nearest other ship (m), median */
	rangeToNearest: number;
	/** Share of the time with another ship in the sights */
	inSights: number;
	/** Share of the time with another ship close, or none but far */
	timeClose: number;
	timeFar: number;
	/** With no ship but far off: share of that time heading for the nearest */
	headingFor: number;
	/** Spells with a ship within FIGHT_RANGE, per minute, and how long they last (s), median */
	fightsPerMinute: number;
	fightLength: number;
	/** Shots per burst, median */
	burstLength: number;
	rockets: number;
	powerups: number;
	/** Speed (m/s), median */
	speed: number;
	/** Share of the time near top speed, and in reverse */
	nearTop: number;
	reversing: number;
	/** Changes of the speed asked for, per minute */
	throttleChanges: number;
	/** How far the stick is off centre, on the larger axis, median */
	stick: number;
	/** Share of the time the stick is moving */
	stickMoving: number;
	/** How fast the stick moves (full deflections per second), median and 90th percentile */
	stickSpeed: number;
	stickSpeedHigh: number;
}

const quantile = (values: number[], q: number) => {
	if (!values.length) { return 0; }
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const median = (values: number[]) => quantile(values, 0.5);

type Row = number[];
const positionOf = (row: Row) => vec3.fromValues(row[1], row[2], row[3]);
function velocityOf(row: Row): vec3 {
	const q = quat.fromValues(row[4], row[5], row[6], row[7]);
	return vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -row[9]), q);
}

export function analyze(entries: readonly LogEntry[]): PilotStats[] {
	const start = entries.find((entry): entry is Extract<LogEntry, { k: "start" }> => entry.k == "start");
	if (!start) { throw new Error("Not a recording: it has no start line"); }
	const copyOf = (point: vec3, around: vec3) => (start.size === null ? point : nearestCopy(point, around, start.size));

	const samples = new Map(start.pilots.map(({ id }) => [id, {
		flying: 0, frags: 0, deaths: 0, shots: 0, hits: 0, throttle: 0,
		rangeAtFire: [] as number[], missBy: [] as number[], ranges: [] as number[], speeds: [] as number[], sticks: [] as number[], stickSpeeds: [] as number[],
		sights: 0, nearTop: 0, reversing: 0, frames: 0,
		close: 0, far: 0, heading: 0, fight: 0, fights: [] as number[], moving: 0, stickFrames: 0,
		lastShot: -Infinity, burst: 0, bursts: [] as number[], rockets: 0, powerups: 0,
		shotsClose: 0, shotsMiddle: 0, shotsLong: 0, gunHitsClose: 0, gunHitsMiddle: 0,
	}]));

	let last: Extract<LogEntry, { k: "f" }> | null = null;
	const recent: Array<Extract<LogEntry, { k: "f" }>> = [];
	const nearestTo = (id: number, around: vec3, frame: Extract<LogEntry, { k: "f" }>) => {
		let best: { row: Row; at: vec3; distance: number } | null = null;
		for (const row of frame.s) {
			if (row[0] == id) { continue; }
			const at = copyOf(positionOf(row), around);
			const distance = vec3.distance(at, around);
			if (!best || distance < best.distance) { best = { row, at, distance }; }
		}
		return best;
	};

	for (const entry of entries) {
		switch (entry.k) {
			case "f":
				for (const row of entry.s) {
					const pilot = samples.get(row[0]);
					if (!pilot) { continue; }
					pilot.frames++;
					const previous = last?.s.find(other => other[0] == row[0]);
					const dt = (last && previous ? entry.t - last.t : 0);
					pilot.flying += dt;
					const position = positionOf(row);
					const nearest = nearestTo(row[0], position, entry);
					if (nearest) {
						pilot.ranges.push(nearest.distance);
						const toward = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), nearest.at, position));
						const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), quat.fromValues(row[4], row[5], row[6], row[7]));
						const off = Math.acos(Math.max(-1, Math.min(1, vec3.dot(toward, nose))));
						if (nearest.distance <= SIGHTS_RANGE && off <= SIGHTS_CONE) { pilot.sights++; }
						if (nearest.distance < CLOSE_RANGE) { pilot.close++; }
						if (nearest.distance >= FAR_RANGE) {
							pilot.far++;
							if (off <= HEADING_CONE) { pilot.heading++; }
						}
						if (nearest.distance < FIGHT_RANGE) {
							pilot.fight += dt;
						} else if (pilot.fight) {
							pilot.fights.push(pilot.fight);
							pilot.fight = 0;
						}
					}
					pilot.speeds.push(Math.abs(row[9]));
					if (Math.abs(row[9]) >= 0.9 * TOP_SPEED) { pilot.nearTop++; }
					if (row[9] < -0.5) { pilot.reversing++; }
					pilot.sticks.push(Math.max(Math.abs(row[11]), Math.abs(row[12])));
					if (previous && dt > 0) {
						const stickSpeed = Math.max(Math.abs(row[11] - previous[11]), Math.abs(row[12] - previous[12])) / dt;
						pilot.stickSpeeds.push(stickSpeed);
						pilot.stickFrames++;
						if (stickSpeed > 0) { pilot.moving++; }
						if (row[10] != previous[10]) { pilot.throttle++; }
					}
				}
				last = entry;
				recent.push(entry);
				if (recent.length > RECENT_FRAMES) { recent.shift(); }
			break;

			case "shot": {
				const pilot = samples.get(entry.by);
				if (!pilot) { break; }
				pilot.shots++;
				if (entry.t - pilot.lastShot > BURST_GAP && pilot.burst) {
					pilot.bursts.push(pilot.burst);
					pilot.burst = 0;
				}
				pilot.burst++;
				pilot.lastShot = entry.t;
				if (!last) { break; }
				const from = vec3.fromValues(entry.p[0], entry.p[1], entry.p[2]);
				const nearest = nearestTo(entry.by, from, last);
				if (!nearest) { break; }
				pilot.rangeAtFire.push(nearest.distance);
				if (nearest.distance < CLOSE_RANGE) {
					pilot.shotsClose++;
				} else if (nearest.distance < MIDDLE_RANGE) {
					pilot.shotsMiddle++;
				} else {
					pilot.shotsLong++;
				}
				/* closest approach of the shot to the target, going straight on */
				const away = vec3.subtract(vec3.create(), nearest.at, from);
				const closing = vec3.subtract(vec3.create(), vec3.fromValues(entry.v[0], entry.v[1], entry.v[2]), velocityOf(nearest.row));
				const t = Math.max(0, Math.min(SHOT_LIFE, vec3.dot(away, closing) / vec3.squaredLength(closing)));
				pilot.missBy.push(vec3.distance(away, vec3.scale(vec3.create(), closing, t)));
			} break;

			case "hit": {
				if (entry.by === null) { break; }
				const pilot = samples.get(entry.by);
				if (!pilot) { break; }
				pilot.hits++;
				/* filed by the distance its shot was fired from, like the shots: about when that was, by the gun's speed */
				const now = (last ? nearestTo(entry.by, positionOf(last.s.find(other => other[0] == entry.by) ?? last.s[0]), last) : null);
				const firedAt = entry.t - (now ? now.distance / GUN_SPEED : 0);
				const fired = (now ? [...recent].reverse().find(frame => frame.t <= firedAt) ?? recent[0] : null);
				const row = fired?.s.find(other => other[0] == entry.by);
				const nearest = (row && fired ? nearestTo(entry.by, positionOf(row), fired) : null);
				if (entry.damage == GUN_DAMAGE && nearest) {
					if (nearest.distance < CLOSE_RANGE) {
						pilot.gunHitsClose++;
					} else if (nearest.distance < MIDDLE_RANGE) {
						pilot.gunHitsMiddle++;
					}
				}
			} break;

			case "rocket": { const pilot = samples.get(entry.by); if (pilot) { pilot.rockets++; } } break;
			case "powerup": { const pilot = samples.get(entry.by); if (pilot) { pilot.powerups++; } } break;

			case "kill":
				if (entry.by !== null) { const pilot = samples.get(entry.by); if (pilot) { pilot.frags++; } }
				{ const pilot = samples.get(entry.on); if (pilot) { pilot.deaths++; } }
			break;
		}
	}

	return start.pilots.map(({ id, name, bot }) => {
		const pilot = samples.get(id)!;
		const minutes = pilot.flying / 60;
		const share = (count: number) => (pilot.frames ? count / pilot.frames : 0);
		const fights = (pilot.fight ? [...pilot.fights, pilot.fight] : pilot.fights);
		const bursts = (pilot.burst ? [...pilot.bursts, pilot.burst] : pilot.bursts);
		return {
			id, name, bot,
			flying: pilot.flying,
			frags: pilot.frags,
			deaths: pilot.deaths,
			shots: pilot.shots,
			shotsPerMinute: (minutes ? pilot.shots / minutes : 0),
			hitRate: (pilot.shots ? pilot.hits / pilot.shots : 0),
			hitRateClose: (pilot.shotsClose ? pilot.gunHitsClose / pilot.shotsClose : 0),
			hitRateMiddle: (pilot.shotsMiddle ? pilot.gunHitsMiddle / pilot.shotsMiddle : 0),
			longShots: (pilot.shots ? pilot.shotsLong / pilot.shots : 0),
			rangeAtFire: median(pilot.rangeAtFire),
			missBy: median(pilot.missBy),
			rangeToNearest: median(pilot.ranges),
			inSights: share(pilot.sights),
			timeClose: share(pilot.close),
			timeFar: share(pilot.far),
			headingFor: (pilot.far ? pilot.heading / pilot.far : 0),
			fightsPerMinute: (minutes ? fights.length / minutes : 0),
			fightLength: median(fights),
			burstLength: median(bursts),
			rockets: pilot.rockets,
			powerups: pilot.powerups,
			speed: median(pilot.speeds),
			nearTop: share(pilot.nearTop),
			reversing: share(pilot.reversing),
			throttleChanges: (minutes ? pilot.throttle / minutes : 0),
			stick: median(pilot.sticks),
			stickMoving: (pilot.stickFrames ? pilot.moving / pilot.stickFrames : 0),
			stickSpeed: median(pilot.stickSpeeds),
			stickSpeedHigh: quantile(pilot.stickSpeeds, 0.9),
		};
	});
}

const percent = (value: number) => `${(100 * value).toFixed(0)} %`;
const ROWS: ReadonlyArray<readonly [string, (stats: PilotStats) => string]> = [
	["time flying", s => `${s.flying.toFixed(0)} s`],
	["frags / deaths", s => `${s.frags} / ${s.deaths}`],
	["shots per minute", s => s.shotsPerMinute.toFixed(0)],
	["hit rate", s => percent(s.hitRate)],
	["  gun, under 40 m", s => percent(s.hitRateClose)],
	["  gun, 40-80 m", s => percent(s.hitRateMiddle)],
	["shots from beyond 80 m", s => percent(s.longShots)],
	["burst length", s => `${s.burstLength} shots`],
	["rockets", s => String(s.rockets)],
	["powerups", s => String(s.powerups)],
	["range when firing", s => `${s.rangeAtFire.toFixed(0)} m`],
	["shots miss by", s => `${s.missBy.toFixed(1)} m`],
	["range to nearest", s => `${s.rangeToNearest.toFixed(0)} m`],
	["target in sights", s => percent(s.inSights)],
	["time under 40 m", s => percent(s.timeClose)],
	["time beyond 150 m", s => percent(s.timeFar)],
	["  heading for them then", s => percent(s.headingFor)],
	["fights per minute", s => s.fightsPerMinute.toFixed(1)],
	["fight length", s => `${s.fightLength.toFixed(1)} s`],
	["speed", s => `${s.speed.toFixed(1)} m/s`],
	["near top speed", s => percent(s.nearTop)],
	["in reverse", s => percent(s.reversing)],
	["throttle changes / min", s => s.throttleChanges.toFixed(0)],
	["stick off centre", s => s.stick.toFixed(2)],
	["stick moving", s => percent(s.stickMoving)],
	["stick speed, median", s => `${s.stickSpeed.toFixed(2)} /s`],
	["stick speed, fast (90 %)", s => `${s.stickSpeedHigh.toFixed(2)} /s`],
];

/** A table with a column per pilot */
export function report(stats: readonly PilotStats[]): string {
	const header = ["", ...stats.map(s => `${s.name}${s.bot ? " (bot)" : ""}`)];
	const table = [header, ...ROWS.map(([label, value]) => [label, ...stats.map(value)])];
	const widths = header.map((_, i) => Math.max(...table.map(row => row[i].length)));
	return table.map(row => row.map((cell, i) => (i ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join("  ")).join("\n");
}

export const readRecording = (path: string): LogEntry[] =>
	readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as LogEntry);

if (import.meta.url == pathToFileURL(process.argv[1] ?? "").href) {
	const paths = process.argv.slice(2);
	if (!paths.length) {
		console.error("Usage: pnpm analyze <recording.jsonl> ...");
		process.exit(1);
	}
	for (const path of paths) {
		console.log(`${path}\n${report(analyze(readRecording(path)))}\n`);
	}
}
