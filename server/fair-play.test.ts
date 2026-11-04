/*
 * Browsers and a room playing a real match over a simulated connection: whatever the connection does,
 * honest browsers must not be refused anything (server/checks.ts), and what they hit must count.
 */
import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import type { Entity } from "../src/entity/entity.ts";
import { PlayerShip } from "../src/entity/player-ship.ts";
import { Ship } from "../src/entity/ship.ts";
import { Loop } from "../src/loop.ts";
import type { ClientMessage, ServerMessage, StartMessage } from "../src/net/protocol.ts";
import { OnlineSession } from "../src/net/session.ts";
import type { Pilot } from "../src/pilot.ts";
import { settle, stubModels } from "../src/testing.ts";
import { Room, type Member } from "./room.ts";

beforeAll(stubModels);

const STEP = 0.015;

interface Connection {
	/** One way (s) */
	delay: () => number;
	/** Every so often nothing gets through for a while, then all of it at once, as over TCP: [every (s), for (s)] */
	stall?: readonly [number, number];
	/**
	 * Share of hits that may not count: over a stalled connection targets stand still on the screen, where they are
	 * no longer; what is shot there has not been hit
	 */
	lostHits?: number;
	/** Browsers run this slowly: all the steps of a frame at once, seconds per frame */
	frame?: number;
	/** Which game; a deathmatch unless told otherwise */
	coop?: boolean;
}

/** Messages on their way, in order: one late message holds up those behind it */
class Wire<T> {
	private readonly queue: Array<{ at: number; message: T }> = [];
	private last = 0;
	private readonly connection: Connection;

	constructor(connection: Connection) {
		this.connection = connection;
	}

	send(now: number, message: T): void {
		let at = now + this.connection.delay();
		const stall = this.connection.stall;
		if (stall && now % stall[0] < stall[1]) { at = Math.max(at, now - now % stall[0] + stall[1]); }
		this.last = Math.max(this.last, at);
		/* JSON, as on a real connection: nothing shared by accident */
		this.queue.push({ at: this.last, message: JSON.parse(JSON.stringify(message)) as T });
	}

	deliver(now: number, receive: (message: T) => void): void {
		while (this.queue.length && this.queue[0].at <= now) { receive(this.queue.shift()!.message); }
	}
}

/** A person, more or less: the hunter chases whoever is around and fires when lined up; the other flies about, slower, staying around */
class Hunter implements Pilot {
	private time = Math.random() * 100;
	private readonly last = new Map<Entity, vec3>();
	private readonly loop: Loop;
	private readonly aim: boolean;
	private readonly coop: boolean;

	constructor(loop: Loop, aim: boolean, coop: boolean) {
		this.loop = loop;
		this.aim = aim;
		this.coop = coop;
	}

	update(dt: number, ship: Ship): void {
		this.time += dt;
		ship.engine.speed.target = (this.aim ? ship.topSpeed : 0.4 * ship.topSpeed);
		ship.trigger = false;

		const target = this.loop.scene.find(entity => entity instanceof Ship && entity != ship && !entity.dead && (this.coop ? !(entity instanceof PlayerShip) : true));
		if (!this.aim || !target) {
			if (target && vec3.distance(ship.position, target.position) > 60) {
				ship.steerTowards(target.position);
			} else {
				ship.engine.yaw.control = 0.5 * Math.sin(this.time * 1.3);
				ship.engine.pitch.control = 0.5 * Math.sin(this.time * 0.7);
			}
			return;
		}

		/* aim ahead of where it is, by how it moves against this ship while the shot flies (a shot keeps the ship's velocity) */
		const last = this.last.get(target) ?? vec3.clone(target.position);
		const moved = vec3.subtract(vec3.create(), target.position, last);
		this.last.set(target, vec3.clone(target.position));
		const velocity = (vec3.length(moved) < 5 ? vec3.scale(vec3.create(), moved, 1 / dt) : vec3.create()); /* not when it came back elsewhere */
		const relative = vec3.subtract(vec3.create(), velocity, ship.velocity);
		const flight = vec3.distance(ship.position, target.position) / 120;
		const angle = ship.steerTowards(vec3.scaleAndAdd(vec3.create(), target.position, relative, flight));
		ship.trigger = angle < 0.02 && flight < 1;
	}
}

/** A browser, without the drawing */
class Browser {
	readonly loop = new Loop();
	session: OnlineSession | null = null;
	readonly hitsClaimed: number[] = [];
	private readonly me: number;
	private readonly up: Wire<ClientMessage>;
	private readonly clock: () => number;
	private readonly aim: boolean;

	constructor(me: number, up: Wire<ClientMessage>, clock: () => number, aim: boolean) {
		this.me = me;
		this.up = up;
		this.clock = clock;
		this.aim = aim;
	}

	receive(message: ServerMessage): void {
		switch (message.type) {
			case "start": this.begin(message); break;
			case "snapshot": this.session?.receive(message); break;
			default:
		}
	}

	private begin(start: StartMessage): void {
		const { loop } = this;
		loop.size = start.arena?.size ?? null;
		const ship = new PlayerShip();
		ship.setPilot(new Hunter(loop, this.aim, start.arena === null));
		ship.rockets = 0; /* guns only; rockets have tests of their own */
		vec3.set(ship.position, ...start.spawn);
		loop.scene.push(ship);
		loop.players.push(ship);
		const session = new OnlineSession(loop, message => {
			if (message.type == "state") { this.hitsClaimed.push(...message.hits.map(({ id }) => id)); }
			this.up.send(this.clock(), message);
		}, start, this.me, ship, this.clock);
		loop.rules = session.rules;
		loop.onStep = () => session.step(STEP);
		this.session = session;
	}
}

/** A deathmatch of two for the given time, playing out in steps of the browsers' simulation */
async function play(connection: Connection, seconds: number): Promise<{ room: Room; browsers: Browser[] }> {
	let now = 0;
	const clock = () => now;
	const down = [new Wire<ServerMessage>(connection), new Wire<ServerMessage>(connection)];
	const up = [new Wire<ClientMessage>(connection), new Wire<ClientMessage>(connection)];
	/* one aims, the other is the target: both chase each other all the same in the end */
	const browsers = [new Browser(1, up[0], clock, true), new Browser(2, up[1], clock, false)];
	const member = (i: number): Member => ({ id: i + 1, name: `Pilot ${i + 1}`, token: `t${i}`, send: message => down[i].send(now, message) });

	const room = new Room("ABCD", member(0), 0, "normal");
	room.join(member(1));
	room.setup(1, { mode: (connection.coop ? "coop" : "deathmatch"), level: 5, difficulty: "easy", fragLimit: 30, timeLimit: 15 });
	room.start(1);
	await settle();

	const frame = connection.frame ?? STEP;
	let sinceFrame = 0;
	for (; now < seconds; now += STEP) {
		room.advance(STEP);
		sinceFrame += STEP;
		const frameEnds = sinceFrame >= frame;
		for (let i = 0; i < 2; i++) {
			down[i].deliver(now, message => browsers[i].receive(message));
			up[i].deliver(now, message => { if (message.type == "state") { room.report(i + 1, message); } });
			if (frameEnds) { browsers[i].loop.advance(sinceFrame); }
		}
		if (frameEnds) { sinceFrame = 0; }
	}
	return { room, browsers };
}

const scoreOf = (room: Room, id: number) =>
	(room as unknown as { level: { match: { frags: Map<number, number> } } }).level.match.frags.get(id) ?? 0;

describe("honest browsers", () => {
	const cases: Array<[string, Connection]> = [
		["a good connection", { delay: () => 0.02 }],
		["a slow one", { delay: () => 0.1 }],
		["an uneven one", { delay: () => 0.03 + 0.08 * Math.random() }],
		["one that stalls now and then", { delay: () => 0.04, stall: [5, 0.5], lostHits: 0.25 }],
		["a slow computer, at 20 frames a second", { delay: () => 0.03, frame: 0.05 }],
		["a very slow computer, at 8 frames a second", { delay: () => 0.03, frame: 0.125 }],
	];

	it.each(cases)("are not refused anything over %s, and what they hit counts", async (_name, connection) => {
		const { room, browsers } = await play(connection, 180);
		const claimed = browsers[0].hitsClaimed.length;
		const { moves, shots, rockets, hits } = room.refused;

		expect({ moves, shots, rockets }).toEqual({ moves: 0, shots: 0, rockets: 0 });
		expect(hits).toBeLessThanOrEqual(claimed * (connection.lostHits ?? 0));
		expect(claimed).toBeGreaterThan(8); /* the hunter did find its target */
		/* four hits to a frag; shots still on their way when the target blows up claim hits on nothing */
		expect(scoreOf(room, 1)).toBeGreaterThanOrEqual(Math.floor((claimed - hits) / 6) - 1);
	}, 30000);

	it("are not refused anything shooting at enemies in co-op", async () => {
		const { room, browsers } = await play({ delay: () => 0.05, coop: true }, 120);
		expect(room.refused).toEqual({ moves: 0, shots: 0, rockets: 0, hits: 0 });
		expect(browsers[0].hitsClaimed.length).toBeGreaterThan(8);
	}, 30000);
});
