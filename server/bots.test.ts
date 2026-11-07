import { vec3 } from "gl-matrix";
import { beforeAll, describe, expect, it } from "vitest";
import { botTraits } from "../src/bot.ts";
import type { PlayerShip } from "../src/entity/player-ship.ts";
import { MAX_PLAYERS, type ServerMessage, type Snapshot } from "../src/net/protocol.ts";
import { stubModels } from "../src/testing.ts";
import type { Allowance } from "./checks.ts";
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

type Reachable = { level: { flyers: Map<number, { ship: PlayerShip; allowance: Allowance }> } };
const shipOf = (room: Room, id: number) => (room as unknown as Reachable).level.flyers.get(id)!.ship;
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

	it("are not there in co-op: not added, and gone when the host switches to it", () => {
		const host = member(1);
		const room = new Room("ABCD", host, 0, "normal");
		room.addBot(host.id, 10);
		expect(room.members).toHaveLength(1);

		room.setup(host.id, { mode: "deathmatch", level: 0, difficulty: "normal", fragLimit: 3, timeLimit: 5 });
		room.addBot(host.id, 10);
		expect(room.members).toHaveLength(2);
		room.setup(host.id, { mode: "coop", level: 0, difficulty: "normal", fragLimit: 3, timeLimit: 5 });
		expect(room.members).toHaveLength(1);
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
		room.addBot(host.id, 10, { ...botTraits(), cruise: 0, positioning: 0, fireRange: 0 }); /* stays put, holds its fire */
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
