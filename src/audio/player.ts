import { quat, vec3, type ReadonlyQuat, type ReadonlyVec3 } from "gl-matrix";
import { HEARING_REACH, senseFade } from "../senses.ts";
import { SOUNDS, type SoundName } from "./sounds.ts";
import { renderSound, SAMPLE_RATE } from "./synth.ts";

/** Master gain at 100 % effects volume */
const FULL_VOLUME = 0.6;
/** Sounds within this distance play at full volume (m); farther away, volume falls as 1 / distance */
const NEAR = 20;
/** Sounds quieter than this are skipped */
const MIN_GAIN = 0.03;
/** Pan of a sound straight to the side (1 would be one speaker only) */
const PAN_WIDTH = 0.7;

export interface Listener {
	readonly position: ReadonlyVec3;
	readonly orientation: ReadonlyQuat;
}

export interface Placement {
	gain: number;
	/** -1 left .. 1 right */
	pan: number;
}

/**
 * How loud and from which side the listener hears a sound made at `at` (without `at`: at the listener)
 * @param limited In a deathmatch: nothing is heard from farther than HEARING_REACH, fading out before
 */
export function placeSound(listener: Listener | null, at?: ReadonlyVec3, limited = false): Placement {
	if (!listener || !at) { return { gain: 1, pan: 0 }; }

	const local = vec3.subtract(vec3.create(), at, listener.position);
	vec3.transformQuat(local, local, quat.conjugate(quat.create(), listener.orientation));
	const distance = vec3.length(local);
	if (distance < 1e-6) { return { gain: 1, pan: 0 }; }

	const reach = (limited ? senseFade(distance, HEARING_REACH) : 1);
	return { gain: Math.min(1, NEAR / distance) * reach, pan: PAN_WIDTH * local[0] / distance }; /* local +X is right */
}

interface Output {
	context: AudioContext;
	/** Every sound goes through this; it sets the volume */
	destination: GainNode;
	buffers: Map<SoundName, AudioBuffer[]>;
}

/** Synthesizes the game's sounds up front and plays them through Web Audio once unlock() has run */
export class SoundPlayer {
	/** Sounds are heard from here */
	listener: Listener | null = null;
	/** In a deathmatch: nothing is heard from farther than HEARING_REACH */
	limitedHearing = false;

	private readonly samples = new Map<SoundName, Float32Array<ArrayBuffer>[]>();
	private output: Output | null = null;
	/** 0..1 */
	private volume: number;

	constructor(volume = 1) {
		this.volume = volume;
		for (const [name, definition] of Object.entries(SOUNDS) as [SoundName, (typeof SOUNDS)[SoundName]][]) {
			this.samples.set(name, Array.from({ length: definition.variants ?? 1 }, () => renderSound(definition)));
		}
	}

	/** 0..1 */
	setVolume(volume: number): void {
		this.volume = volume;
		if (this.output) { this.output.destination.gain.value = FULL_VOLUME * volume; }
	}

	/** Start the audio output; browsers allow that only while handling a click or a key press */
	unlock(): void {
		if (typeof AudioContext == "undefined") { return; }

		if (!this.output) {
			const context = new AudioContext();
			const limiter = new DynamicsCompressorNode(context, { threshold: -10, knee: 6, ratio: 8, attack: 0.002, release: 0.15 });
			const volume = new GainNode(context, { gain: FULL_VOLUME * this.volume });
			volume.connect(limiter).connect(context.destination);

			const buffers = new Map<SoundName, AudioBuffer[]>();
			for (const [name, variants] of this.samples) {
				buffers.set(name, variants.map(samples => {
					const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
					buffer.copyToChannel(samples, 0);
					return buffer;
				}));
			}

			this.output = { context, destination: volume, buffers };
		}

		if (this.output.context.state == "suspended") { void this.output.context.resume(); }
	}

	play(name: SoundName, at?: ReadonlyVec3): void {
		const output = this.output;
		if (!output || output.context.state != "running") { return; }

		const { gain, pan } = placeSound(this.listener, at, this.limitedHearing);
		if (gain < MIN_GAIN) { return; }

		const { context } = output;
		const variants = output.buffers.get(name) ?? [];
		const buffer = variants[Math.floor(Math.random() * variants.length)];
		if (!buffer) { return; }

		const source = new AudioBufferSourceNode(context, { buffer });
		source
			.connect(new GainNode(context, { gain }))
			.connect(new StereoPannerNode(context, { pan }))
			.connect(output.destination);
		source.start();
	}
}
