import { quat, vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { botTraits, noticeChance, POD_CLEARANCE } from "../src/bot.ts";
import { SENSE_FADE, SIGHT_REACH } from "../src/senses.ts";
import { Hunter } from "../src/entity/hunter.ts";
import { Missile } from "../src/entity/missile.ts";
import { Pirate } from "../src/entity/pirate.ts";
import type { PlayerShip } from "../src/entity/player-ship.ts";
import { Pod } from "../src/entity/pod.ts";
import { Powerup } from "../src/entity/powerup.ts";
import { EnemySpawner } from "../src/entity/spawner.ts";
import { angleOffNose } from "../src/lock.ts";
import type { Loop } from "../src/loop.ts";
import { DIFFICULTIES } from "../src/difficulty.ts";
import { enemyWaves, LEVELS } from "../src/levels.ts";
import type { Mechanics } from "../src/mechanics.ts";
import { MAX_PLAYERS, type ServerMessage, type Snapshot } from "../src/net/protocol.ts";
import { settle, stubModels } from "../src/testing.ts";
import { analyze, analyzeCoop, coopReport, report } from "./analyze.ts";
import { defend, fight, tournament } from "./arena.ts";
import type { Allowance } from "./checks.ts";
import type { LogEntry } from "./match-log.ts";
import { Room, type Member } from "./room.ts";

beforeAll(stubModels);

interface TestMember extends Member {
	readonly messages: ServerMessage[];
}

function member(id: number): TestMember {
	const messages: ServerMessage[] = [];
	return { id, name: `Pilot ${id}`, token: `token-${id}`, look: 0, messages, send: message => { messages.push(message); } };
}

function deathmatch(logs: ConstructorParameters<typeof Room>[4] = null): { room: Room; host: TestMember } {
	const host = member(1);
	const room = new Room("ABCD", host, 0, "normal", logs);
	room.setup(host.id, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 3, timeLimit: 5 });
	return { room, host };
}

type Reachable = { level: { flyers: Map<number, { ship: PlayerShip; allowance: Allowance }>; loop: Loop } };
const shipOf = (room: Room, id: number) => (room as unknown as Reachable).level.flyers.get(id)!.ship;
const loopOf = (room: Room) => (room as unknown as Reachable).level.loop;
const run = (room: Room, seconds: number) => {
	for (let t = 0; t < seconds; t += 0.05) { room.advance(0.05); }
};
const snapshots = (m: TestMember) => m.messages.filter((message): message is Snapshot => message.type == "snapshot");

describe("bots in a room", () => {
	it("are added and removed by the host only, in a deathmatch, and count as pilots", () => {
		const { room, host } = deathmatch();
		const guest = member(2);
		room.join(guest);

		room.addBot(guest.id, 10);
		expect(room.members).toHaveLength(2);

		room.addBot(host.id, 10);
		const bot = room.info().players.at(-1)!;
		expect(bot).toMatchObject({ id: 10, name: "Ada", bot: true, away: false });

		room.removeBot(guest.id, 10);
		expect(room.members).toHaveLength(3);
		room.removeBot(host.id, guest.id); /* only bots can be removed this way */
		expect(room.members).toHaveLength(3);
		room.removeBot(host.id, 10);
		expect(room.members).toHaveLength(2);
	});

	it("join co-op too, and stay when the host switches between the modes", () => {
		const host = member(1);
		const room = new Room("ABCD", host, 0, "normal");
		room.addBot(host.id, 10);
		expect(room.members).toHaveLength(2);

		room.setup(host.id, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 3, timeLimit: 5 });
		room.setup(host.id, { mode: "coop", level: 0, difficulty: "normal", fragLimit: 3, timeLimit: 5 });
		expect(room.members).toHaveLength(2);
	});

	it("make way for a person when the room is full, and fill it no further", () => {
		const { room, host } = deathmatch();
		for (let i = 1; i < MAX_PLAYERS + 2; i++) { room.addBot(host.id, 10 + i); }
		expect(room.members).toHaveLength(MAX_PLAYERS);

		expect(room.join(member(2))).toBeNull();
		expect(room.members).toHaveLength(MAX_PLAYERS);
		expect(room.members.filter(({ bot }) => bot)).toHaveLength(MAX_PLAYERS - 2);
	});

	it("never host, and do not keep a room open once the people are gone", () => {
		const { room, host } = deathmatch();
		const guest = member(2);
		room.addBot(host.id, 10);
		room.join(guest);

		expect(room.leave(host.id)).toBe(false);
		expect(room.host).toBe(guest.id);
		expect(room.leave(guest.id)).toBe(true);
	});

	it("fight a person: their shots count on the server, and they get the frag", () => {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10, botTraits(1, 1));
		room.start(host.id);

		const victim = shipOf(room, host.id);
		const hunter = shipOf(room, 10);
		vec3.set(hunter.position, 0, 0, 0);
		/* the person sits still in front of the bot, reporting that every moment */
		for (let t = 0; t < 30 && !victim.dead; t += 0.05) {
			vec3.set(victim.position, 0, 0, -60);
			room.advance(0.05);
		}

		expect(victim.dead).toBe(true);
		run(room, 0.1); /* the next snapshot has it */
		const { match } = snapshots(host).at(-1)!;
		expect(match!.frags[10]).toBe(1);
	});

	it("can be hit by a person's shots, checked like any others, and give them the frag", () => {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10, { ...botTraits(), cruise: 0, positioning: 0, fireRange: 0, rocketDelay: Infinity }); /* stays put, holds its fire */
		room.start(host.id);

		const flyers = (room as unknown as Reachable).level.flyers;
		const target = shipOf(room, 10);
		vec3.set(target.position, 0, 0, -40);
		vec3.set(shipOf(room, host.id).position, 0, 0, 0);
		flyers.get(host.id)!.allowance.restart(shipOf(room, host.id));
		run(room, 0.6);

		const last = () => snapshots(host).at(-1)!;
		const id = Object.keys(last().looks).map(Number).find(ship => ship != last().ship)!;
		const flying = { p: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], speed: 0, target: 0, yaw: 0, pitch: 0 };
		for (let n = 1; n <= 4; n++) {
			const t = last().t;
			room.report(host.id, { type: "state", ship: flying, shots: [{ n, t, p: [0, 0, -3], v: [0, 0, -120] }], rockets: [], hits: [] });
			run(room, 0.35);
			room.report(host.id, { type: "state", ship: flying, shots: [], rockets: [], hits: [{ shot: n, id, t: t + 0.31 }] });
			run(room, 0.1);
		}

		expect(target.dead).toBe(true);
		expect(room.refused.hits).toBe(0);
		expect(last().match!.frags[host.id]).toBe(1);
	});

	it("stand still, with the level and its clock, while every person in it has paused", () => {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10, botTraits(1, 1));
		room.start(host.id);
		const person = shipOf(room, host.id);
		vec3.set(person.position, 0, 0, -60);
		vec3.zero(shipOf(room, 10).position);
		const clock = () => snapshots(host).at(-1)!.match!.left;
		run(room, 0.2);

		room.setPaused(host.id, true);
		const before = { left: clock(), shields: person.shields.value, snapshots: snapshots(host).length, at: vec3.clone(shipOf(room, 10).position) };
		run(room, 10);
		expect(snapshots(host)).toHaveLength(before.snapshots);
		expect(person.shields.value).toBe(before.shields);
		expect(vec3.distance(shipOf(room, 10).position, before.at)).toBe(0);

		room.setPaused(host.id, false);
		run(room, 1);
		expect(clock()).toBeLessThan(before.left);
		expect(clock()).toBeGreaterThan(before.left - 2);
	});

	it("play on when someone else is still playing, or when the one who paused is gone", () => {
		const { room, host } = deathmatch();
		const guest = member(2);
		room.join(guest);
		room.addBot(host.id, 10);
		room.start(host.id);
		run(room, 0.2);

		room.setPaused(host.id, true);
		const before = snapshots(host).length;
		run(room, 1);
		expect(snapshots(host).length).toBeGreaterThan(before); /* the guest plays on */

		room.leave(guest.id);
		room.disconnected(host.id); /* paused, then gone: nobody is there to keep it still for */
		const then = snapshots(host).length;
		run(room, 1);
		expect(snapshots(host).length).toBeGreaterThan(then);
	});

	it("come back after being destroyed, flying a new ship", () => {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10);
		room.start(host.id);
		const first = shipOf(room, 10);
		first.absorb(1000);
		first.dead = true;
		first.exploded = true;
		run(room, 4);

		const second = shipOf(room, 10);
		expect(second).not.toBe(first);
		expect(second.dead).toBe(false);
	});

	it("use only the controls a person has, within their limits", () => {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10);
		room.start(host.id);
		for (let t = 0; t < 20; t += 0.05) {
			room.advance(0.05);
			const { engine } = shipOf(room, 10);
			expect(Math.abs(engine.yaw.control)).toBeLessThanOrEqual(1);
			expect(Math.abs(engine.pitch.control)).toBeLessThanOrEqual(1);
			expect(Math.abs(engine.speed.value)).toBeLessThanOrEqual(15.001);
		}
	});
});

describe("how bots fly", () => {
	/** A bot at the origin, facing -Z, and a person who sits still at the given place */
	function pair(personAt: [number, number, number], traits = botTraits()): { room: Room; bot: PlayerShip; person: PlayerShip } {
		const { room, host } = deathmatch();
		room.addBot(host.id, 10, traits);
		room.start(host.id);
		const bot = shipOf(room, 10);
		vec3.zero(bot.position);
		quat.identity(bot.orientation);
		const person = shipOf(room, host.id);
		vec3.set(person.position, ...personAt);
		return { room, bot, person };
	}

	function powerupAt(room: Room, kind: Powerup["kind"], x: number, y: number, z: number): Powerup {
		const loop = loopOf(room);
		const powerup = new Powerup(kind, loop.players);
		vec3.set(powerup.position, x, y, z);
		loop.spawn(powerup);
		return powerup;
	}

	it("go and collect a powerup while nobody is near", () => {
		const { room, bot } = pair([190, 190, 190]);
		const powerup = powerupAt(room, "boost", 50, 20, -40);
		run(room, 12);
		expect(powerup.collector).toBe(bot);
	});

	it("leave a powerup alone to fight a ship that comes close", () => {
		const { room, bot, person } = pair([0, 0, 70]);
		const powerup = powerupAt(room, "boost", 60, 0, 0);
		run(room, 1.5);
		expect(angleOffNose(bot, person.position)).toBeLessThan(Math.PI / 4);
		expect(powerup.dead).toBe(false);
	});

	it("know only what their radar shows, and go looking meanwhile, rather than stop", () => {
		const { room, bot } = pair([-150, 0, -170]); /* 227 m away */
		let fired = false;
		for (let t = 0; t < 4; t += 0.05) {
			room.advance(0.05);
			fired ||= bot.trigger;
		}
		expect(fired).toBe(false);
		expect(bot.engine.speed.value).toBeGreaterThan(5);
	});

	it("fight a ship once it is on their radar", () => {
		const { room, bot } = pair([-60, 0, -80]); /* 100 m away */
		let fired = false;
		for (let t = 0; t < 6 && !fired; t += 0.05) {
			room.advance(0.05);
			fired ||= bot.trigger;
		}
		expect(fired).toBe(true);
	});

	it("hold their fire at a ship on their radar but out of sight, however far their guns would reach", () => {
		const { room, bot } = pair([0, 0, -(SIGHT_REACH + 10)], { ...botTraits(), fireRange: 400 });
		let fired = false;
		for (let t = 0; t < 1.5; t += 0.05) {
			room.advance(0.05);
			fired ||= bot.trigger;
		}
		expect(fired).toBe(false);
	});

	it("stop firing the moment their target is out of sight, even in the middle of a burst", () => {
		const { room, bot, person } = pair([0, 0, -100]);
		for (let t = 0; t < 6 && !bot.trigger; t += 0.05) { room.advance(0.05); }
		expect(bot.trigger).toBe(true);

		const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), bot.orientation);
		vec3.scaleAndAdd(person.position, bot.position, nose, SIGHT_REACH + 10); /* still on the radar, now out of sight */
		room.advance(0.05);
		expect(bot.trigger).toBe(false);
	});

	it("notice a ship as a person would see it: in full view at once, fading out of sight seldom until well into the fade, out of sight never", () => {
		expect(noticeChance(SIGHT_REACH - SENSE_FADE)).toBe(1);
		expect(noticeChance(SIGHT_REACH - SENSE_FADE / 4)).toBeLessThan(0.05);
		expect(noticeChance(SIGHT_REACH - SENSE_FADE / 2)).toBeLessThan(0.2);
		expect(noticeChance(SIGHT_REACH - SENSE_FADE * 3 / 4)).toBeGreaterThan(0.3);
		expect(noticeChance(SIGHT_REACH)).toBe(0);

		/* halfway into the fade, it fires in the end, but not at once */
		const firstShot = (distance: number) => {
			const { room, bot } = pair([0, 0, -distance], { ...botTraits(), fireRange: 400, cruise: 0 });
			let t = 0;
			for (; t < 10 && !bot.trigger; t += 0.05) { room.advance(0.05); }
			return t;
		};
		const fading = Array.from({ length: 12 }, () => firstShot(SIGHT_REACH - SENSE_FADE / 2));
		const clear = Array.from({ length: 12 }, () => firstShot(SIGHT_REACH - SENSE_FADE - 10));
		const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
		expect(mean(fading)).toBeGreaterThan(mean(clear) + 0.3);
	});

	it("lose a ship the moment it leaves their radar, not when they next look around", () => {
		const { room, person } = pair([0, 0, -100]);
		const pilot = (room as unknown as { level: { flyers: Map<number, { pilot: unknown }> } }).level.flyers.get(10)!.pilot as { target: unknown };
		run(room, 0.5);
		expect(pilot.target).toBe(person);
		vec3.set(person.position, 150, 150, 0); /* 212 m away */
		room.advance(0.05);
		expect(pilot.target).toBeNull();
	});

	it("do not see powerups beyond their radar either", () => {
		const { room, bot } = pair([190, 190, 190]);
		const far = powerupAt(room, "boost", 0, 0, 230); /* behind, beyond the radar */
		run(room, 3);
		expect(angleOffNose(bot, far.position)).toBeGreaterThan(Math.PI / 4);
	});

	it("do not bother with what would do them no good", () => {
		const { room, bot } = pair([190, 190, 190]);
		const shields = powerupAt(room, "shields", 0, 0, -40);
		const rockets = powerupAt(room, "rockets", 0, 40, 0);
		const boost = powerupAt(room, "boost", 150, 0, 0);
		run(room, 3);
		expect(angleOffNose(bot, boost.position)).toBeLessThan(angleOffNose(bot, shields.position));
		expect(angleOffNose(bot, boost.position)).toBeLessThan(angleOffNose(bot, rockets.position));
	});

	it("launch rockets once they have a lock, also at a ship through the wall", () => {
		const { room, bot } = pair([0, 0, 340], { ...botTraits(), fireRange: 0 }); /* the world repeats every 400 m: its nearest copy is 60 m ahead; no gun, or it may win before a lock */
		for (let t = 0; t < 8 && bot.rockets == 3; t += 0.05) { room.advance(0.05); }
		expect(bot.rockets).toBeLessThan(3);
		const rocket = loopOf(room).scene.find(entity => entity instanceof Missile && entity.owner == bot);
		expect(rocket).toBeDefined();
	});

	it("keep the trigger down for a while once they pull it", () => {
		const { room, bot } = pair([0, 0, -50]);
		const held: boolean[] = [];
		for (let t = 0; t < 6; t += 0.05) {
			room.advance(0.05);
			held.push(bot.trigger);
		}
		const pulls = held.filter((down, i) => down && !held[i - 1]).length;
		expect(pulls).toBeGreaterThan(0);
		expect(held.filter(Boolean).length / pulls).toBeGreaterThan(5); /* at least a quarter of a second each */
	});
});

describe("bots in co-op", () => {
	/** A co-op level of a person and a bot, the bot 200 m off the pods, facing -Z, the enemies not sent in yet */
	async function defending(traits = botTraits(), mechanics: Mechanics = "classic"): Promise<{ room: Room; loop: Loop; bot: PlayerShip; person: PlayerShip }> {
		const host = member(1);
		const room = new Room("ABCD", host, 0, "normal", null, mechanics);
		room.addBot(host.id, 10, traits);
		room.start(host.id);
		await settle();
		const loop = loopOf(room);
		loop.scene.splice(loop.scene.findIndex(entity => entity instanceof EnemySpawner), 1);
		const bot = shipOf(room, 10);
		vec3.set(bot.position, 200, 0, 0);
		quat.identity(bot.orientation);
		return { room, loop, bot, person: shipOf(room, host.id) };
	}

	function pirateAt(loop: Loop, x: number, y: number, z: number): Pirate {
		const pirate = new Pirate(loop.players);
		vec3.set(pirate.position, x, y, z);
		loop.spawn(pirate);
		return pirate;
	}

	it("fight the enemies, their shots passing through a teammate in the way", async () => {
		const { room, loop, person } = await defending();
		vec3.set(person.position, 200, 0, -20);
		const pirate = pirateAt(loop, 200, 0, -60);
		run(room, 3); /* a pirate fires its first missile 4 s in at the soonest */
		expect(pirate.shields.value < pirate.shields.max || pirate.dead).toBe(true);
		expect(person.shields.value).toBe(person.shields.max);
	});

	it("hold their fire with a pod in the line of fire", async () => {
		const { room, loop, bot } = await defending();
		const pod = loop.scene.find((entity): entity is Pod => entity instanceof Pod)!;
		vec3.set(pod.position, 200, 0, -40);
		pirateAt(loop, 200, 0, -80);
		/* how far the pod is off the line of fire (m) */
		const offLine = () => {
			const nose = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 0, -1), bot.orientation);
			const to = vec3.subtract(vec3.create(), pod.position, bot.position);
			return Math.sqrt(vec3.squaredLength(to) - vec3.dot(to, nose) ** 2);
		};
		let heldWithPodInLine = false;
		for (let t = 0; t < 3; t += 0.05) {
			room.advance(0.05);
			if (bot.trigger) { expect(offLine()).toBeGreaterThan(POD_CLEARANCE); }
			heldWithPodInLine ||= (!bot.trigger && offLine() < POD_CLEARANCE);
		}
		expect(heldWithPodInLine).toBe(true);
		expect(pod.dead).toBe(false);
	});

	/** Each step of `seconds`: the strafe the bot asks for, and whether its trigger is down */
	function watch(room: Room, bot: PlayerShip, seconds: number): Array<{ t: number; strafe: number; trigger: boolean }> {
		const steps = [];
		for (let t = 0; t < seconds; t += 0.05) {
			room.advance(0.05);
			steps.push({ t, strafe: bot.engine.strafe.target, trigger: bot.trigger });
		}
		return steps;
	}

	it("strafe aside for about a second once a hunter has been shooting at them for a moment, having fired back", async () => {
		const { room, loop, bot } = await defending({ ...botTraits(), strafing: 1 }, "modern");
		const hunter = new Hunter(loop.players);
		vec3.set(hunter.position, 200, 0, -90);
		quat.setAxisAngle(hunter.orientation, vec3.fromValues(0, 1, 0), Math.PI); /* nose on the bot */
		loop.spawn(hunter);

		const steps = watch(room, bot, 6);
		const start = steps.findIndex(step => step.strafe != 0);
		expect(start).toBeGreaterThan(0);
		const length = steps.slice(start).findIndex(step => step.strafe == 0);
		expect(length * 0.05).toBeGreaterThanOrEqual(0.4 - 0.05);
		expect(length * 0.05).toBeLessThanOrEqual(1.1 + 0.05);
		expect(steps.slice(Math.max(0, start - 20), start).some(step => step.trigger)).toBe(true); /* it fired in the second before */
		expect(Math.abs(steps[start].strafe)).toBe(bot.engine.strafe.limit);
	});

	it("never strafe with classic mechanics", async () => {
		const { room, loop, bot } = await defending({ ...botTraits(), strafing: 1 });
		const hunter = new Hunter(loop.players);
		vec3.set(hunter.position, 200, 0, -90);
		quat.setAxisAngle(hunter.orientation, vec3.fromValues(0, 1, 0), Math.PI);
		loop.spawn(hunter);
		const steps = watch(room, bot, 6);
		expect(steps.some(step => step.trigger)).toBe(true);
		expect(steps.every(step => step.strafe == 0)).toBe(true);
	});

	it("never strafe from a pirate: its missiles home in", async () => {
		const { room, loop, bot } = await defending({ ...botTraits(), strafing: 1 }, "modern");
		const pirate = pirateAt(loop, 200, 0, -60);
		quat.setAxisAngle(pirate.orientation, vec3.fromValues(0, 1, 0), Math.PI);
		const steps = watch(room, bot, 4);
		expect(steps.every(step => step.strafe == 0)).toBe(true);
	});

	it("keep near the pods while no enemy is about", async () => {
		const { room, loop, bot } = await defending();
		run(room, 20);
		const pods = loop.scene.filter((entity): entity is Pod => entity instanceof Pod);
		const center = vec3.create();
		for (const pod of pods) { vec3.scaleAndAdd(center, center, pod.position, 1 / pods.length); }
		expect(vec3.distance(bot.position, center)).toBeLessThan(90);
	});
});

describe("the arena", () => {
	it("runs a whole match of bots: they find each other and score", () => {
		const { frags, outcome } = fight([botTraits(), botTraits()], { fragLimit: 3, timeLimit: 5 });
		expect(outcome.outcome).toBe("match-over");
		expect(frags[0] + frags[1]).toBeGreaterThan(0);
	});

	it("gives better aim more frags, all else being equal", () => {
		const { frags } = tournament([botTraits(1, 0.5), botTraits(0, 0.5)], 6, { fragLimit: 10, timeLimit: 3 });
		expect(frags[0]).toBeGreaterThan(frags[1]);
	});

	it("gives better flying more frags, all else being equal", () => {
		const { frags } = tournament([botTraits(0.5, 1), botTraits(0.5, 0)], 30, { fragLimit: 10, timeLimit: 3 }); /* about 55 % of frags: it takes this many */
		expect(frags[0]).toBeGreaterThan(frags[1]);
	});
});

describe("recordings", () => {
	it("of co-op levels account for every enemy and every pod", async () => {
		const entries: LogEntry[] = [];
		const { outcome } = await defend([botTraits(), botTraits()], 1, "normal", () => ({ write: entry => { entries.push(entry); }, close: () => {} }));
		const stats = analyzeCoop(entries);
		const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
		const sent = enemyWaves(LEVELS[1], 2, DIFFICULTIES.normal.thieves).enemies.length;

		expect(stats.pods).toBe(outcome.podsTotal);
		expect(stats.pods - stats.podsStolen - stats.podsShot).toBe(outcome.podsLeft);
		if (outcome.outcome == "won") {
			expect(sum(stats.enemies)).toBe(sent);
			expect(stats.pilots.reduce((count, pilot) => count + sum(pilot.downed), 0) + stats.podsStolen).toBe(sent);
		}
		for (const pilot of stats.pilots) {
			expect(pilot.flying).toBeGreaterThan(30);
			expect(pilot.hits).toBeLessThanOrEqual(pilot.shots + pilot.rockets);
		}
		expect(coopReport(stats)).toContain("enemies destroyed");
	});

	it("have the same numbers for every pilot, and the analysis reads them", () => {
		const entries: LogEntry[] = [];
		let closed = 0;
		fight([botTraits(0.8, 0.8), botTraits(0.3, 0.3)], {
			fragLimit: 30, /* a whole 5 minutes: enough meetings for every kind of entry, with bots that only fight what their radar shows */
			timeLimit: 5,
			logs: () => ({ write: entry => { entries.push(entry); }, close: () => { closed++; } }),
		});

		expect(closed).toBe(1);
		const kinds = new Set(entries.map(({ k }) => k));
		for (const kind of ["start", "f", "shot", "hit", "kill", "rocket", "end"] as const) { expect(kinds, kind).toContain(kind); }
		expect(entries[0].k).toBe("start");
		expect(entries.at(-1)!.k).toBe("end");

		const [good, poor] = analyze(entries);
		for (const stats of [good, poor]) {
			expect(stats.flying).toBeGreaterThan(5);
			expect(stats.hitRate).toBeGreaterThanOrEqual(0);
			expect(stats.hitRate).toBeLessThanOrEqual(1);
			expect(stats.hitRateClose).toBeLessThanOrEqual(1);
			expect(stats.hitRateMiddle).toBeLessThanOrEqual(1);
			expect(stats.speed).toBeGreaterThan(5);
			expect(stats.speed).toBeLessThanOrEqual(23);
			expect(stats.timeClose + stats.timeFar).toBeLessThanOrEqual(1);
			expect(stats.fightsPerMinute).toBeGreaterThan(0);
			expect(stats.burstLength).toBeGreaterThan(1);
			expect(stats.stickMoving).toBeGreaterThan(0);
		}
		expect(good.rockets + poor.rockets).toBeGreaterThan(0);
		expect(good.shots + poor.shots).toBeGreaterThan(0);
		expect(good.hitRate + poor.hitRate).toBeGreaterThan(0); /* a short match can leave the weaker bot without a hit */
		expect(report([good, poor])).toContain("hit rate");
	});
});
