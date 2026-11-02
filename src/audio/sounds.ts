import type { SfxrParams } from "jsfxr";

export type SoundName = "cannon" | "hit" | "launch" | "warning" | "impact" | "explosion" | "powerup" | "grabbed";

/** A pitch staircase: up by `hz` at `first` (s), then again every `every` (s). jsfxr itself steps the pitch only once per sound */
export interface Steps {
	readonly first: number;
	readonly every: number;
	readonly hz: number;
}

/** Volume pulsing between 1 - 2 × depth and 1, once per period (s), the way ZzFX's tremolo works; jsfxr has none */
export interface Tremolo {
	readonly depth: number;
	readonly period: number;
}

export interface SoundDefinition {
	/** jsfxr parameters; missing ones take the sfxr defaults */
	readonly params: Partial<SfxrParams>;
	/** Peak level, 0..1: every sound is normalised to its level, so the levels set the mix */
	readonly level: number;
	/** Renders to pick from at random; noise comes out a little different every time */
	readonly variants?: number;
	readonly steps?: Steps;
	readonly tremolo?: Tremolo;
	/** Start times (s) of the copies when the sound repeats itself, like a double beep */
	readonly pattern?: readonly number[];
}

/**
 * Picked by ear on the sound board artifact, which compares ZzFX and jsfxr versions.
 * Where the ZzFX version won (warning, powerup, pod grabbed), these are jsfxr ports of it.
 */
export const SOUNDS: Record<SoundName, SoundDefinition> = {
	/** The player's or a hunter's gun fires */
	cannon: {
		level: 0.45,
		params: { p_env_sustain: 0.2653, p_env_punch: 0.1727, p_env_decay: 0.2376, p_base_freq: 0.546, p_freq_limit: 0.2, p_freq_ramp: -0.2769, p_duty: 0.6548, p_duty_ramp: -0.0752, p_pha_offset: 0.0133, p_pha_ramp: -0.1198, p_hpf_freq: 0.143 },
	},

	/** A gun shot hits a ship that survives it: a short, bright 3.3 kHz tick ("J3" on the hit sounds page) */
	hit: {
		level: 0.55,
		params: { wave_type: 2, p_base_freq: 0.9656, p_env_sustain: 0.01, p_env_decay: 0.15, p_env_punch: 0.4 },
	},

	/** A pirate fires a missile */
	launch: {
		level: 0.7,
		variants: 2,
		params: { wave_type: 3, p_env_attack: 0.2957, p_env_sustain: 0.4074, p_env_punch: 0.4096, p_env_decay: 0.6274, p_base_freq: 0.149, p_freq_ramp: 0.4198, p_freq_dramp: 0.0067, p_vib_strength: 0.132, p_vib_speed: 0.251, p_arp_mod: 0.0848, p_arp_speed: 0.1782, p_duty: 0.1762, p_duty_ramp: 0.132, p_pha_offset: -0.0479, p_pha_ramp: -0.0781, p_lpf_freq: 0.5207, p_lpf_ramp: 0.3549, p_lpf_resonance: 0.2336, p_hpf_freq: 0.1467, p_hpf_ramp: 0.2132 },
	},

	/** A missile has been fired at the player: rising chirps, about 3.5 of them */
	warning: {
		level: 0.5,
		params: { p_base_freq: 0.4692, p_freq_ramp: 0.2226, p_repeat_speed: 0.5359, p_env_sustain: 0.3637, p_env_decay: 0.1602, p_lpf_freq: 0.6047 },
		tremolo: { depth: 0.537, period: 0.0984 }, /* one pulse per chirp: p_repeat_speed repeats every 0.0984 s */
	},

	/** A missile hits a ship that survives it */
	impact: {
		level: 0.9,
		variants: 3,
		params: { wave_type: 3, p_env_attack: 0.0507, p_env_sustain: 0.3155, p_env_punch: 0.4947, p_env_decay: 0.321, p_base_freq: 0.0552, p_freq_ramp: -0.0455, p_freq_dramp: 0.1567, p_vib_strength: 0.2311, p_vib_speed: 0.074, p_arp_mod: 0.3212, p_arp_speed: 0.1546, p_duty: 0.4775, p_duty_ramp: -0.3477, p_repeat_speed: 0.1242, p_pha_offset: -0.1339, p_pha_ramp: -0.1426, p_lpf_freq: 0.5269, p_lpf_ramp: -0.0514, p_lpf_resonance: 0.3393, p_hpf_freq: 0.3239, p_hpf_ramp: -0.2273 },
	},

	/** Anything is destroyed: ships, pods, missiles shot down */
	explosion: {
		level: 1,
		variants: 3,
		params: { wave_type: 3, p_env_sustain: 0.1623, p_env_punch: 0.2539, p_env_decay: 0.4831, p_base_freq: 0.0859, p_freq_ramp: -0.2269, p_vib_strength: 0.5825, p_vib_speed: 0.0014, p_arp_mod: 0.525, p_arp_speed: 0.8461, p_repeat_speed: 0.7211, p_pha_offset: -0.2024, p_pha_ramp: -0.2742 },
	},

	/** The player collects a powerup: a triangle wave stepping up from 482 Hz to 1378 Hz */
	powerup: {
		level: 0.6,
		params: { wave_type: 1, p_env_attack: 0.01, p_base_freq: 0.3683, p_env_sustain: 0.2623, p_env_decay: 0.2385 },
		steps: { first: 0.0341, every: 0.0585, hz: 224 },
	},

	/** A pirate grabs a pod: a double beep */
	grabbed: {
		level: 0.6,
		params: { p_base_freq: 0.5896, p_arp_mod: -0.07, p_arp_speed: 0.7886, p_duty: 0.309, p_env_sustain: 0.2449, p_env_decay: 0.1485, p_lpf_freq: 0.3 },
		pattern: [0, 0.26],
	},
};
