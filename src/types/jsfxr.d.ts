/** The parts of jsfxr 1.4 this game uses; the package ships no types */
declare module "jsfxr" {
	/** sfxr synthesis parameters: 0..1, or -1..1 for the slides, sweeps and offsets */
	export interface SfxrParams {
		/** 0 square, 1 sawtooth (a triangle when p_duty is 0), 2 sine, 3 noise */
		wave_type: number;
		p_env_attack: number;
		p_env_sustain: number;
		p_env_punch: number;
		p_env_decay: number;
		p_base_freq: number;
		p_freq_limit: number;
		p_freq_ramp: number;
		p_freq_dramp: number;
		p_vib_strength: number;
		p_vib_speed: number;
		p_arp_mod: number;
		p_arp_speed: number;
		p_duty: number;
		p_duty_ramp: number;
		p_repeat_speed: number;
		p_pha_offset: number;
		p_pha_ramp: number;
		p_lpf_freq: number;
		p_lpf_ramp: number;
		p_lpf_resonance: number;
		p_hpf_freq: number;
		p_hpf_ramp: number;
		sound_vol: number;
		sample_rate: number;
		sample_size: number;
	}

	interface Jsfxr {
		/** Parameters at the sfxr defaults */
		Params: new () => SfxrParams;
		SoundEffect: new (params: SfxrParams) => {
			/** `normalized`: the samples, -1..1, at `sample_rate` */
			getRawBuffer(): { normalized: number[] };
		};
	}

	const jsfxr: Jsfxr;
	export default jsfxr;
}
