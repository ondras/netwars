import { mat4, quat, vec3 } from "gl-matrix";
import { Camera } from "./camera.ts";
import { PlayerShip } from "./entity/player-ship.ts";
import { lookName, lookOf, lookParts, PLAYER_SHIPS, shipGeometries } from "./entity/player-ships.ts";
import { shipIcon } from "./render/ship-icon.ts";
import { WebGLRenderer } from "./render/webgl.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How far the preview camera is from the ship (m): the ship's bounding sphere just fills the view */
const PREVIEW_DISTANCE = 2.2;
/** Three quarters from the front, a little from above (rad) */
const START_YAW = 3.85;
const START_PITCH = 0.45;
const SPIN = 0.4;
const DRAG_TURN = 0.012;
const MAX_PITCH = 1.4;
const ICON_SIZE = 44;

/** The panel for picking your ship and its colours, with the ship turning in a preview (markup in index.html) */
export class Hangar {
	/** A new ship or colours were picked */
	onChange: ((look: number) => void) | null = null;

	private readonly panel = element<HTMLElement>("hangar");
	private readonly view = element<HTMLElement>("hangar-view");
	private readonly skinButtons = element<HTMLElement>("hangar-skins");
	private readonly shipButtons: HTMLButtonElement[];
	private readonly camera = new Camera();
	/** Created on first use: a second WebGL context, needed only here */
	private renderer: WebGLRenderer | null = null;
	private preview: PlayerShip | null = null;
	private look = 0;
	private back: (() => void) | null = null;
	private yaw = START_YAW;
	private pitch = START_PITCH;
	private dragging = false;
	private lastFrame = 0;
	private readonly still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	constructor() {
		this.shipButtons = PLAYER_SHIPS.map((design, ship) => {
			const button = this.pickButton(lookOf(ship, 0), design.name);
			button.setAttribute("aria-label", `${design.name}, inspired by: ${design.kind}`);
			button.onclick = () => {
				const { skin } = lookParts(this.look);
				this.pick(lookOf(ship, skin));
			};
			return button;
		});
		element<HTMLElement>("hangar-ships").replaceChildren(...this.shipButtons);
		element<HTMLButtonElement>("hangar-back").onclick = () => this.close();

		let last: [number, number] | null = null;
		this.view.addEventListener("pointerdown", event => {
			this.view.setPointerCapture(event.pointerId);
			this.dragging = true;
			last = [event.clientX, event.clientY];
		});
		this.view.addEventListener("pointermove", event => {
			if (!this.dragging || !last) { return; }
			this.yaw += (event.clientX - last[0]) * DRAG_TURN;
			this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + (event.clientY - last[1]) * DRAG_TURN));
			last = [event.clientX, event.clientY];
		});
		const stop = () => { this.dragging = false; };
		this.view.addEventListener("pointerup", stop);
		this.view.addEventListener("pointercancel", stop);
	}

	get visible(): boolean {
		return !this.panel.hidden;
	}

	/** @param back What comes back when this closes */
	open(look: number, back: () => void): void {
		this.back = back;
		this.panel.hidden = false;
		this.panel.scrollTop = 0;
		this.show(look);
		this.shipButtons[lookParts(look).ship].focus();

		if (!this.renderer) {
			this.renderer = new WebGLRenderer(this.camera);
			this.view.append(this.renderer.node);
			mat4.fromTranslation(this.camera.vMatrix, vec3.fromValues(0, 0, -PREVIEW_DISTANCE));
		}
		this.lastFrame = performance.now();
		requestAnimationFrame(now => this.frame(now));
	}

	/** Back to where it was opened from */
	close(): void {
		const back = this.back;
		this.hide();
		back?.();
	}

	/** Without going back: something else takes over the screen */
	hide(): void {
		this.panel.hidden = true;
		this.back = null;
	}

	private pick(look: number): void {
		this.show(look);
		this.onChange?.(look);
	}

	private show(look: number): void {
		this.look = look;
		const { ship, skin } = lookParts(look);
		const design = PLAYER_SHIPS[ship];

		element<HTMLElement>("hangar-name").textContent = `${lookName(look)} (${design.kind.toLowerCase()})`;
		this.view.setAttribute("aria-label", lookName(look));
		this.shipButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i == ship)));

		this.skinButtons.replaceChildren(...design.skins.map(({ name }, i) => {
			const button = this.pickButton(lookOf(ship, i), name);
			button.setAttribute("aria-pressed", String(i == skin));
			button.onclick = () => {
				this.pick(lookOf(ship, i));
				(this.skinButtons.children[i] as HTMLElement).focus(); /* the buttons were made anew */
			};
			return button;
		}));

		if (this.preview) { this.renderer?.deletePrivateData(this.preview); }
		this.preview = new PlayerShip(look);
	}

	/** A button with a picture of the look and a name under it */
	private pickButton(look: number, name: string): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.innerHTML = shipIcon(shipGeometries(look), ICON_SIZE);
		button.append(name);
		return button;
	}

	private frame(now: number): void {
		if (!this.visible || !this.renderer || !this.preview) { return; }
		if (!this.dragging && !this.still) { this.yaw += SPIN * (now - this.lastFrame) / 1000; }
		this.lastFrame = now;

		const { orientation } = this.preview;
		quat.identity(orientation);
		quat.rotateX(orientation, orientation, this.pitch);
		quat.rotateY(orientation, orientation, this.yaw);
		this.renderer.render([this.preview]);
		requestAnimationFrame(next => this.frame(next));
	}
}
