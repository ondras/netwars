import { quat, vec3, type ReadonlyVec3 } from "gl-matrix";
import { resolveCollisions, segmentSphereEntry } from "../collision.ts";
import { explode } from "../entity/debris.ts";
import type { Entity } from "../entity/entity.ts";
import { Missile } from "../entity/missile.ts";
import { PlayerShip } from "../entity/player-ship.ts";
import { Pod } from "../entity/pod.ts";
import { applyPowerup } from "../entity/powerup.ts";
import { Ship } from "../entity/ship.ts";
import { Shot } from "../entity/shot.ts";
import type { Loop, Rules } from "../loop.ts";
import { applyExtra, createCopy } from "./kinds.ts";
import {
	ENTITY_KINDS, round, STATE_RATE,
	type ClientMessage, type EntityRecord, type GameEvent, type HitReport, type MatchState, type RocketReport, type ShotReport, type Snapshot,
	type StartMessage,
} from "./protocol.ts";

/**
 * Entities are shown this far in the past (s), between the two snapshots around that time:
 * two snapshot intervals, so that one late snapshot does not make them stop
 */
export const INTERPOLATION_DELAY = 0.1;
/** Snapshots kept waiting at most; older ones are applied at once (the clock estimate was off) */
const MAX_WAITING = 20;

type TimedEvent = Extract<GameEvent, ["shot", ...unknown[]]>;

interface Received {
	readonly snapshot: Snapshot;
	readonly byId: Map<number, EntityRecord>;
}

const vec = (x: number, y: number, z: number) => vec3.fromValues(x, y, z);
const rounded = (v: ReadonlyVec3): [number, number, number] => [round(v[0], 2), round(v[1], 2), round(v[2], 2)];

/**
 * A level played online, as one browser sees it. The server's entities appear as copies
 * (createCopy), placed between snapshots INTERPOLATION_DELAY in the past; the player's own ship flies here,
 * at once, and its position, shots, rockets and hits go to the server about STATE_RATE times a second.
 * In a world that wraps around, everything is kept at its copy nearest this ship, so that whatever deals with
 * the scene here (drawing, radar, lock-on, hits, bumps) sees it as if there was no edge.
 */
export class OnlineSession {
	readonly ship: PlayerShip;
	/** Which of the room's levels this is (StartMessage.run) */
	readonly run: number;
	/** Deathmatch: where it is fought and what ends it; null in co-op */
	readonly arena: StartMessage["arena"];
	/** Players' ships: this one and copies of the teammates' */
	readonly players: Ship[];
	/** Enemies still to come or present, and pods left, as of the latest snapshot */
	enemies = 0;
	pods: number;
	readonly podsTotal: number;
	/** Deathmatch: time left and frags, as of the latest snapshot */
	match: MatchState | null = null;
	/** Deathmatch: someone destroyed someone (player ids) */
	onFrag: ((killer: number, victim: number) => void) | null = null;

	private readonly loop: Loop;
	private readonly send: (message: ClientMessage) => void;
	private readonly clock: () => number;
	private shipId: number;
	private readonly copies = new Map<number, Entity>();
	private readonly idOf = new WeakMap<Entity, number>();
	/** Copies of other pilots' ships → their pilots' ids */
	private readonly pilotIds = new WeakMap<Entity, number>();
	/** Ids of entities that blew up: never shown again, even if an older snapshot still has them */
	private readonly gone = new Set<number>();
	private readonly waiting: Received[] = [];
	private current: Received | null = null;
	private readonly timeline: TimedEvent[] = [];
	/** Server time minus local time (s), estimated from the snapshots' arrival */
	private offset: number | null = null;
	/** The server time being shown (s) */
	private viewTime = 0;
	private sinceReport = 0;
	private shots: ShotReport[] = [];
	private rockets: RocketReport[] = [];
	private hits: HitReport[] = [];
	/** This ship's shots and rockets already reported */
	private readonly reported = new WeakSet<Entity>();
	private shotsFired = 0;
	/** This ship's shots → ShotReport.n */
	private readonly shotNumbers = new WeakMap<Entity, number>();
	/** Shown only: other ships' shots and rockets, whose hits the server decides */
	private readonly cosmetic = new WeakSet<Entity>();

	/**
	 * @param ship This player's ship, already in the loop's scene
	 * @param me This player's id
	 * @param clock Local time (s)
	 */
	constructor(loop: Loop, send: (message: ClientMessage) => void, start: StartMessage, me: number, ship: PlayerShip,
		clock = () => performance.now() / 1000) {
		this.loop = loop;
		this.send = send;
		this.clock = clock;
		this.ship = ship;
		this.run = start.run;
		this.arena = start.arena;
		this.players = [ship];
		this.shipId = start.ships[me];
		this.pods = this.podsTotal = start.podsTotal;
	}

	/** Hits, bumps: what replaces the usual rules of the loop */
	readonly rules: Rules = (scene, world) => {
		for (const shot of scene) {
			if (!(shot instanceof Shot) || shot.dead || !shot.simulated) { continue; }
			const target = this.firstHit(shot, scene);
			if (!target) { continue; }

			shot.dead = true;
			if (shot.owner == this.ship && !this.cosmetic.has(shot) && !(shot instanceof Missile)) { this.hit(shot, target); }
		}

		/* only this ship is moved here; the others bump on their own screens or on the server */
		resolveCollisions(scene, world, ship => ship == this.ship);
	};

	receive(snapshot: Snapshot): void {
		const sample = snapshot.t - this.clock();
		/* catch up quickly with a faster delivery, adapt slowly to slower ones */
		if (this.offset === null) {
			this.offset = sample;
		} else {
			this.offset += (sample - this.offset) * (sample > this.offset ? 0.5 : 0.05);
		}

		const byId = new Map(snapshot.e.map(record => [record[0], record]));
		this.waiting.push({ snapshot, byId });
		this.enemies = snapshot.enemies;
		this.pods = snapshot.pods;
		this.match = snapshot.match ?? null;
		if (!this.ship.dead) { this.ship.shields.value = snapshot.shields; }

		for (const event of snapshot.ev) {
			switch (event[0]) {
				/* heard and seen as they arrive: they need no place on the timeline */
				case "sound": {
					const [, , name, ...at] = event;
					this.loop.sound(name, at.length ? this.nearby(vec(at[0]!, at[1]!, at[2]!)) : undefined);
				} break;

				case "explode": this.blowUp(event[2]); break;
				case "powerup": applyPowerup(event[2], this.ship); break;
				case "frag": this.onFrag?.(event[2], event[3]); break;
				default: this.timeline.push(event);
			}
		}

		this.followOwnShip(snapshot.ship, byId);
	}

	/** Call after every simulation step */
	step(dt: number): void {
		if (this.offset !== null) {
			/* the step's own moment: shots keep pace with what is shown, however few frames a second this computer manages */
			const time = this.clock() - this.loop.stepsLeft * dt + this.offset - INTERPOLATION_DELAY;
			while (this.waiting.length && (this.waiting[0].snapshot.t <= time || this.waiting.length > MAX_WAITING)) {
				this.apply(this.waiting.shift()!);
			}
			while (this.timeline.length && this.timeline[0][1] <= time) { this.show(this.timeline.shift()!); }
			this.place(time);
			this.viewTime = time;
		}
		this.keepNearby();

		this.collectOwnShots();
		this.sinceReport += dt;
		if (this.sinceReport >= 1 / STATE_RATE) {
			this.sinceReport = 0;
			this.report();
		}
	}

	/** The level stood still on the server while this player paused alone: its clock did too, so it is taken afresh from the next snapshot */
	resync(): void {
		this.offset = null;
	}

	/** Whose ship this copy is: a player id, as in the room's list of players */
	pilotOf(ship: Entity): number | undefined {
		return this.pilotIds.get(ship);
	}

	/** Teammates still flying */
	get teammates(): Ship[] {
		return this.players.filter(ship => ship != this.ship && !ship.dead);
	}

	/** The copy of a point nearest this ship */
	private nearby(point: vec3): vec3 {
		return vec3.clone(this.loop.nearest(point, this.ship.position));
	}

	/** Everything to its copy nearest this ship; those farther than half the world on an axis go to the other side */
	private keepNearby(): void {
		if (this.loop.size === null) { return; }
		const offset = vec3.create();
		for (const entity of this.loop.scene) {
			if (entity == this.ship) { continue; }
			vec3.subtract(offset, this.loop.nearest(entity.position, this.ship.position), entity.position);
			if (offset[0] || offset[1] || offset[2]) { entity.shift(offset); }
		}
	}

	/** Which ship is ours now, as the server sees it: it can be gone (even if we missed that), or new and somewhere else */
	private followOwnShip(id: number, byId: ReadonlyMap<number, EntityRecord>): void {
		const record = byId.get(id);
		if (!record) {
			if (!this.ship.dead) { this.blowUp(this.shipId); }
			return;
		}
		if (id == this.shipId) { return; }

		this.gone.add(this.shipId);
		this.shipId = id;
		this.ship.revive();
		this.setFrom(this.ship, record);
		if (!this.loop.scene.includes(this.ship)) { this.loop.spawn(this.ship); }
	}

	/** Copies of what the snapshot has, created as entities first appear; the rest disappear */
	private apply(received: Received): void {
		for (const record of received.snapshot.e) {
			const [id, kind] = record;
			if (id == this.shipId || this.gone.has(id) || this.copies.has(id) || !ENTITY_KINDS[kind]) { continue; }
			const copy = createCopy(ENTITY_KINDS[kind], received.snapshot.looks[id]);
			if (ENTITY_KINDS[kind] == "rocket" && !this.arena) { copy.hittable = false; } /* co-op: no friendly fire */
			this.copies.set(id, copy);
			this.idOf.set(copy, id);
			if (copy instanceof PlayerShip) { this.players.push(copy); }
			const pilot = received.snapshot.pilots[id];
			if (pilot !== undefined) { this.pilotIds.set(copy, pilot); }
			this.setFrom(copy, record);
			this.loop.spawn(copy);
		}

		for (const [id, copy] of this.copies) {
			if (received.byId.has(id)) { continue; }
			copy.dead = true; /* gone quietly: collected, got away, burnt out */
			this.forget(id, copy);
		}

		this.current = received;
	}

	/** Copies placed at the given server time, between the current snapshot and the next */
	private place(time: number): void {
		const current = this.current;
		if (!current) { return; }
		const next = this.waiting[0];
		const span = (next ? next.snapshot.t - current.snapshot.t : 0);
		const alpha = (span > 0 ? Math.max(0, Math.min(1, (time - current.snapshot.t) / span)) : 0);

		for (const [id, copy] of this.copies) {
			const from = current.byId.get(id);
			if (!from) { continue; }
			const to = next?.byId.get(id);
			if (!to || !alpha) {
				this.setFrom(copy, from);
				continue;
			}
			vec3.lerp(copy.position, vec(from[2], from[3], from[4]), vec(to[2], to[3], to[4]), alpha);
			quat.slerp(copy.orientation, quat.fromValues(from[5], from[6], from[7], from[8]), quat.fromValues(to[5], to[6], to[7], to[8]), alpha);
			this.takeExtra(copy, from[9]);
		}
	}

	private setFrom(copy: Entity, [, , x, y, z, qx, qy, qz, qw, extra]: EntityRecord): void {
		vec3.set(copy.position, x, y, z);
		quat.set(copy.orientation, qx, qy, qz, qw);
		this.takeExtra(copy, extra);
	}

	/** The record's extra number; for a pod, which copy is carrying it off */
	private takeExtra(copy: Entity, extra: number): void {
		applyExtra(copy, extra);
		if (copy instanceof Pod) { copy.carrier = (extra ? this.copies.get(extra) ?? null : null); }
	}

	private forget(id: number, copy: Entity): void {
		this.copies.delete(id);
		const index = this.players.indexOf(copy as Ship);
		if (index >= 0) { this.players.splice(index, 1); }
	}

	private blowUp(id: number): void {
		this.gone.add(id);
		if (id == this.shipId) {
			explode(this.ship, this.loop);
			return;
		}
		const copy = this.copies.get(id);
		if (!copy) { return; }
		explode(copy, this.loop); /* debris and sound, here */
		this.forget(id, copy);
	}

	/** A shot fired by someone else, shown along with its sound */
	private show([, , x, y, z, vx, vy, vz, color, lifetime, owner, players]: TimedEvent): void {
		const shot = new Shot(this.nearby(vec(x, y, z)), vec(vx, vy, vz), this.copies.get(owner) ?? null, lifetime, 0, color);
		if (players) { shot.hitOnly = this.players; }
		this.cosmetic.add(shot);
		this.loop.spawn(shot);
		this.loop.sound("cannon", shot.position);
	}

	/** The entity a shot's path entered first during the last step, among those it can hit here */
	private firstHit(shot: Shot, scene: readonly Entity[]): Entity | null {
		let hit: Entity | null = null;
		let hitAt = Infinity;
		const fromPlayer = shot.owner instanceof PlayerShip;

		for (const target of scene) {
			if (!target.hittable || target.dead || target == shot.owner || !target.radius || this.cosmetic.has(target)) { continue; }
			if (shot.target && target != shot.target) { continue; }
			if (shot.hitOnly && !shot.hitOnly.includes(target)) { continue; }
			if (target instanceof Shot && target.owner == shot.owner) { continue; }
			if (fromPlayer && target instanceof PlayerShip && !this.arena) { continue; } /* co-op: no friendly fire */

			const t = segmentSphereEntry(shot.previousPosition, shot.position, target.position, target.radius + shot.radius);
			if (t !== null && t < hitAt) {
				hit = target;
				hitAt = t;
			}
		}

		return hit;
	}

	/** This ship's shot hit something on this screen: the server is told, and checks it; rockets it flies by itself */
	private hit(shot: Shot, target: Entity): void {
		const id = this.idOf.get(target);
		const number = this.shotNumbers.get(shot);
		if (id === undefined || number === undefined) { return; }
		this.hits.push({ shot: number, id, t: round(this.viewTime, 3) });

		/* a ship that survives makes the hit sound now; an explosion waits for the server's word */
		if (target instanceof Ship && target.absorb(shot.damage)) { this.loop.sound(shot.impactSound, target.position); }
	}

	private collectOwnShots(): void {
		for (const entity of this.loop.scene) {
			if (!(entity instanceof Shot) || entity.owner != this.ship || this.reported.has(entity) || this.cosmetic.has(entity)) { continue; }
			this.reported.add(entity);

			if (entity instanceof Missile) {
				const target = (entity.target ? this.idOf.get(entity.target) : undefined);
				if (target !== undefined) { this.rockets.push({ p: rounded(entity.position), target }); }
			} else {
				const n = ++this.shotsFired;
				this.shotNumbers.set(entity, n);
				this.shots.push({ n, t: round(this.viewTime, 3), p: rounded(entity.position), v: rounded(entity.velocity) });
			}
		}
	}

	private report(): void {
		const { ship } = this;
		if (ship.dead && !this.hits.length) { return; } /* until there is a new ship; shots can still land */

		const { speed, yaw, pitch } = ship.engine;
		const q = ship.orientation;
		this.send({
			type: "state",
			...(ship.dead ? {} : {
				ship: {
					p: rounded(ship.position),
					q: [round(q[0], 4), round(q[1], 4), round(q[2], 4), round(q[3], 4)],
					speed: round(speed.value, 2),
					target: speed.target,
					yaw: round(yaw.control, 3),
					pitch: round(pitch.control, 3),
				},
			}),
			shots: this.shots,
			rockets: this.rockets,
			hits: this.hits,
		});
		this.shots = [];
		this.rockets = [];
		this.hits = [];
	}
}
