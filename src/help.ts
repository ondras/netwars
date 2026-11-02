import { DIFFICULTIES } from "./difficulty.ts";
import {
	BOOST_GREEN, POWERUPS, RAPID_RED, RAPID_YELLOW, ROCKETS_RED, ROCKETS_WHITE, SHIELDS_BLUE, type PowerupKind,
} from "./entity/powerup.ts";
import { GUNSHIP_COLOR, HUNTER_COLOR, POD_COLOR, POWERUP_COLOR, RAIDER_COLOR, SHIP_COLOR } from "./render/radar-scope.ts";
import { DIFFICULTY_FACTOR } from "./scores.ts";

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${body}</svg>`;

/** A radar contact */
const dot = (color: string) => svg(`<circle cx="12" cy="12" r="5" fill="${color}"/>`);

/** Flat drawings of the powerup shapes, in their colours */
const ICONS: Record<PowerupKind, string> = {
	shields: svg(`<circle cx="12" cy="12" r="7.5" fill="none" stroke="${hex(SHIELDS_BLUE)}" stroke-width="4"/>`),
	rapid: svg(`
		<rect x="10" y="4" width="4" height="16" fill="${hex(RAPID_YELLOW)}"/>
		<rect x="4" y="10" width="16" height="4" fill="${hex(RAPID_YELLOW)}"/>
		<rect x="9" y="1" width="6" height="4" fill="${hex(RAPID_RED)}"/><rect x="9" y="19" width="6" height="4" fill="${hex(RAPID_RED)}"/>
		<rect x="1" y="9" width="4" height="6" fill="${hex(RAPID_RED)}"/><rect x="19" y="9" width="4" height="6" fill="${hex(RAPID_RED)}"/>`),
	boost: svg(`<polygon points="12,2 21,12 15,12 15,22 9,22 9,12 3,12" fill="${hex(BOOST_GREEN)}"/>`),
	rockets: svg(`<rect x="4" y="4" width="16" height="16" fill="${hex(ROCKETS_WHITE)}"/><rect x="3" y="10" width="18" height="4" fill="${hex(ROCKETS_RED)}"/>`),
};

/** Icon, name, then a few words on one line */
const item = (icon: string, title: string, text: string) => `${icon}<div><b>${title}</b> – ${text}</div>`;

/** How to play, short; numbers come from the game itself (static markup, no user input) */
export function helpMarkup(): string {
	const { easy, hard } = DIFFICULTIES;

	return `
		<p>Guard the pods. Win when no enemies are left and you still have a pod; lose your ship or every pod and it's over.</p>

		<h3>Controls</h3>
		<dl>
			<dt>Mouse</dt><dd>steer</dd>
			<dt>Mouse button</dt><dd>fire</dd>
			<dt>W / S</dt><dd>faster / slower, below zero is reverse</dd>
			<dt>Enter / Space</dt><dd>rocket, once locked on</dd>
			<dt>Esc</dt><dd>pause</dd>
		</dl>

		<h3>Enemies</h3>
		<div class="items">
			${item(dot(SHIP_COLOR), "Pirate", "tows pods away, fires homing missiles")}
			${item(dot(RAIDER_COLOR), "Raider", "steals pods like a pirate, but faster; no missiles")}
			${item(dot(HUNTER_COLOR), "Hunter", "ignores pods, hunts you")}
			${item(dot(GUNSHIP_COLOR), "Gunship", "a slow, much tougher hunter")}
		</div>
		<p class="aside">The dots are their radar colours; pods are <span style="color: ${POD_COLOR}">blue</span> there, powerups <span style="color: ${POWERUP_COLOR}">grey</span>.</p>

		<h3>Powerups</h3>
		<div class="items two">
			${(Object.keys(ICONS) as PowerupKind[]).map(kind => `${ICONS[kind]}<div>${POWERUPS[kind].label}</div>`).join("")}
		</div>

		<h3>Rockets</h3>
		<p>Keep an enemy near the crosshair until the brackets turn red, then Enter or Space. A rocket hits only its target.</p>

		<h3>Score</h3>
		<p>Enemies destroyed, plus pods and shields left when you win. ×${DIFFICULTY_FACTOR.easy} on ${easy.label}, ×${DIFFICULTY_FACTOR.hard} on ${hard.label}.</p>
	`;
}
