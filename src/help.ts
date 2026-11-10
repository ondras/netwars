import { DIFFICULTIES } from "./difficulty.ts";
import {
	BOOST_GREEN, POWER_RED, POWER_YELLOW, POWERUPS, ROCKETS_RED, ROCKETS_WHITE, SHIELDS_BLUE, type PowerupKind,
} from "./entity/powerup.ts";
import { gunshipShape, hunterShape, pirateShape, raiderShape } from "./entity/shapes.ts";
import { arenaSizeFor, RESPAWN_DELAY } from "./net/protocol.ts";
import { RADAR_REACH, SIGHT_REACH } from "./senses.ts";
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
	power: svg(`
		<rect x="10" y="4" width="4" height="16" fill="${hex(POWER_YELLOW)}"/>
		<rect x="4" y="10" width="16" height="4" fill="${hex(POWER_YELLOW)}"/>
		<rect x="9" y="1" width="6" height="4" fill="${hex(POWER_RED)}"/><rect x="9" y="19" width="6" height="4" fill="${hex(POWER_RED)}"/>
		<rect x="1" y="9" width="4" height="6" fill="${hex(POWER_RED)}"/><rect x="19" y="9" width="4" height="6" fill="${hex(POWER_RED)}"/>`),
	boost: svg(`<polygon points="12,2 21,12 15,12 15,22 9,22 9,12 3,12" fill="${hex(BOOST_GREEN)}"/>`),
	rockets: svg(`<rect x="4" y="4" width="16" height="16" fill="${hex(ROCKETS_WHITE)}"/><rect x="3" y="10" width="18" height="4" fill="${hex(ROCKETS_RED)}"/>`),
};

/** Icon, name, then a few words on one line */
const item = (icon: string, title: string, text: string) => `${icon}<div><b>${title}</b> – ${text}</div>`;

/** How to play, short; numbers come from the game itself (static markup, no user input) */
export function helpMarkup(): string {
	const { easy, hard } = DIFFICULTIES;

	return `
		<p>Guard the pods. Win when no enemies are left and you still have a pod; lose every pod and it's over. A destroyed ship flies again ${RESPAWN_DELAY} s later, near the pods.</p>

		<h3>Controls</h3>
		<dl>
			<dt>Mouse</dt><dd>steer</dd>
			<dt>Mouse button</dt><dd>fire</dd>
			<dt>W / S</dt><dd>faster / slower, below zero is reverse</dd>
			<dt>Enter / Space</dt><dd>rocket, once locked on</dd>
			<dt>Esc</dt><dd>pause</dd>
			<dt>N</dt><dd>online: names over the other pilots, on or off</dd>
		</dl>

		<h3>Enemies</h3>
		<div class="items ships">
			${item(shipIcon(pirateShape(), SHIP_ICON), `Pirate ${radarDot(SHIP_COLOR)}`, "tows pods away, fires homing missiles")}
			${item(shipIcon(raiderShape(), SHIP_ICON), `Raider ${radarDot(RAIDER_COLOR)}`, "steals pods like a pirate, but faster; no missiles")}
			${item(shipIcon(hunterShape(), SHIP_ICON), `Hunter ${radarDot(HUNTER_COLOR)}`, "ignores pods, hunts you")}
			${item(shipIcon(gunshipShape(), SHIP_ICON), `Gunship ${radarDot(GUNSHIP_COLOR)}`, "a slow, much tougher hunter")}
		</div>
		<p class="aside">The dot after each name is its colour on the radar; pods are <span style="color: ${POD_COLOR}">blue</span> there, powerups <span style="color: ${POWERUP_COLOR}">grey</span>, with their letter, given below, beside the dot. A hollow dot is beyond the radar's range; dots stand above or hang below the grid as they are above or below you.</p>

		<h3>Powerups</h3>
		<p>Fly through one to collect it; a shot destroys it.</p>
		<div class="items">
			${(Object.keys(ICONS) as PowerupKind[]).map(kind => item(ICONS[kind], `${POWERUPS[kind].label} (${POWERUPS[kind].letter})`, POWERUPS[kind].effect)).join("")}
		</div>

		<h3>Rockets</h3>
		<p>Keep an enemy near the crosshair until the brackets turn red, then Enter or Space. A rocket hits only its target.</p>

		<h3>Score</h3>
		<p>Enemies destroyed, plus pods and shields left when you win. ×${DIFFICULTY_FACTOR.easy} on ${easy.label}, ×${DIFFICULTY_FACTOR.hard} on ${hard.label}.</p>

		<h3>Your ship</h3>
		<p>Pick a ship and its colours in a room's lobby. All ships fly the same and are the same size to hit. You fly from the cockpit, so you never see your own: the other pilots do.</p>
		<h3>Deathmatch</h3>
		<p>Online, every pilot for themselves in a cube with no walls, ${arenaSizeFor(2)} m across for two pilots, ${arenaSizeFor(3)} m for three, ${arenaSizeFor(4)} m for four: fly out of one side and you come back in on the other. You can see ${SIGHT_REACH} m; the radar reaches ${RADAR_REACH} m, and you hear only what is on it. Destroy a ship for a frag; you fly again ${RESPAWN_DELAY} s after being destroyed. Rockets lock onto other pilots, and can be shot down. The match ends at the frag limit or the time limit, whichever comes first.</p>
		<h3>Bots</h3>
		<p>Online, the host can add bots in the lobby: in co-op they fight alongside you, in a deathmatch against everyone. A person joining takes the place of a bot if the room is full.</p>
	`;
}
