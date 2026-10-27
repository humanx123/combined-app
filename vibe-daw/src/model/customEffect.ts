import type { CustomEffectDef, CustomEffectParam, Effect } from './types';
import { EFFECT_BY_TYPE } from './catalog';

// Custom effects are small DSP scripts. The definition (code + knobs) travels inside the
// project, so a song with a custom effect plays and renders anywhere, and the same
// definition can be saved to the library and synced to the user's account.

export const CUSTOM_LIMITS = { name: 60, description: 300, code: 20_000, params: 12, label: 40 } as const;
const PARAM_ID = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/** What the Producer and the code editor tell people about writing one. */
export const CUSTOM_EFFECT_API = `Write plain JavaScript that defines function process(left, right, params, info).
- left/right are Float32Array blocks (usually 128 samples) holding the input. Overwrite them in place with the output.
- params holds the current knob values by id. info is { sampleRate, bpm }.
- Top-level code runs once when the effect loads: allocate buffers and keep state (phases, filter memory) there. sampleRate and bpm are also available as constants.
- No allocation inside process(): it runs ~350 times a second on the audio thread. No DOM, network or timers exist there.
- Errors bypass the effect and show on its card. NaN/Infinity samples are silenced and output is clamped to ±4 for safety.`;

export interface CustomStarter { id: string; def: CustomEffectDef }

const p = (id: string, label: string, min: number, max: number, def: number): CustomEffectParam => ({ id, label, min, max, default: def });

/** What "New custom effect" starts from: the smallest complete example. */
export const CUSTOM_BLANK: CustomEffectDef = {
  name: 'Custom Effect',
  params: [p('gain', 'Gain (dB)', -24, 12, 0)],
  code: `// left/right hold the input. Overwrite them with your output.
function process(left, right, params) {
  const gain = Math.pow(10, params.gain / 20);
  for (let i = 0; i < left.length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
}
`,
};

/** Known-good starting points: each shows one technique (waveshaping, oscillators, delay lines, tempo). */
export const CUSTOM_STARTERS: CustomStarter[] = [
  {
    id: 'soft_clip',
    def: {
      name: 'Soft Clipper',
      description: 'Smooth tanh saturation that stays at unity gain for quiet signals.',
      params: [p('drive', 'Drive', 0, 1, 0.35), p('mix', 'Mix', 0, 1, 1)],
      code: `// Smooth tanh saturation. Quiet signals pass at unity; peaks round off.
function process(left, right, params) {
  const drive = 1 + params.drive * 24;
  const mix = params.mix;
  for (let i = 0; i < left.length; i++) {
    const l = left[i], r = right[i];
    left[i] = l + (Math.tanh(l * drive) / drive - l) * mix;
    right[i] = r + (Math.tanh(r * drive) / drive - r) * mix;
  }
}
`,
    },
  },
  {
    id: 'ring_mod',
    def: {
      name: 'Ring Mod',
      description: 'Multiplies the signal by a sine wave for metallic, bell-like tones.',
      params: [p('frequency', 'Frequency (Hz)', 20, 2000, 220), p('mix', 'Mix', 0, 1, 0.5)],
      code: `// Multiply by a sine oscillator. State (the phase) lives outside process().
const TAU = Math.PI * 2;
let phase = 0;

function process(left, right, params) {
  const step = (TAU * params.frequency) / sampleRate;
  const mix = params.mix;
  for (let i = 0; i < left.length; i++) {
    const m = Math.sin(phase);
    phase += step;
    if (phase > TAU) phase -= TAU;
    left[i] += (left[i] * m - left[i]) * mix;
    right[i] += (right[i] * m - right[i]) * mix;
  }
}
`,
    },
  },
  {
    id: 'comb',
    def: {
      name: 'Comb Resonator',
      description: 'A tuned feedback comb filter that makes anything ring at a pitch.',
      params: [p('pitch', 'Pitch (Hz)', 40, 1000, 220), p('feedback', 'Feedback', 0, 0.97, 0.85), p('mix', 'Mix', 0, 1, 0.5)],
      code: `// Feedback comb filter. Buffers are allocated once, at load.
const size = Math.ceil(sampleRate / 40) + 1;
const bufL = new Float32Array(size);
const bufR = new Float32Array(size);
let w = 0;

function process(left, right, params) {
  const d = Math.max(1, Math.min(size - 1, Math.round(sampleRate / params.pitch)));
  const fb = params.feedback, mix = params.mix, gain = 1 - fb;
  for (let i = 0; i < left.length; i++) {
    const r = (w - d + size) % size;
    const yl = left[i] + bufL[r] * fb;
    const yr = right[i] + bufR[r] * fb;
    bufL[w] = yl;
    bufR[w] = yr;
    w = (w + 1) % size;
    left[i] += (yl * gain - left[i]) * mix;
    right[i] += (yr * gain - right[i]) * mix;
  }
}
`,
    },
  },
  {
    id: 'tempo_echo',
    def: {
      name: 'Tempo Echo',
      description: 'Ping-pong echo locked to the song tempo.',
      params: [p('beats', 'Time (beats)', 0.125, 2, 0.75), p('feedback', 'Feedback', 0, 0.9, 0.4), p('mix', 'Mix', 0, 1, 0.3)],
      code: `// Ping-pong delay synced to the project tempo (info.bpm follows tempo changes).
const max = Math.ceil(sampleRate * 4);
const bufL = new Float32Array(max);
const bufR = new Float32Array(max);
let w = 0;

function process(left, right, params, info) {
  const d = Math.max(1, Math.min(max - 1, Math.round((60 / info.bpm) * params.beats * sampleRate)));
  const fb = params.feedback, mix = params.mix;
  for (let i = 0; i < left.length; i++) {
    const r = (w - d + max) % max;
    const el = bufL[r], er = bufR[r];
    bufL[w] = left[i] + er * fb;
    bufR[w] = right[i] + el * fb;
    w = (w + 1) % max;
    left[i] += el * mix;
    right[i] += er * mix;
  }
}
`,
    },
  },
];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Throws a message a person (or the Producer) can act on. */
export function validateCustomEffect(value: unknown): CustomEffectDef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('custom must be an object with name, code and params');
  const d = value as Record<string, unknown>;
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > CUSTOM_LIMITS.name) throw new Error(`name must be 1–${CUSTOM_LIMITS.name} characters`);
  if (d.description !== undefined && (typeof d.description !== 'string' || d.description.length > CUSTOM_LIMITS.description)) throw new Error(`description must be under ${CUSTOM_LIMITS.description} characters`);
  if (typeof d.code !== 'string' || !d.code.trim()) throw new Error('code must define function process(left, right, params, info)');
  if (d.code.length > CUSTOM_LIMITS.code) throw new Error(`code must be under ${CUSTOM_LIMITS.code / 1000}k characters`);
  if (!Array.isArray(d.params) || d.params.length > CUSTOM_LIMITS.params) throw new Error(`params must be a list of up to ${CUSTOM_LIMITS.params} knobs`);
  const seen = new Set<string>();
  const params = d.params.map((raw, i): CustomEffectParam => {
    const k = (raw ?? {}) as Record<string, unknown>;
    const where = `params[${i}]`;
    if (typeof k.id !== 'string' || !PARAM_ID.test(k.id)) throw new Error(`${where}.id must be a JavaScript identifier like "drive"`);
    if (seen.has(k.id)) throw new Error(`${where}.id "${k.id}" is used twice`);
    seen.add(k.id);
    const label = typeof k.label === 'string' && k.label.trim() ? k.label.trim() : k.id;
    if (label.length > CUSTOM_LIMITS.label) throw new Error(`${where}.label must be under ${CUSTOM_LIMITS.label} characters`);
    if (!finite(k.min) || !finite(k.max) || k.min >= k.max) throw new Error(`${where} "${k.id}" needs finite min < max`);
    const def = finite(k.default) ? k.default : k.min;
    if (def < k.min || def > k.max) throw new Error(`${where} "${k.id}" default must be between min and max`);
    return { id: k.id, label, min: k.min, max: k.max, default: def };
  });
  return { name: d.name.trim(), ...(typeof d.description === 'string' && d.description.trim() ? { description: d.description.trim() } : {}), code: d.code, params };
}

export function customDefaults(def: CustomEffectDef): Record<string, number> {
  return Object.fromEntries(def.params.map((k) => [k.id, k.default]));
}

/** Knob values for the audio thread: every declared knob, clamped, nothing else. */
export function customValues(def: CustomEffectDef, values: Record<string, number | string>): Record<string, number> {
  return Object.fromEntries(def.params.map((k) => {
    const v = Number(values[k.id]);
    return [k.id, Number.isFinite(v) ? Math.max(k.min, Math.min(k.max, v)) : k.default];
  }));
}

/** Keep values for knobs that survived an edit; new knobs start at their default. */
export function rebaseCustomValues(def: CustomEffectDef, values: Record<string, number | string>): Record<string, number> {
  return { ...customDefaults(def), ...Object.fromEntries(def.params.filter((k) => Number.isFinite(Number(values[k.id]))).map((k) => [k.id, Math.max(k.min, Math.min(k.max, Number(values[k.id])))])) };
}

export function newCustomEffect(id: string, def: CustomEffectDef): Effect {
  const custom = structuredClone(def);
  return { id, type: 'custom', enabled: true, params: customDefaults(custom), custom };
}

export function effectName(fx: Pick<Effect, 'type' | 'custom'>): string {
  return fx.type === 'custom' ? fx.custom?.name ?? 'Custom effect' : EFFECT_BY_TYPE[fx.type].name;
}

/** Cheap, stable fingerprint: a code or knob change rebuilds the audio node. */
export function customFingerprint(def: CustomEffectDef | undefined): string {
  if (!def) return 'none';
  const text = `${def.code}\u0000${def.params.map((k) => k.id).join(',')}`;
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}:${text.length}`;
}
