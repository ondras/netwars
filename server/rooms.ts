import type { DifficultyLevel } from "../src/difficulty.ts";
import { CODE_ALPHABET, CODE_LENGTH } from "../src/net/protocol.ts";
import { Room, type Member } from "./room.ts";

/** Most rooms open at once; protects the server from runaway room creation */
const MAX_ROOMS = 500;

/** All open rooms, by code */
export class Rooms {
	private readonly rooms = new Map<string, Room>();
	private nextMemberId = 1;

	get count(): number {
		return this.rooms.size;
	}

	newMemberId(): number {
		return this.nextMemberId++;
	}

	/** @returns null when the server is full */
	create(host: Member, level: number, difficulty: DifficultyLevel): Room | null {
		if (this.rooms.size >= MAX_ROOMS) { return null; }
		let code: string;
		do {
			code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
		} while (this.rooms.has(code));

		const room = new Room(code, host, level, difficulty);
		this.rooms.set(code, room);
		return room;
	}

	find(code: string): Room | null {
		return this.rooms.get(code.trim().toUpperCase()) ?? null;
	}

	/** Take the member out of the room, closing it when they were the last one */
	leave(room: Room, memberId: number): void {
		if (room.leave(memberId)) { this.rooms.delete(room.code); }
	}

	/** Run every room's level for the real time elapsed (s) */
	advance(elapsed: number): void {
		for (const room of this.rooms.values()) { room.advance(elapsed); }
	}
}
