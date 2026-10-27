import type { EffectType } from './types';

// Single source of truth for what instruments and effects exist.
// The engine implements them, the UI lists them, and the agent reads these
// descriptions in its system prompt - so write them for a producer.

export interface PresetInfo {
  id: string;
  name: string;
  family: 'keys' | 'guitar' | 'bass' | 'synth' | 'pad' | 'orchestral' | 'mallet' | 'lead';
  description: string;
  /** Comfortable MIDI range for writing parts. */
  range: [number, number];
  /** Tunable params with defaults, exposed to the agent and the inspector. */
  params: Record<string, { default: number; min: number; max: number; label: string }>;
  /** Uses streamed multisamples (needs network on first load). */
  sampled?: boolean;
}

const ENV = {
  attack: { default: 0.005, min: 0, max: 4, label: 'Attack (s)' },
  release: { default: 0.6, min: 0.01, max: 8, label: 'Release (s)' },
};

export const PRESETS: PresetInfo[] = [
  {
    id: 'piano', name: 'Grand Piano', family: 'keys', sampled: true, range: [36, 96],
    description: 'Sampled concert grand. Sad chords, lo-fi keys, ballads.',
    params: { release: { default: 1.2, min: 0.1, max: 6, label: 'Release (s)' }, brightness: { default: 1, min: 0, max: 1, label: 'Brightness' } },
  },
  {
    id: 'epiano', name: 'Electric Piano', family: 'keys', range: [40, 88],
    description: 'Warm FM Rhodes-style electric piano. R&B, neo-soul, lo-fi, pluggnb.',
    params: { ...ENV, release: { default: 1.0, min: 0.05, max: 6, label: 'Release (s)' }, tine: { default: 0.5, min: 0, max: 1, label: 'Tine bite' } },
  },
  {
    id: 'acoustic_guitar', name: 'Acoustic Guitar', family: 'guitar', sampled: true, range: [40, 81],
    description: 'Sampled steel-string acoustic. Emo rap, Lil Peep / Juice WRLD style plucked or strummed loops.',
    params: { release: { default: 1.2, min: 0.1, max: 5, label: 'Release (s)' } },
  },
  {
    id: 'electric_guitar', name: 'Clean Electric Guitar', family: 'guitar', sampled: true, range: [40, 84],
    description: 'Sampled clean electric guitar. Emo/midwest arpeggios, pop-punk-trap, R&B licks. Pair with chorus + reverb.',
    params: { release: { default: 1.0, min: 0.1, max: 5, label: 'Release (s)' } },
  },
  {
    id: 'nylon_guitar', name: 'Nylon Guitar', family: 'guitar', sampled: true, range: [40, 84],
    description: 'Sampled nylon-string classical guitar. Latin trap, sad melodic rap, Spanish-style melodies.',
    params: { release: { default: 1.2, min: 0.1, max: 5, label: 'Release (s)' } },
  },
  {
    id: 'pluck_guitar', name: 'Synth Pluck Guitar', family: 'guitar', range: [40, 84],
    description: 'Karplus-Strong plucked string. Works offline, lo-fi and intimate.',
    params: { dampening: { default: 3500, min: 500, max: 9000, label: 'Dampening (Hz)' }, resonance: { default: 0.92, min: 0.5, max: 0.99, label: 'Sustain' } },
  },
  {
    id: 'bass808', name: '808', family: 'bass', range: [24, 48],
    description: 'Tuned 808 bass: sine body, pitch punch, long decay, optional saturation and glide (slides between overlapping notes). Write mono bass lines in octave 1 (C1=24).',
    params: {
      decay: { default: 1.6, min: 0.2, max: 5, label: 'Decay (s)' },
      punch: { default: 0.6, min: 0, max: 1, label: 'Punch' },
      drive: { default: 0.35, min: 0, max: 1, label: 'Distortion' },
      glide: { default: 0.06, min: 0, max: 0.4, label: 'Glide (s)' },
    },
  },
  {
    id: 'sub_bass', name: 'Sub Bass', family: 'bass', range: [24, 52],
    description: 'Clean sine sub. Sits under kicks without clutter. House, R&B, ambient.',
    params: { ...ENV, release: { default: 0.2, min: 0.01, max: 3, label: 'Release (s)' } },
  },
  {
    id: 'electric_bass', name: 'Electric Bass', family: 'bass', sampled: true, range: [28, 60],
    description: 'Sampled fingered electric bass. Funk, R&B, indie, boom bap.',
    params: { release: { default: 0.4, min: 0.05, max: 3, label: 'Release (s)' } },
  },
  {
    id: 'reese', name: 'Reese Bass', family: 'bass', range: [24, 55],
    description: 'Detuned sawtooth bass, filtered and wide. DnB, dark trap, UK.',
    params: { cutoff: { default: 900, min: 100, max: 8000, label: 'Cutoff (Hz)' }, detune: { default: 18, min: 0, max: 50, label: 'Detune (cents)' } },
  },
  {
    id: 'pad', name: 'Warm Pad', family: 'pad', range: [48, 84],
    description: 'Lush detuned analog pad with slow attack. Atmosphere, cloud rap, ambient beds.',
    params: { ...ENV, attack: { default: 0.6, min: 0, max: 4, label: 'Attack (s)' }, release: { default: 2.5, min: 0.1, max: 8, label: 'Release (s)' }, cutoff: { default: 2200, min: 200, max: 10000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'dark_pad', name: 'Dark Pad', family: 'pad', range: [36, 80],
    description: 'Low, filtered, slowly moving pad. Haunting, eerie, drill and dark trap intros.',
    params: { ...ENV, attack: { default: 1.2, min: 0, max: 4, label: 'Attack (s)' }, release: { default: 3, min: 0.1, max: 8, label: 'Release (s)' }, cutoff: { default: 900, min: 100, max: 6000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'strings', name: 'Synth Strings', family: 'orchestral', range: [40, 88],
    description: 'Ensemble synth strings. Cinematic trap, drill, emotional builds.',
    params: { ...ENV, attack: { default: 0.25, min: 0, max: 3, label: 'Attack (s)' }, release: { default: 1.2, min: 0.1, max: 6, label: 'Release (s)' } },
  },
  {
    id: 'cello', name: 'Cello', family: 'orchestral', sampled: true, range: [36, 72],
    description: 'Sampled solo cello. Dark drill, cinematic, sad melodies.',
    params: { release: { default: 0.8, min: 0.05, max: 4, label: 'Release (s)' } },
  },
  {
    id: 'violin', name: 'Violin', family: 'orchestral', sampled: true, range: [55, 96],
    description: 'Sampled solo violin. Drill melodies, dramatic hooks.',
    params: { release: { default: 0.8, min: 0.05, max: 4, label: 'Release (s)' } },
  },
  {
    id: 'flute', name: 'Flute', family: 'orchestral', sampled: true, range: [60, 96],
    description: 'Sampled flute. Trap flute melodies (Future / Metro style), airy toplines.',
    params: { release: { default: 0.5, min: 0.05, max: 4, label: 'Release (s)' } },
  },
  {
    id: 'harp', name: 'Harp', family: 'orchestral', sampled: true, range: [36, 96],
    description: 'Sampled concert harp. Arpeggios, dreamy and fairy-tale textures.',
    params: { release: { default: 1.5, min: 0.1, max: 6, label: 'Release (s)' } },
  },
  {
    id: 'bell', name: 'Bell', family: 'mallet', range: [60, 100],
    description: 'Glassy FM bell. Trap bell melodies, plugg, music-box vibes.',
    params: { release: { default: 1.6, min: 0.1, max: 6, label: 'Release (s)' }, harmonicity: { default: 3.01, min: 1, max: 8, label: 'Harmonicity' } },
  },
  {
    id: 'music_box', name: 'Music Box', family: 'mallet', range: [72, 108],
    description: 'Tiny, sparkly music box. Nostalgic emo/plugg toplines, play an octave high.',
    params: { release: { default: 1.4, min: 0.1, max: 5, label: 'Release (s)' } },
  },
  {
    id: 'xylophone', name: 'Xylophone', family: 'mallet', sampled: true, range: [67, 108],
    description: 'Sampled xylophone. Playful, bouncy hooks.',
    params: { release: { default: 0.8, min: 0.05, max: 3, label: 'Release (s)' } },
  },
  {
    id: 'pluck', name: 'Synth Pluck', family: 'synth', range: [48, 96],
    description: 'Short, bright filtered pluck. Pluggnb, melodic trap, house stabs.',
    params: { decay: { default: 0.35, min: 0.05, max: 2, label: 'Decay (s)' }, cutoff: { default: 3500, min: 300, max: 12000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'lead', name: 'Saw Lead', family: 'lead', range: [55, 96],
    description: 'Mono sawtooth lead with glide. Toplines, rage, hyperpop.',
    params: { ...ENV, glide: { default: 0.03, min: 0, max: 0.3, label: 'Glide (s)' }, cutoff: { default: 4000, min: 300, max: 12000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'supersaw', name: 'Supersaw', family: 'lead', range: [48, 96],
    description: 'Huge detuned supersaw stack. Rage (Carti/Yeat), trance, hyperpop chords.',
    params: { ...ENV, detune: { default: 25, min: 0, max: 60, label: 'Detune (cents)' }, cutoff: { default: 6000, min: 300, max: 14000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'organ', name: 'Organ', family: 'keys', sampled: true, range: [36, 90],
    description: 'Sampled organ. Gospel, church-trap, dark chords.',
    params: { release: { default: 0.3, min: 0.05, max: 3, label: 'Release (s)' } },
  },
  {
    id: 'choir', name: 'Synth Choir', family: 'pad', range: [48, 84],
    description: 'Airy "aah" vowel pad. Ethereal hooks, dark trap, gothic.',
    params: { ...ENV, attack: { default: 0.4, min: 0, max: 3, label: 'Attack (s)' }, release: { default: 1.8, min: 0.1, max: 6, label: 'Release (s)' } },
  },
  {
    id: 'analog_brass', name: 'Analog Brass', family: 'synth', range: [43, 88],
    description: 'Warm polyphonic saw brass with a blooming filter envelope. Funk stabs, synthwave and cinematic chords. Works offline.',
    params: { ...ENV, cutoff: { default: 1800, min: 200, max: 10000, label: 'Cutoff (Hz)' }, resonance: { default: 1.2, min: 0.1, max: 8, label: 'Resonance' } },
  },
  {
    id: 'fm_bass', name: 'FM Bass', family: 'bass', range: [24, 60],
    description: 'Percussive FM bass with a controllable metallic bite. UK garage, funk and digital house. Works offline.',
    params: { ...ENV, release: { default: 0.15, min: 0.01, max: 3, label: 'Release (s)' }, bite: { default: 4, min: 0, max: 16, label: 'FM bite' } },
  },
  {
    id: 'marimba', name: 'Marimba', family: 'mallet', range: [48, 96],
    description: 'Round woody FM mallet. Interlocking percussion melodies, tropical hooks and minimalism. Works offline.',
    params: { release: { default: 0.8, min: 0.05, max: 4, label: 'Release (s)' }, bite: { default: 2.5, min: 0, max: 12, label: 'FM bite' } },
  },
  {
    id: 'kalimba', name: 'Kalimba', family: 'mallet', range: [55, 96],
    description: 'Bright tine pluck with a soft body. Organic arpeggios, Afrobeat and intimate melodies. Works offline.',
    params: { release: { default: 1.2, min: 0.05, max: 5, label: 'Release (s)' }, bite: { default: 5, min: 0, max: 12, label: 'FM bite' } },
  },
  {
    id: 'chiptune', name: 'Chip Keys', family: 'keys', range: [36, 96],
    description: 'Crisp square-wave keys. Retro games, playful hooks and hyperpop. Works offline.',
    params: { ...ENV, release: { default: 0.12, min: 0.01, max: 3, label: 'Release (s)' }, cutoff: { default: 7000, min: 300, max: 14000, label: 'Cutoff (Hz)' } },
  },
  {
    id: 'glass_pad', name: 'Glass Pad', family: 'pad', range: [48, 96],
    description: 'Slow AM sine pad with a crystalline shimmer. Ambient beds, sci-fi and spacious chords. Works offline.',
    params: { ...ENV, attack: { default: 0.8, min: 0.01, max: 4, label: 'Attack (s)' }, release: { default: 3, min: 0.1, max: 8, label: 'Release (s)' }, shimmer: { default: 2.01, min: 0.5, max: 6, label: 'Shimmer ratio' } },
  },
];

export const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p])) as Record<string, PresetInfo>;

export interface EffectInfo {
  type: EffectType;
  name: string;
  description: string;
  params: Record<string, { default: number | string; min?: number; max?: number; options?: string[]; label: string }>;
}

const WET = { default: 0.3, min: 0, max: 1, label: 'Mix' };

export const EFFECTS: EffectInfo[] = [
  {
    type: 'eq', name: 'EQ', description: '3-band EQ with adjustable crossover points. Cut mud (low_mid), add air (high).',
    params: {
      low: { default: 0, min: -24, max: 12, label: 'Low (dB)' },
      mid: { default: 0, min: -24, max: 12, label: 'Mid (dB)' },
      high: { default: 0, min: -24, max: 12, label: 'High (dB)' },
      lowFrequency: { default: 250, min: 40, max: 1000, label: 'Low/mid split (Hz)' },
      highFrequency: { default: 3500, min: 1000, max: 12000, label: 'Mid/high split (Hz)' },
    },
  },
  {
    type: 'parametric_eq', name: 'Parametric EQ', description: 'Four fully adjustable bell bands: frequency, gain and Q for precise cuts or boosts. Stack with a filter for high/low cuts.',
    params: Object.fromEntries([100, 400, 2000, 8000].flatMap((frequency, i) => [
      [`freq${i + 1}`, { default: frequency, min: 20, max: 20000, label: `Band ${i + 1} (Hz)` }],
      [`gain${i + 1}`, { default: 0, min: -24, max: 18, label: `Band ${i + 1} (dB)` }],
      [`q${i + 1}`, { default: 1, min: 0.1, max: 18, label: `Band ${i + 1} Q` }],
    ])),
  },
  {
    type: 'filter', name: 'Filter', description: 'Resonant filter. Lowpass for muffled/underwater intros, highpass to clear low end.',
    params: {
      mode: { default: 'lowpass', options: ['lowpass', 'highpass', 'bandpass'], label: 'Mode' },
      frequency: { default: 1200, min: 20, max: 20000, label: 'Cutoff (Hz)' },
      q: { default: 1, min: 0.1, max: 18, label: 'Resonance' },
    },
  },
  {
    type: 'compressor', name: 'Compressor', description: 'Dynamics control. Glue drums, tame peaks.',
    params: {
      threshold: { default: -18, min: -60, max: 0, label: 'Threshold (dB)' },
      ratio: { default: 4, min: 1, max: 20, label: 'Ratio' },
      attack: { default: 0.01, min: 0, max: 1, label: 'Attack (s)' },
      release: { default: 0.15, min: 0.01, max: 1, label: 'Release (s)' },
      makeup: { default: 0, min: 0, max: 24, label: 'Makeup (dB)' },
    },
  },
  {
    type: 'reverb', name: 'Reverb', description: 'Algorithmic space. Big washy reverbs are core to emo/cloud rap.',
    params: {
      decay: { default: 2.5, min: 0.2, max: 12, label: 'Decay (s)' },
      preDelay: { default: 0.02, min: 0, max: 0.2, label: 'Pre-delay (s)' },
      wet: WET,
    },
  },
  {
    type: 'delay', name: 'Delay', description: 'Tempo-synced echo. time is a note value like 8n, 8n. (dotted), 4n, 16n.',
    params: {
      time: { default: '8n.', options: ['32n', '16n', '16n.', '8t', '8n', '8n.', '4t', '4n', '4n.', '2n'], label: 'Time' },
      feedback: { default: 0.35, min: 0, max: 0.95, label: 'Feedback' },
      pingPong: { default: 1, min: 0, max: 1, label: 'Ping-pong' },
      wet: { default: 0.25, min: 0, max: 1, label: 'Mix' },
    },
  },
  {
    type: 'distortion', name: 'Distortion', description: 'Hard waveshaping. Blown-out 808s, aggressive leads.',
    params: { amount: { default: 0.4, min: 0, max: 1, label: 'Drive' }, wet: { default: 1, min: 0, max: 1, label: 'Mix' } },
  },
  {
    type: 'saturation', name: 'Saturation', description: 'Soft tape-style warmth. Thickens 808s and drums without harshness.',
    params: { drive: { default: 0.3, min: 0, max: 1, label: 'Drive' }, wet: { default: 1, min: 0, max: 1, label: 'Mix' } },
  },
  {
    type: 'bitcrusher', name: 'Bitcrusher', description: 'Bit reduction. Crunchy, digital lo-fi.',
    params: { bits: { default: 8, min: 1, max: 16, label: 'Bits' }, wet: { default: 0.5, min: 0, max: 1, label: 'Mix' } },
  },
  {
    type: 'chorus', name: 'Chorus', description: 'Thickening/wobble. Classic on clean emo guitars and e-pianos.',
    params: {
      frequency: { default: 1.5, min: 0.1, max: 8, label: 'Rate (Hz)' },
      depth: { default: 0.6, min: 0, max: 1, label: 'Depth' },
      delayTime: { default: 3.5, min: 1, max: 20, label: 'Delay (ms)' },
      wet: { default: 0.5, min: 0, max: 1, label: 'Mix' },
    },
  },
  {
    type: 'phaser', name: 'Phaser', description: 'Sweeping notches. Psychedelic movement on pads and guitars.',
    params: { frequency: { default: 0.5, min: 0.05, max: 8, label: 'Rate (Hz)' }, octaves: { default: 3, min: 1, max: 6, label: 'Range' }, wet: { default: 0.5, min: 0, max: 1, label: 'Mix' } },
  },
  {
    type: 'tremolo', name: 'Tremolo', description: 'Volume wobble.',
    params: { frequency: { default: 4, min: 0.1, max: 20, label: 'Rate (Hz)' }, depth: { default: 0.5, min: 0, max: 1, label: 'Depth' } },
  },
  {
    type: 'widener', name: 'Stereo Width', description: 'Stereo image: 0 = mono, 0.5 = unchanged, 1 = extra wide. Widen pads/guitars; keep 808/kick mono.',
    params: { width: { default: 0.7, min: 0, max: 1, label: 'Width' } },
  },
  {
    type: 'lofi', name: 'Lo-Fi', description: 'Tape wobble + band-limiting + dust. Instant vintage/lo-fi/emo texture.',
    params: {
      wow: { default: 0.35, min: 0, max: 1, label: 'Wow/flutter' },
      tone: { default: 0.45, min: 0, max: 1, label: 'Tone (dark→bright)' },
      noise: { default: 0.15, min: 0, max: 1, label: 'Vinyl noise' },
      wet: { default: 1, min: 0, max: 1, label: 'Mix' },
    },
  },
  {
    type: 'limiter', name: 'Limiter', description: 'Brickwall ceiling. Put last on the master.',
    params: { threshold: { default: -1, min: -24, max: 0, label: 'Ceiling (dB)' } },
  },
  {
    type: 'duck', name: 'Sidechain Duck', description: 'Ducks this track every time the source track hits. Classic 808/kick or pumping pads.',
    params: {
      source: { default: '', label: 'Source track id' },
      depth: { default: 0.6, min: 0, max: 1, label: 'Depth' },
      release: { default: 0.18, min: 0.02, max: 1, label: 'Release (s)' },
    },
  },
  {
    type: 'custom', name: 'Custom Effect', description: 'Your own DSP written in JavaScript, with its own knobs. Anything the built-ins cannot do: special saturators, resonators, glitches, tempo tricks.',
    params: {},
  },
];

export const EFFECT_BY_TYPE = Object.fromEntries(EFFECTS.map((e) => [e.type, e])) as Record<EffectType, EffectInfo>;

export function defaultEffectParams(type: EffectType): Record<string, number | string> {
  const info = EFFECT_BY_TYPE[type];
  return Object.fromEntries(Object.entries(info.params).map(([k, v]) => [k, v.default]));
}

export function defaultPresetParams(preset: string): Record<string, number> {
  const info = PRESET_BY_ID[preset];
  if (!info) return {};
  return Object.fromEntries(Object.entries(info.params).map(([k, v]) => [k, v.default]));
}

export const TRACK_COLORS = ['#ff7aa2', '#5cc8ff', '#ffd166', '#3ddc97', '#ff9f6b', '#a99bff', '#7be0e8', '#c6f27a', '#f7a8ff', '#ffb547'];

/** Standard drum lane notes (GM-ish so MIDI import maps sensibly). */
export const DRUM_LANE_NOTES: Record<string, number> = {
  kick: 36, rim: 37, snare: 38, clap: 39, hat: 42, openhat: 46, perc: 47, perc2: 48, tom: 45, crash: 49, ride: 51, shaker: 70, fx: 75, snare2: 40, kick2: 35,
};
