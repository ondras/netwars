import type { Ship } from "./entity/ship.ts";
import type { World } from "./world.ts";

/** Controls a ship by setting its engine controls and trigger */
export interface Pilot {
	update(dt: number, ship: Ship, world: World): void;
}

/** Target speed change per key press (m/s) */
export const SPEED_STEP = 1;

/** Physical keys (KeyboardEvent.code), so they work with any keyboard layout */
const SPEED_KEYS: Record<string, Direction> = {
	KeyW: 1,
	KeyS: -1,
};

/** Launch a rocket at the locked target */
const LAUNCH_KEYS = new Set(["Enter", "NumpadEnter", "Space"]);

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

	/** Forget held keys and steps not yet collected */
	reset(): void {
		this.held.clear();
		this.pending = 0;
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

/** Hands off: slows down to a stop and turns slowly, like the view behind the main menu */
export class IdlePilot implements Pilot {
	/** rad/s */
	private readonly turnRate: number;

	constructor(turnRate: number) {
		this.turnRate = turnRate;
	}

	update(_dt: number, ship: Ship): void {
		const { speed, yaw, pitch } = ship.engine;
		speed.target = 0;
		yaw.control = Math.min(1, this.turnRate / yaw.changeRate);
		pitch.control = 0;
		ship.trigger = false;
	}
}

/**
 * Mouse position over the given element steers, mouse button fires,
 * W/S change the target speed by SPEED_STEP per press (repeating while held), Enter or Space launches a rocket.
 */
export class PlayerPilot implements Pilot, EventListenerObject {
	private firing = false;
	/** A rocket launch key was pressed since the last update */
	private launching = false;
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

	/** Drop input collected outside play (e.g. keys pressed in the menu) */
	reset(): void {
		this.throttle.reset();
		this.firing = false;
		this.launching = false;
	}

	update(dt: number, ship: Ship): void {
		const { speed, yaw, pitch } = ship.engine;
		const target = speed.target + this.throttle.update(dt) * SPEED_STEP;
		speed.target = Math.min(speed.limit, Math.max(-speed.limit, target));

		yaw.control = this.yaw;
		pitch.control = this.pitch;
		ship.trigger = this.firing;
		if (this.launching) { ship.launch = true; }
		this.launching = false;
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
				/* keys for the menu's fields and buttons (typing a name, pressing Enter on a button) are not for flying */
				if (e.target instanceof Element && e.target.closest("input, textarea, select, button")) { break; }
				const { code, repeat, metaKey, ctrlKey, altKey } = e as KeyboardEvent;
				/* OS key repeat is ignored (KeyRepeat does its own); modifiers mean a browser shortcut */
				if (repeat || metaKey || ctrlKey || altKey) { break; }

				const direction = SPEED_KEYS[code];
				if (direction) { this.throttle.press(direction); }
				if (LAUNCH_KEYS.has(code)) { this.launching = true; }
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
