import jsfxr, { type SfxrParams } from "jsfxr";
import type { SoundDefinition, Steps, Tremolo } from "./sounds.ts";

const { Params, SoundEffect } = jsfxr;

/** Samples per second of every rendered sound */
export const SAMPLE_RATE = 44100;

/* sfxr counts a wave period in 8× oversampled samples: period = 100 / (p_base_freq² + 0.001), so Hz = 8 × 44100 / period */
export const sfxrHz = (baseFreq: number) => 3528 * (baseFreq * baseFreq + 0.001);
export const sfxrBaseFreq = (hz: number) => Math.sqrt(Math.max(0, hz / 3528 - 0.001));

/** Length of the fade from one pitch step to the next (samples) */
const STEP_CROSSFADE = 32;

export function renderJsfxr(params: Partial<SfxrParams>): Float32Array<ArrayBuffer> {
	const full = Object.assign(new Params(), params, { sample_rate: SAMPLE_RATE });
	return Float32Array.from(new SoundEffect(full).getRawBuffer().normalized);
}

/**
 * How many samples to skip into `next` so that at `at` it continues `prev` (itself read `prevSkip` ahead) in phase:
 * best match of value and slope over a few samples
 */
function alignedSkip(prev: Float32Array, prevSkip: number, next: Float32Array, at: number, maxSkip: number): number {
	let best = 0;
	let bestCost = Infinity;
	for (let skip = 0; skip <= maxSkip; skip++) {
		let cost = 0;
		for (let j = -4; j <= 4; j++) {
			const difference = (prev[at + prevSkip + j] ?? 0) - (next[at + skip + j] ?? 0);
			cost += difference * difference;
		}
		if (cost < bestCost) {
			bestCost = cost;
			best = skip;
		}
	}
	return best;
}

/**
 * A pitch staircase from one jsfxr render per step, switching to the next render at each step.
 * Each render is read from an offset (under one wave period) that continues the previous one in phase;
 * otherwise the two waves partly cancel at the switch, which clicks.
 */
export function renderSteps(params: Partial<SfxrParams>, { first, every, hz }: Steps): Float32Array<ArrayBuffer> {
	const base = sfxrHz(params.p_base_freq ?? new Params().p_base_freq);
	const notes = [renderJsfxr(params)];
	const skips = [0];
	const switches: number[] = [];
	const length = notes[0].length;

	for (let at = first; at * SAMPLE_RATE < length; at += every) {
		const index = Math.round(at * SAMPLE_RATE);
		const stepHz = base + hz * (switches.length + 1);
		const note = renderJsfxr({ ...params, p_base_freq: sfxrBaseFreq(stepHz) });
		skips.push(alignedSkip(notes[notes.length - 1], skips[skips.length - 1], note, index, Math.ceil(SAMPLE_RATE / stepHz)));
		switches.push(index);
		notes.push(note);
	}

	const out = new Float32Array(length);
	let step = 0;
	for (let i = 0; i < length; i++) {
		while (step < switches.length && i >= switches[step]) { step++; }
		const current = notes[step][i + skips[step]] ?? 0;
		const since = (step ? i - switches[step - 1] : Infinity);
		if (since < STEP_CROSSFADE) {
			const mix = since / STEP_CROSSFADE;
			out[i] = (notes[step - 1][i + skips[step - 1]] ?? 0) * (1 - mix) + current * mix;
		} else {
			out[i] = current;
		}
	}
	return out;
}

export function applyTremolo(samples: Float32Array, { depth, period }: Tremolo): void {
	const length = period * SAMPLE_RATE;
	for (let i = 0; i < samples.length; i++) {
		samples[i] *= 1 - depth + depth * Math.sin(2 * Math.PI * i / length);
	}
}

/** Mix copies starting at the given times (s); each copy is rendered anew */
export function repeatAt(render: () => Float32Array, times: readonly number[]): Float32Array<ArrayBuffer> {
	const parts = times.map(render);
	const starts = times.map(time => Math.round(time * SAMPLE_RATE));
	const out = new Float32Array(Math.max(...parts.map((part, i) => starts[i] + part.length)));
	parts.forEach((part, i) => {
		for (let j = 0; j < part.length; j++) { out[starts[i] + j] += part[j]; }
	});
	return out;
}

export function peak(samples: Float32Array): number {
	let max = 0;
	for (const sample of samples) { max = Math.max(max, Math.abs(sample)); }
	return max;
}

export function renderSound({ params, steps, tremolo, pattern = [0], level }: SoundDefinition): Float32Array<ArrayBuffer> {
	const once = () => {
		const samples = (steps ? renderSteps(params, steps) : renderJsfxr(params));
		if (tremolo) { applyTremolo(samples, tremolo); }
		return samples;
	};

	const samples = repeatAt(once, pattern);
	const max = peak(samples);
	if (max > 0) {
		for (let i = 0; i < samples.length; i++) { samples[i] *= level / max; }
	}
	return samples;
}
