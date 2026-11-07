/*
 * Bots fight real matches on the real rules, with nothing drawn and as fast as the computer can:
 * `pnpm arena [matches] [aim,flying ...]`, each pair of skills 0..1 being a bot. Example: `pnpm arena 20 0.8,0.2 0.2,0.8`
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { botTraits, type BotTraits } from "../src/bot.ts";
import type { OutcomeMessage, ServerMessage } from "../src/net/protocol.ts";
import { setModelSource } from "../src/nsh.ts";
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

/** One match. @returns How it ended, with the frags of each bot in the order given */
export function fight(bots: readonly BotTraits[], { fragLimit = 10, timeLimit = 5, logs }: ArenaOptions = {}): { outcome: OutcomeMessage; frags: number[] } {
	let outcome: OutcomeMessage | null = null;
	const member = (id: number, traits: BotTraits): Member => ({
		id, name: `Bot ${id}`, token: "", look: 0, bot: traits,
		send: (message: ServerMessage) => { if (message.type == "outcome") { outcome = message; } },
	});

	const room = new Room("ARNA", member(1, bots[0]), 0, "normal", logs ?? null);
	room.setup(1, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit, timeLimit });
	bots.slice(1).forEach((traits, i) => room.members.push(member(i + 2, traits)));
	room.start(1);
	for (let t = 0; !outcome && t < timeLimit * 60 + 1; t += SLICE) { room.advance(SLICE); }
	if (!outcome) { throw new Error("The match did not end"); }

	const { standings } = (outcome as OutcomeMessage).match!;
	return { outcome, frags: bots.map((_, i) => standings.find(({ id }) => id == i + 1)?.frags ?? 0) };
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

if (import.meta.url == pathToFileURL(process.argv[1] ?? "").href) {
	const [count = "10", ...specs] = process.argv.slice(2);
	const skills = (specs.length ? specs : ["0.5,0.5", "0.5,0.5"]).map(spec => spec.split(",").map(Number));
	const modelsDir = fileURLToPath(new URL("../public/models", import.meta.url));
	setModelSource(name => readFile(join(modelsDir, `${name}.nsh`), "latin1"));

	const started = performance.now();
	const { frags, wins, stats } = tournament(skills.map(([aim, flying]) => botTraits(aim, flying)), Number(count));
	skills.forEach(([aim, flying], i) => console.log(`Bot ${i + 1} (aim ${aim}, flying ${flying}): ${frags[i]} frags, ${wins[i]} wins`));
	console.log(`\nLast match:\n${report(stats.at(-1)!)}`);
	console.log(`\n${count} matches in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
