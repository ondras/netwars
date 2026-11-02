export type EnemyKind = "pirate" | "hunter";

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
		description: "Three pirates at a time, and a hunter now and then.",
		pods: 16,
		enemies: ["pirate", "pirate", "pirate", "hunter", "pirate", "pirate", "pirate", "hunter", "pirate", "pirate"],
		maxEnemies: 3,
		enemyInterval: 10,
		powerups: { interval: 16, max: 2 },
	},
	{
		name: "Crossfire",
		description: "As many hunters as pirates, three at a time: guard the pods with hunters on your tail.",
		pods: 18,
		enemies: ["hunter", "pirate", "pirate", "hunter", "pirate", "hunter", "pirate", "hunter", "pirate", "hunter", "pirate", "hunter"],
		maxEnemies: 3,
		enemyInterval: 9,
		powerups: { interval: 15, max: 3 },
	},
	{
		name: "Siege",
		description: "The longest fight, up to four enemies at a time. Make every rocket count.",
		pods: 20,
		enemies: [
			"pirate", "pirate", "hunter", "pirate", "pirate", "hunter", "pirate", "hunter",
			"pirate", "pirate", "hunter", "pirate", "hunter", "pirate", "hunter", "hunter",
		],
		maxEnemies: 4,
		enemyInterval: 8,
		powerups: { interval: 14, max: 3 },
	},
];

export type Outcome = "won" | "ship-destroyed" | "pods-lost";

/** @returns null while the level goes on */
export function levelOutcome(state: { shipDead: boolean; podsLeft: number; enemiesLeft: number }): Outcome | null {
	if (state.shipDead) { return "ship-destroyed"; }
	if (state.podsLeft == 0) { return "pods-lost"; }
	if (state.enemiesLeft == 0) { return "won"; }
	return null;
}
