export const ENEMY_KINDS = ["pirate", "raider", "hunter", "gunship"] as const;

/** Horizontal half-size of the square pods are scattered in (m) */
export const POD_FIELD = 25;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export interface LevelConfig {
	readonly name: string;
	readonly description: string;
	/** Pods placed at the start */
	readonly pods: number;
	/** Every enemy of the level, in the order they arrive */
	readonly enemies: readonly EnemyKind[];
	/** Most enemies present at once */
	readonly maxEnemies: number;
	/** Time between arrivals, counted while below maxEnemies (s) */
	readonly enemyInterval: number;
	/** null: no powerups */
	readonly powerups: { readonly interval: number; readonly max: number } | null;
}

/**
 * A level is won when all its enemies are destroyed or gone with at least one pod left, and lost when no pods are left.
 * A destroyed ship flies again after a moment (RESPAWN_DELAY).
 */
export const LEVELS: readonly LevelConfig[] = [
	{
		name: "Pirates",
		description: "Pirates come one at a time to steal the pods.",
		pods: 12,
		enemies: ["pirate", "pirate", "pirate", "pirate"],
		maxEnemies: 1,
		enemyInterval: 12,
		powerups: null,
	},
	{
		name: "Raid",
		description: "Two pirates at a time. Fly through powerups to collect them.",
		pods: 16,
		enemies: ["pirate", "pirate", "pirate", "pirate", "pirate", "pirate"],
		maxEnemies: 2,
		enemyInterval: 12,
		powerups: { interval: 20, max: 2 },
	},
	{
		name: "Hunters",
		description: "Hunters ignore the pods and come after you.",
		pods: 16,
		enemies: ["pirate", "hunter", "pirate", "pirate", "hunter", "pirate", "hunter"],
		maxEnemies: 2,
		enemyInterval: 12,
		powerups: { interval: 18, max: 2 },
	},
	{
		name: "Swarm",
		description: "Three at a time: pirates, fast raiders and the odd hunter.",
		pods: 16,
		enemies: ["pirate", "raider", "pirate", "hunter", "raider", "pirate", "raider", "hunter", "pirate", "raider"],
		maxEnemies: 3,
		enemyInterval: 10,
		powerups: { interval: 16, max: 2 },
	},
	{
		name: "Crossfire",
		description: "Hunters and heavy gunships on your tail while pirates and raiders go for the pods, three at a time.",
		pods: 18,
		enemies: ["hunter", "pirate", "raider", "hunter", "pirate", "gunship", "raider", "hunter", "pirate", "hunter", "raider", "gunship"],
		maxEnemies: 3,
		enemyInterval: 9,
		powerups: { interval: 15, max: 3 },
	},
	{
		name: "Siege",
		description: "The longest fight, up to four enemies at a time. Make every rocket count.",
		pods: 20,
		enemies: [
			"pirate", "raider", "hunter", "pirate", "gunship", "raider", "pirate", "hunter",
			"raider", "pirate", "gunship", "hunter", "raider", "pirate", "hunter", "gunship",
		],
		maxEnemies: 4,
		enemyInterval: 8,
		powerups: { interval: 14, max: 3 },
	},
];

/** How a level's enemies come: all of them in order, at most `max` at once, one every `interval` seconds while fewer are about */
export interface EnemyWaves {
	readonly enemies: readonly EnemyKind[];
	readonly max: number;
	readonly interval: number;
}

const isThief = (kind: EnemyKind) => kind == "pirate" || kind == "raider";

/**
 * More pilots, more enemies: how many for 1, 2, 3 and 4 pilots, as a multiple of what the level says.
 * Each pilot gets as many of the enemies that come after pilots; fewer more thieves are enough, a team guarding the same pods.
 * Tuned on 2026-11-08 on normal with bots reacting like the user (COOP_PILOTS.person): a team loses about as many pods as one alone,
 * about one a level, and in the last two levels each of them is destroyed at least once.
 */
export const PILOT_PRESSURE = { thieves: [1, 1.6, 2.1, 2.4], fighters: [1, 2, 3, 4] };

export function pilotPressure(pilots: number, kind: keyof typeof PILOT_PRESSURE): number {
	const table = PILOT_PRESSURE[kind];
	return table[Math.max(1, Math.min(table.length, pilots)) - 1];
}

/**
 * A level's enemies for some number of pilots and some share of pod thieves (Difficulty.thieves).
 * More pilots get more of every kind (pilotPressure), and the thieves are then that many times as many. The other enemies keep
 * their places in the order, the level's own being gone through again from the start for more, and so do thieves.
 * With more enemies they come sooner and more at once, so that the level lasts about as long.
 */
export function enemyWaves(config: LevelConfig, pilots: number, thieves: number): EnemyWaves {
	const all = Math.max(1, Math.round(config.enemies.length * pilotPressure(pilots, "fighters")));
	const scaled = Array.from({ length: all }, (_, i) => config.enemies[i % config.enemies.length]);
	const fighters = scaled.filter(kind => !isThief(kind));
	const stolen = scaled.filter(isThief);
	const ownThieves = config.enemies.filter(isThief).length;
	const thiefCount = (ownThieves ? Math.max(1, Math.round(ownThieves * pilotPressure(pilots, "thieves") * thieves)) : 0);
	const count = fighters.length + thiefCount;

	/* each fighter as far through the order as it was; thieves in between */
	const fighterAt = scaled.flatMap((kind, i) => (isThief(kind) ? [] : [i / scaled.length]));
	const enemies: EnemyKind[] = [];
	let fighter = 0;
	let thief = 0;
	for (let i = 0; i < count; i++) {
		const fighterNext = fighter < fighters.length && (fighterAt[fighter] <= i / count || thief >= thiefCount);
		enemies.push(fighterNext ? fighters[fighter++] : stolen[thief++ % stolen.length]);
	}

	const more = count / config.enemies.length;
	return { enemies, max: Math.max(1, Math.round(config.maxEnemies * more)), interval: config.enemyInterval / more };
}

/** "match-over": a deathmatch reached its frag or time limit */
export type Outcome = "won" | "pods-lost" | "match-over";

/** @returns null while the level goes on */
export function levelOutcome(state: { podsLeft: number; enemiesLeft: number }): Outcome | null {
	if (state.podsLeft == 0) { return "pods-lost"; }
	if (state.enemiesLeft == 0) { return "won"; }
	return null;
}
