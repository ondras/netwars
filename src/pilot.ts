import type { Ship } from "./entity/ship.ts";

/** Controls a ship by setting its engine controls and trigger */
export interface Pilot {
	update(dt: number, ship: Ship): void;
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

	update(_dt: number, ship: Ship): void {
		ship.engine.speed.control = this.speed;
		ship.engine.yaw.control = this.yaw;
		ship.engine.pitch.control = this.pitch;
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

			case "keydown":
				switch ((e as KeyboardEvent).key) {
					case "Shift": this.speed += 0.2; break;
					case "Control": this.speed -= 0.2; break;
				}
			break;
		}
	}
}
