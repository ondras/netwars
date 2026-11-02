import { DIFFICULTIES } from "./difficulty.ts";
import { GUNSHIP } from "./entity/gunship.ts";
import { FIRE_RANGE, HUNTER } from "./entity/hunter.ts";
import { MISSILE_RANGE, PIRATE } from "./entity/pirate.ts";
import { RAIDER } from "./entity/raider.ts";
import {
	BOOST_GREEN, EFFECT_TIME, RAPID_RED, RAPID_YELLOW, ROCKET_REFILL, ROCKETS_RED, ROCKETS_WHITE, SHIELD_BONUS, SHIELDS_BLUE,
} from "./entity/powerup.ts";
import { BOOST_FACTOR, RAPID_FIRE_FACTOR, ROCKET, ROCKET_CAPACITY } from "./entity/ship.ts";
import { LOCK_RANGE, LOCK_TIME } from "./lock.ts";
import { GUNSHIP_COLOR, HUNTER_COLOR, POD_COLOR, POWERUP_COLOR, RAIDER_COLOR, SHIP_COLOR } from "./render/radar-scope.ts";
import { DIFFICULTY_FACTOR, ENEMY_POINTS, POD_POINTS, SHIELD_POINTS } from "./scores.ts";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${body}</svg>`;

/** A radar contact */
const dot = (color: string) => svg(`<circle cx="12" cy="12" r="5" fill="${color}"/>`);

/** Flat drawings of the powerup shapes, in their colours */
const ICONS = {
	shields: svg(`<circle cx="12" cy="12" r="7.5" fill="none" stroke="${hex(SHIELDS_BLUE)}" stroke-width="4"/>`),
	rapid: svg(`
		<rect x="10" y="4" width="4" height="16" fill="${hex(RAPID_YELLOW)}"/>
		<rect x="4" y="10" width="16" height="4" fill="${hex(RAPID_YELLOW)}"/>
		<rect x="9" y="1" width="6" height="4" fill="${hex(RAPID_RED)}"/><rect x="9" y="19" width="6" height="4" fill="${hex(RAPID_RED)}"/>
		<rect x="1" y="9" width="4" height="6" fill="${hex(RAPID_RED)}"/><rect x="19" y="9" width="4" height="6" fill="${hex(RAPID_RED)}"/>`),
	boost: svg(`<polygon points="12,2 21,12 15,12 15,22 9,22 9,12 3,12" fill="${hex(BOOST_GREEN)}"/>`),
	rockets: svg(`<rect x="4" y="4" width="16" height="16" fill="${hex(ROCKETS_WHITE)}"/><rect x="3" y="10" width="18" height="4" fill="${hex(ROCKETS_RED)}"/>`),
};

const item = (icon: string, title: string, text: string) => `${icon}<div><b>${title}</b><br>${text}</div>`;
const legend = (icon: string, text: string) => `<span>${icon}${text}</span>`;

/** How to play, with the numbers taken from the game itself (static markup, no user input) */
export function helpMarkup(): string {
	const { easy, hard } = DIFFICULTIES;

	return `
		<h3>Goal</h3>
		<p>Guard the pods. You win when every enemy is destroyed or gone and at least one pod is left.
		You lose when your ship is destroyed or the last pod is gone.</p>

		<h3>Controls</h3>
		<dl>
			<dt>Mouse</dt><dd>Steer: the farther the pointer is from the middle, the faster you turn</dd>
			<dt>Mouse button</dt><dd>Fire the cannon</dd>
			<dt>W / S</dt><dd>Speed up / slow down; below zero you fly backwards</dd>
			<dt>Enter / Space</dt><dd>Launch a rocket at the locked target</dd>
			<dt>Esc</dt><dd>Pause</dd>
		</dl>

		<h3>Radar</h3>
		<p>The grid in the corner covers the area around you, ahead at the top. Stalks show how far above or below a contact is.</p>
		<div class="legend">
			${legend(dot(POD_COLOR), "Pods")}
			${legend(dot(SHIP_COLOR), "Pirates")}
			${legend(dot(RAIDER_COLOR), "Raiders")}
			${legend(dot(HUNTER_COLOR), "Hunters")}
			${legend(dot(GUNSHIP_COLOR), "Gunships")}
			${legend(dot(POWERUP_COLOR), "Powerups")}
		</div>

		<h3>Enemies</h3>
		<div class="items">
			${item(dot(SHIP_COLOR), "Pirate", `Flies to the nearest pod, grabs it with a grapple and tows it away; once it gets far enough, the pod is lost.
				Destroy it and the pod drops where it is. Fires homing missiles at you from within ${MISSILE_RANGE} m:
				a warning sounds, and you can shoot a missile down or out-turn it.`)}
			${item(dot(RAIDER_COLOR), "Raider", `Steals pods like a pirate, but flies at ${RAIDER.speed} m/s (a pirate does ${PIRATE.speed}) and turns quicker.
				It has only ${RAIDER.shields} shields and no missiles, so catch it early.`)}
			${item(dot(HUNTER_COLOR), "Hunter", `Leaves the pods alone and comes after you. Fires when you are ahead of it within ${FIRE_RANGE} m,
				breaks away when it gets close, then turns back for another pass.`)}
			${item(dot(GUNSHIP_COLOR), "Gunship", `A big, heavily shielded hunter: ${GUNSHIP.shields} shields against a hunter's ${HUNTER.shields},
				so it takes ${Math.ceil(GUNSHIP.shields / ROCKET.damage)} rockets. Slow to turn, but its shots hit ${GUNSHIP.damageFactor} times as hard.`)}
		</div>

		<h3>Powerups</h3>
		<p>Fly through a powerup to collect it.</p>
		<div class="items">
			${item(ICONS.shields, "Shields", `Light blue ring: +${SHIELD_BONUS} shields.`)}
			${item(ICONS.rapid, "Rapid fire", `Yellow cross with red tips: the cannon fires ${RAPID_FIRE_FACTOR} times as fast for ${EFFECT_TIME} s.`)}
			${item(ICONS.boost, "Boost", `Green arrow: top speed ×${BOOST_FACTOR} for ${EFFECT_TIME} s.`)}
			${item(ICONS.rockets, "Rockets", `White crate with a red band: +${ROCKET_REFILL} rockets, up to ${ROCKET_CAPACITY}.`)}
		</div>

		<h3>Rockets</h3>
		<p>Every level starts with ${ROCKET_CAPACITY}. Keep an enemy near the crosshair and within ${LOCK_RANGE} m for ${LOCK_TIME} s:
		green brackets close in on it and turn red with LOCKED. A rocket hits only its target,
		so it can take out a pirate without harming the pod it carries.</p>

		<h3>Score</h3>
		<p>When you win: ${POD_POINTS} per pod left and ${SHIELD_POINTS} per shield point left.
		Win or lose, per enemy destroyed: ${ENEMY_POINTS.pirate} for a pirate, ${ENEMY_POINTS.raider} for a raider,
		${ENEMY_POINTS.hunter} for a hunter and ${ENEMY_POINTS.gunship} for a gunship.
		×${DIFFICULTY_FACTOR.easy} on ${easy.label}, ×${DIFFICULTY_FACTOR.hard} on ${hard.label}. Every level keeps its own top ten.</p>
	`;
}
