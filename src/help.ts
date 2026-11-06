import { DIFFICULTIES } from "./difficulty.ts";
import {
	BOOST_GREEN, POWERUPS, RAPID_RED, RAPID_YELLOW, ROCKETS_RED, ROCKETS_WHITE, SHIELDS_BLUE, type PowerupKind,
} from "./entity/powerup.ts";
import { gunshipShape, hunterShape, pirateShape, raiderShape } from "./entity/shapes.ts";
import { ARENA_SIZE, RESPAWN_DELAY } from "./net/protocol.ts";
import { GUNSHIP_COLOR, HUNTER_COLOR, POD_COLOR, POWERUP_COLOR, RAIDER_COLOR, SHIP_COLOR } from "./render/radar-scope.ts";
import { shipIcon } from "./render/ship-icon.ts";
import { DIFFICULTY_FACTOR } from "./scores.ts";

/** Size of the enemy ship drawings (CSS px) */
const SHIP_ICON = 34;

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${body}</svg>`;

/** A small dot in a ship's radar colour, after its name */
const radarDot = (color: string) => `<span class="radar-dot" style="color: ${color}" title="Radar colour">●</span>`;

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
		<div class="items ships">
			${item(shipIcon(pirateShape(), SHIP_ICON), `Pirate ${radarDot(SHIP_COLOR)}`, "tows pods away, fires homing missiles")}
			${item(shipIcon(raiderShape(), SHIP_ICON), `Raider ${radarDot(RAIDER_COLOR)}`, "steals pods like a pirate, but faster; no missiles")}
			${item(shipIcon(hunterShape(), SHIP_ICON), `Hunter ${radarDot(HUNTER_COLOR)}`, "ignores pods, hunts you")}
			${item(shipIcon(gunshipShape(), SHIP_ICON), `Gunship ${radarDot(GUNSHIP_COLOR)}`, "a slow, much tougher hunter")}
		</div>
		<p class="aside">The dot after each name is its colour on the radar; pods are <span style="color: ${POD_COLOR}">blue</span> there, powerups <span style="color: ${POWERUP_COLOR}">grey</span>.</p>

		<h3>Powerups</h3>
		<div class="items two">
			${(Object.keys(ICONS) as PowerupKind[]).map(kind => `${ICONS[kind]}<div>${POWERUPS[kind].label}</div>`).join("")}
		</div>

		<h3>Rockets</h3>
		<p>Keep an enemy near the crosshair until the brackets turn red, then Enter or Space. A rocket hits only its target.</p>

		<h3>Score</h3>
		<p>Enemies destroyed, plus pods and shields left when you win. ×${DIFFICULTY_FACTOR.easy} on ${easy.label}, ×${DIFFICULTY_FACTOR.hard} on ${hard.label}.</p>

		<h3>Your ship</h3>
		<p>Pick a ship and its colours on the title screen, or in a room's lobby. All ships fly the same and are the same size to hit. You fly from the cockpit, so you never see your own: the other pilots do.</p>
		<h3>Deathmatch</h3>
		<p>Online, every pilot for themselves in a ${ARENA_SIZE} m cube with no walls: fly out of one side and you come back in on the other. Destroy a ship for a frag; you fly again ${RESPAWN_DELAY} s after being destroyed. Rockets lock onto other pilots, and can be shot down. The match ends at the frag limit or the time limit, whichever comes first.</p>
	`;
}
