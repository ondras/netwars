/*
 * Bots fight real matches on the real rules, with nothing drawn and as fast as the computer can:
 * `pnpm arena [matches] [aim,flying ...]`, each pair of skills 0..1 being a bot. Example: `pnpm arena 20 0.8,0.2 0.2,0.8`
 * Or they defend the pods together in every co-op level at every difficulty:
 * `pnpm arena coop [runs] [aim,flying | ace | person ...]`. Example: `pnpm arena coop 10 person ace`
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { botTraits, COOP_PILOTS, type BotTraits } from "../src/bot.ts";
import { DIFFICULTIES, type DifficultyLevel } from "../src/difficulty.ts";
import { LEVELS } from "../src/levels.ts";
import { DEFAULT_FRAG_LIMIT, DEFAULT_TIME_LIMIT, type OutcomeMessage, type ServerMessage } from "../src/net/protocol.ts";
import { modelsLoaded, setModelSource } from "../src/nsh.ts";
import { analyze, report, type PilotStats } from "./analyze.ts";
import type { LogEntry, MatchLogs } from "./match-log.ts";
import { Room, type Member } from "./room.ts";

export interface ArenaOptions {
	fragLimit?: number;
	/** Minutes */
	timeLimit?: number;
	/** Gets every line of the recording */
	logs?: MatchLogs;
}

/** Simulated seconds per call into the room: the same small pieces the server runs in */
const SLICE = 0.05;
/** A co-op level that has not ended by then never will (s) */
const LEVEL_TIME_LIMIT = 30 * 60;

/** A room of bots only, the first one hosting; it plays a level when started, and then holds how that ended */
function botRoom(bots: readonly BotTraits[], logs: MatchLogs | null): { room: Room; outcome: () => OutcomeMessage | null } {
	let outcome: OutcomeMessage | null = null;
	const member = (id: number, traits: BotTraits): Member => ({
		id, name: `Bot ${id}`, token: "", look: 0, bot: traits,
		send: (message: ServerMessage) => { if (message.type == "outcome") { outcome = message; } },
	});
	const room = new Room("ARNA", member(1, bots[0]), 0, "normal", logs);
	bots.slice(1).forEach((traits, i) => room.members.push(member(i + 2, traits)));
	return { room, outcome: () => outcome };
}

/** One match. @returns How it ended, with the frags of each bot in the order given */
export function fight(bots: readonly BotTraits[], { fragLimit = 10, timeLimit = 5, logs }: ArenaOptions = {}): { outcome: OutcomeMessage; frags: number[] } {
	const { room, outcome } = botRoom(bots, logs ?? null);
	room.setup(1, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit, timeLimit });
	room.start(1);
	for (let t = 0; !outcome() && t < timeLimit * 60 + 1; t += SLICE) { room.advance(SLICE); }
	const result = outcome();
	if (!result) { throw new Error("The match did not end"); }

	const { standings } = result.match!;
	return { outcome: result, frags: bots.map((_, i) => standings.find(({ id }) => id == i + 1)?.frags ?? 0) };
}

/** One co-op level, the bots defending the pods together. @returns How it ended, and how long that took (s) */
export async function defend(bots: readonly BotTraits[], level: number, difficulty: DifficultyLevel, logs: MatchLogs | null = null): Promise<{ outcome: OutcomeMessage; time: number }> {
	const { room, outcome } = botRoom(bots, logs);
	room.setup(1, { mode: "coop", level, difficulty, fragLimit: DEFAULT_FRAG_LIMIT, timeLimit: DEFAULT_TIME_LIMIT });
	room.start(1);
	await modelsLoaded(); /* pods take their shape, and size, from a model file: without it they could not be grabbed */
	let time = 0;
	for (; !outcome() && time < LEVEL_TIME_LIMIT; time += SLICE) { room.advance(SLICE); }
	const result = outcome();
	if (!result) { throw new Error("The level did not end"); }
	return { outcome: result, time };
}

/** Several matches: frags and wins of each bot, and how they flew over all of them */
export function tournament(bots: readonly BotTraits[], matches: number, options: Omit<ArenaOptions, "logs"> = {}): { frags: number[]; wins: number[]; stats: PilotStats[][] } {
	const frags = bots.map(() => 0);
	const wins = bots.map(() => 0);
	const stats: PilotStats[][] = [];
	for (let i = 0; i < matches; i++) {
		const entries: LogEntry[] = [];
		const result = fight(bots, { ...options, logs: () => ({ write: entry => { entries.push(entry); }, close: () => {} }) });
		result.frags.forEach((count, bot) => { frags[bot] += count; });
		const top = Math.max(...result.frags);
		if (result.frags.filter(count => count == top).length == 1) { wins[result.frags.indexOf(top)]++; }
		stats.push(analyze(entries));
	}
	return { frags, wins, stats };
}

/** Every co-op level at every difficulty, `runs` times each: pods lost on average, levels won, and in how long */
async function coopReport(bots: readonly BotTraits[], runs: number): Promise<string> {
	const difficulties = Object.keys(DIFFICULTIES) as DifficultyLevel[];
	const rows = [["", ...difficulties.map(difficulty => DIFFICULTIES[difficulty].label)]];
	for (const [level, config] of LEVELS.entries()) {
		const cells: string[] = [];
		for (const difficulty of difficulties) {
			let lost = 0;
			let won = 0;
			let time = 0;
			for (let i = 0; i < runs; i++) {
				const result = await defend(bots, level, difficulty);
				lost += result.outcome.podsTotal - result.outcome.podsLeft;
				if (result.outcome.outcome == "won") { won++; }
				time += result.time;
			}
			cells.push(`${(lost / runs).toFixed(1)} of ${config.pods} lost, ${won}/${runs} won, ${(time / runs / 60).toFixed(1)} min`);
		}
		rows.push([`${level + 1}. ${config.name}`, ...cells]);
	}
	const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)));
	return rows.map(row => row.map((cell, column) => cell.padEnd(widths[column])).join("   ")).join("\n");
}

if (import.meta.url == pathToFileURL(process.argv[1] ?? "").href) {
	const coop = process.argv[2] == "coop";
	const [count = "10", ...specs] = process.argv.slice(coop ? 3 : 2);
	const named = (spec: string): spec is keyof typeof COOP_PILOTS => Object.hasOwn(COOP_PILOTS, spec);
	const modelsDir = fileURLToPath(new URL("../public/models", import.meta.url));
	setModelSource(name => readFile(join(modelsDir, `${name}.nsh`), "latin1"));

	const started = performance.now();
	if (coop) {
		const pilots = (specs.length ? specs : ["ace"]);
		const traits = pilots.map(spec => (named(spec) ? COOP_PILOTS[spec] : botTraits(...spec.split(",").map(Number) as [number, number])));
		console.log(`${pilots.length} bot(s): ${pilots.join("; ")}; ${count} runs of each level\n`);
		console.log(await coopReport(traits, Number(count)));
		console.log(`\nin ${((performance.now() - started) / 1000).toFixed(1)} s`);
		process.exit(0);
	}
	const skills = (specs.length ? specs : ["0.5,0.5", "0.5,0.5"]).map(spec => spec.split(",").map(Number));
	const { frags, wins, stats } = tournament(skills.map(([aim, flying]) => botTraits(aim, flying)), Number(count));
	skills.forEach(([aim, flying], i) => console.log(`Bot ${i + 1} (aim ${aim}, flying ${flying}): ${frags[i]} frags, ${wins[i]} wins`));
	console.log(`\nLast match:\n${report(stats.at(-1)!)}`);
	console.log(`\n${count} matches in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
