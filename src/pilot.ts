import type { Ship } from "./entity/ship.ts";

/** Controls a ship by setting its engine controls and trigger */
export interface Pilot {
	update(dt: number, ship: Ship): void;
}

/** Target speed change per key press (m/s) */
export const SPEED_STEP = 1;

/** Physical keys (KeyboardEvent.code), so they work with any keyboard layout */
const SPEED_KEYS: Record<string, Direction> = {
	KeyW: 1,
	KeyS: -1,
};

type Direction = 1 | -1;

/** Hold time before a held key starts repeating (s) */
const REPEAT_DELAY = 0.3;
/** Time between repeats of a held key (s) */
const REPEAT_INTERVAL = 0.08;

/** Number of repeats a key held for `time` seconds has produced */
function repeats(time: number): number {
	return (time < REPEAT_DELAY ? 0 : Math.floor((time - REPEAT_DELAY) / REPEAT_INTERVAL) + 1);
}

/**
 * Turns key presses into steps: one per press, then repeating while held.
 * Timed by the simulation, so it does not depend on the OS key repeat settings.
 */
export class KeyRepeat {
	/** Direction → how long it has been held (s) */
	private readonly held = new Map<Direction, number>();
	private pending = 0;

	press(direction: Direction): void {
		if (this.held.has(direction)) { return; }
		this.held.set(direction, 0);
		this.pending += direction;
	}

	release(direction: Direction): void {
		this.held.delete(direction);
	}

	releaseAll(): void {
		this.held.clear();
	}

	/** @returns Net steps (positive = up) since the previous call */
	update(dt: number): number {
		for (const [direction, time] of this.held) {
			this.pending += direction * (repeats(time + dt) - repeats(time));
			this.held.set(direction, time + dt);
		}

		const steps = this.pending;
		this.pending = 0;
		return steps;
	}
}

/**
 * Mouse position over the given element steers, mouse button fires,
 * W/S change the target speed by SPEED_STEP per press (repeating while held).
 */
export class PlayerPilot implements Pilot, EventListenerObject {
	private firing = false;
	private yaw = 0;
	private pitch = 0;
	private readonly throttle = new KeyRepeat();

	constructor(node: HTMLElement) {
		node.addEventListener("mousemove", this);
		node.addEventListener("mousedown", this);

		window.addEventListener("mouseup", this);
		window.addEventListener("keydown", this);
		window.addEventListener("keyup", this);
		window.addEventListener("blur", this);
	}

	update(dt: number, ship: Ship): void {
		const { speed, yaw, pitch } = ship.engine;
		const target = speed.target + this.throttle.update(dt) * SPEED_STEP;
		speed.target = Math.min(speed.limit, Math.max(0, target));

		yaw.control = this.yaw;
		pitch.control = this.pitch;
		ship.trigger = this.firing;
	}

	handleEvent(e: Event): void {
		switch (e.type) {
			case "mousemove": {
				const { clientX, clientY, currentTarget } = e as MouseEvent;
				const box = (currentTarget as HTMLElement).getBoundingClientRect();
				const x = (clientX - box.left) / box.width;
				const y = (clientY - box.top) / box.height;

				this.yaw = -(x * 2 - 1);
				this.pitch = -(y * 2 - 1);
			} break;

			case "mousedown":
				this.firing = true;
			break;

			case "mouseup":
				this.firing = false;
			break;

			case "keydown": {
				const { code, repeat, metaKey, ctrlKey, altKey } = e as KeyboardEvent;
				const direction = SPEED_KEYS[code];
				/* OS key repeat is ignored (KeyRepeat does its own); modifiers mean a browser shortcut */
				if (direction && !repeat && !metaKey && !ctrlKey && !altKey) { this.throttle.press(direction); }
			} break;

			case "keyup": {
				const direction = SPEED_KEYS[(e as KeyboardEvent).code];
				if (direction) { this.throttle.release(direction); }
			} break;

			case "blur": /* keyup and mouseup are not delivered while the window is in the background */
				this.throttle.releaseAll();
				this.firing = false;
			break;
		}
	}
}
