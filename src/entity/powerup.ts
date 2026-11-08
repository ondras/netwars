import { vec3 } from "gl-matrix";
import { Color } from "../color.ts";
import { cuboid, pyramid, ring, type Geometry } from "../geometry.ts";
import type { World } from "../world.ts";
import { Entity } from "./entity.ts";
import { BOOST_FACTOR, POWER_SHOT, ROCKET_CAPACITY, type Ship } from "./ship.ts";
import { toList } from "./targets.ts";

export type PowerupKind = "shields" | "power" | "boost" | "rockets";

/** Power shots a power shots powerup gives; they last until fired */
export const POWER_SHOTS = 50;
/** How long extra thrust lasts (s) */
export const BOOST_TIME = 15;
/** Rockets added by a rockets powerup, up to the capacity */
export const ROCKET_REFILL = 2;

/*
 * Each kind has its own shape and colours, and none of them looks like the rest of the scene:
 * ship and missile hulls are grey, white and red with touches of blue and green, pods are magenta octahedra.
 */
export const SHIELDS_BLUE = 0x7fd8ff;
export const POWER_YELLOW = POWER_SHOT.color;
export const POWER_RED = 0xff3326;
export const BOOST_GREEN = 0x55ee55;
export const ROCKETS_WHITE = 0xf2f2f2;
export const ROCKETS_RED = 0xff3326;

/** White crate with a red band: unlike the white and red ships by being a plain cube */
function rocketsShape(): Geometry[] {
	return [
		...cuboid(vec3.fromValues(-0.36, -0.36, -0.36), vec3.fromValues(0.36, 0.36, 0.36), new Color(ROCKETS_WHITE)),
		...cuboid(vec3.fromValues(-0.39, -0.1, -0.39), vec3.fromValues(0.39, 0.1, 0.39), new Color(ROCKETS_RED)),
	];
}

/** Light blue ring */
function shieldsShape(): Geometry[] {
	return ring(0.45, 0.14, new Color(SHIELDS_BLUE));
}

/** Yellow three-way cross with red tips */
function powerShape(): Geometry[] {
	const geometries: Geometry[] = [];
	for (const axis of [0, 1, 2]) {
		const from = vec3.fromValues(-0.08, -0.08, -0.08);
		const to = vec3.fromValues(0.08, 0.08, 0.08);
		from[axis] = -0.42;
		to[axis] = 0.42;
		geometries.push(...cuboid(from, to, new Color(POWER_YELLOW)));

		for (const side of [-1, 1]) {
			const inner = vec3.fromValues(-0.11, -0.11, -0.11);
			const outer = vec3.fromValues(0.11, 0.11, 0.11);
			inner[axis] = side * 0.42;
			outer[axis] = side * 0.55;
			geometries.push(...cuboid(inner, outer, new Color(POWER_RED)));
		}
	}
	return geometries;
}

/** Green arrow */
function boostShape(): Geometry[] {
	const green = new Color(BOOST_GREEN);
	return [
		...cuboid(vec3.fromValues(-0.09, -0.55, -0.09), vec3.fromValues(0.09, 0.05, 0.09), green),
		...pyramid(0.05, 0.55, 0.3, green),
	];
}

interface PowerupInfo {
	readonly label: string;
	/** Marks it on the radar */
	readonly letter: string;
	/** What it does, in a few words */
	readonly effect: string;
	readonly shape: () => Geometry[];
}

export const POWERUPS: Record<PowerupKind, PowerupInfo> = {
	shields: { label: "Shields", letter: "S", effect: "back to full", shape: shieldsShape },
	power: { label: "Power shots", letter: "P", effect: `your next ${POWER_SHOTS} shots do double damage`, shape: powerShape },
	boost: { label: "Extra thrust", letter: "T", effect: `${BOOST_FACTOR * 100} % of the speed you set, for ${BOOST_TIME} s`, shape: boostShape },
	rockets: { label: "Rockets", letter: "R", effect: `${ROCKET_REFILL} more, up to ${ROCKET_CAPACITY}`, shape: rocketsShape },
};

/** Collected within this gap between the bounding spheres (m) */
const PICKUP_GAP = 1;

/** Tumbling shape, collected by flying through it; a shot destroys it. Enemies' fire cannot: it only hits what it is meant for. */
export class Powerup extends Entity {
	readonly kind: PowerupKind;
	/** The player who flew through it */
	collector: Ship | null = null;
	private readonly players: readonly Ship[];

	/** @param players Who can collect it: one ship or a list kept up to date by the caller */
	constructor(kind: PowerupKind, players: Ship | readonly Ship[]) {
		super();
		this.kind = kind;
		this.players = toList(players);
		this.geometries = POWERUPS[kind].shape();
		this.hittable = true;
		vec3.set(this.angularVelocity, 0.8, 1.6, 0);
	}

	override update(dt: number, world: World): void {
		super.update(dt, world);

		for (const player of this.players) {
			if (player.dead) { continue; }
			if (vec3.distance(this.position, world.nearest(player.position, this.position)) <= this.radius + player.radius + PICKUP_GAP) {
				applyPowerup(this.kind, player);
				world.sound("powerup", undefined, player);
				this.collector = player;
				this.dead = true;
				return;
			}
		}
	}
}

export function applyPowerup(kind: PowerupKind, ship: Ship): void {
	switch (kind) {
		case "shields": ship.shields.value = ship.shields.max; break;
		case "power": ship.effects.power = POWER_SHOTS; break;
		case "boost": ship.effects.boost = BOOST_TIME; break;
		case "rockets": ship.rockets = Math.min(ROCKET_CAPACITY, ship.rockets + ROCKET_REFILL); break;
	}
}
