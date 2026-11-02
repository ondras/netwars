import type { Entity } from "./entity/entity.ts";
import type { Ship } from "./entity/ship.ts";

/** Controls a ship */
export interface Pilot {
	/** @returns New entities to be added to the scene (e.g. shots) */
	update(dt: number, ship: Ship): Entity[] | undefined;
}

/**
 * Mouse position over the given element steers, mouse button fires,
 * Shift/Ctrl presses (including key repeat) adjust the throttle.
 */
export class PlayerPilot implements Pilot, EventListenerObject {
	private firing = false;
	private speed = 0;
	private yaw = 0;
	private pitch = 0;

	constructor(node: HTMLElement) {
		node.addEventListener("mousemove", this);
		node.addEventListener("mousedown", this);

		window.addEventListener("mouseup", this);
		window.addEventListener("keydown", this);
	}

	update(_dt: number, ship: Ship): Entity[] | undefined {
		ship.engine.speed.control = this.speed;
		ship.engine.yaw.control = this.yaw;
		ship.engine.pitch.control = this.pitch;

		return this.firing ? ship.fire() : undefined;
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

			case "keydown":
				switch ((e as KeyboardEvent).key) {
					case "Shift": this.speed += 0.2; break;
					case "Control": this.speed -= 0.2; break;
				}
			break;
		}
	}
}
