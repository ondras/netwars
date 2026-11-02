import { beforeAll, describe, expect, it } from "vitest";
import { explode } from "./entity/debris.ts";
import { Pirate } from "./entity/pirate.ts";
import { Ship } from "./entity/ship.ts";
import { EnemySpawner } from "./entity/spawner.ts";
import { Loop } from "./loop.ts";
import { BOARD_SIZE, Leaderboard, NAME_LENGTH, score, type KeyValueStore } from "./scores.ts";
import { stubModels } from "./testing.ts";

beforeAll(stubModels);

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getItem: key => data[key] ?? null,
		setItem: (key, value) => { data[key] = value; },
	};
}

const none = { pirate: 0, hunter: 0 };

describe("score", () => {
	it("adds pods saved, enemies destroyed and shields left", () => {
		const { lines, total } = score({ won: true, podsLeft: 10, destroyed: { pirate: 4, hunter: 1 }, shields: 80, difficulty: "normal" });
		expect(lines.map(line => line.label)).toEqual(["10 pods saved", "4 pirates destroyed", "1 hunter destroyed", "80 shields left"]);
		expect(total).toBe(1000 + 200 + 100 + 160);
	});

	it("counts only destroyed enemies when the level is lost", () => {
		expect(score({ won: false, podsLeft: 5, destroyed: { pirate: 2, hunter: 0 }, shields: 0, difficulty: "normal" }).total).toBe(100);
		expect(score({ won: false, podsLeft: 0, destroyed: none, shields: 30, difficulty: "normal" })).toEqual({ lines: [], total: 0 });
	});

	it("scales with the difficulty, showing the difference as a line", () => {
		const run = { won: true, podsLeft: 3, destroyed: none, shields: 0 };
		expect(score({ ...run, difficulty: "easy" }).total).toBe(150);
		const hard = score({ ...run, difficulty: "hard" });
		expect(hard.total).toBe(450);
		expect(hard.lines.at(-1)).toEqual({ label: "Hard ×1.5", points: 150 });
	});
});

describe("Leaderboard", () => {
	it(`keeps the best ${BOARD_SIZE} per level, highest first, earlier first on ties`, () => {
		const board = new Leaderboard(memoryStore());
		const first = board.add("Raid", 500, "normal")!;
		const tie = board.add("Raid", 500, "hard")!;
		board.add("Raid", 900, "normal");
		expect(board.entries("Raid").map(entry => entry.id).slice(1)).toEqual([first.id, tie.id]);

		for (let i = 0; i < BOARD_SIZE; i++) { board.add("Raid", 1000 + i, "easy"); }
		expect(board.entries("Raid")).toHaveLength(BOARD_SIZE);
		expect(board.entries("Raid")[0].score).toBe(1000 + BOARD_SIZE - 1);
		expect(board.rankOf("Raid", 999)).toBeNull();
		expect(board.add("Raid", 999, "normal")).toBeNull();
		expect(board.entries("Pirates")).toEqual([]);
	});

	it("does not list a score of 0", () => {
		const board = new Leaderboard(memoryStore());
		expect(board.add("Pirates", 0, "normal")).toBeNull();
		expect(board.entries("Pirates")).toEqual([]);
	});

	it("remembers scores and the last name across visits", () => {
		const store = memoryStore();
		const visit = new Leaderboard(store);
		const entry = visit.add("Pirates", 300, "hard")!;
		expect(entry.name).toBe("Pilot");
		visit.rename("Pirates", entry.id, "  Ace  ");

		const next = new Leaderboard(store);
		expect(next.lastName).toBe("Ace");
		expect(next.entries("Pirates")).toMatchObject([{ name: "Ace", score: 300, difficulty: "hard" }]);
		expect(next.add("Pirates", 200, "normal")!.name).toBe("Ace");
	});

	it("shortens long names and falls back to a default for empty ones", () => {
		const board = new Leaderboard(memoryStore());
		const entry = board.add("Pirates", 100, "normal")!;
		board.rename("Pirates", entry.id, "x".repeat(40));
		expect(entry.name).toHaveLength(NAME_LENGTH);
		board.rename("Pirates", entry.id, "   ");
		expect(entry.name).toBe("Pilot");
	});

	it("ignores damaged storage, and works without any", () => {
		const damaged = new Leaderboard(memoryStore({ "netwars.scores": "{ not json", "netwars.name": "" }));
		expect(damaged.entries("Pirates")).toEqual([]);

		const odd = new Leaderboard(memoryStore({ "netwars.scores": JSON.stringify({ Pirates: [{ id: "a", name: "B", score: "lots", difficulty: "normal", date: "" }, 7] }) }));
		expect(odd.entries("Pirates")).toEqual([]);

		const none = new Leaderboard(null);
		expect(none.add("Pirates", 100, "normal")).not.toBeNull();
		expect(none.entries("Pirates")).toHaveLength(1);
	});
});

describe("EnemySpawner.destroyed", () => {
	it("counts enemies shot down, not pirates that got away", () => {
		const loop = new Loop();
		const player = new Ship();
		player.position[2] = 10000;
		const spawner = new EnemySpawner(player, ["pirate", "pirate", "hunter"], { max: 3, firstDelay: 0, interval: 0 });
		loop.scene.push(spawner);
		for (let i = 0; i < 5; i++) { loop.update(0.015); }

		const [shot, away] = loop.scene.filter(entity => entity instanceof Pirate);
		explode(shot, loop);
		away.escaped = true;
		away.dead = true;

		expect(spawner.destroyed).toEqual({ pirate: 1, hunter: 0 });
	});
});
