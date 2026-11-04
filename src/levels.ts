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
 * A level is won when all its enemies are destroyed or gone with at least one pod left,
 * and lost when the player's ship is destroyed or no pods are left.
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

/** "match-over": a deathmatch reached its frag or time limit */
export type Outcome = "won" | "ship-destroyed" | "pods-lost" | "match-over";

/** @returns null while the level goes on */
export function levelOutcome(state: { shipDead: boolean; podsLeft: number; enemiesLeft: number }): Outcome | null {
	if (state.shipDead) { return "ship-destroyed"; }
	if (state.podsLeft == 0) { return "pods-lost"; }
	if (state.enemiesLeft == 0) { return "won"; }
	return null;
}
