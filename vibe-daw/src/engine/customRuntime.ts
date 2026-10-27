// The custom effect runtime. Every function here is serialized with toString() into the
// AudioWorklet module and the test worker, so each must be self-contained: no imports
// and no references to anything outside its own body except its arguments and globals.

export interface CustomInfo { sampleRate: number; bpm: number }
export type CustomProcess = (left: Float32Array, right: Float32Array, params: Record<string, number>, info: CustomInfo) => void;

/** Runs the effect's top-level code once and returns its process(). Throws on syntax or setup errors. */
export function compileCustomFx(code: string, sampleRate: number, bpm: number): CustomProcess {
  const factory = new Function('sampleRate', 'bpm', `"use strict";\n${code}\n;return typeof process === "function" ? process : undefined;`);
  const fn = factory(sampleRate, bpm);
  if (typeof fn !== 'function') throw new Error('Define function process(left, right, params, info)');
  return fn as CustomProcess;
}

/**
 * One render quantum: copy the input into the output, let the effect rewrite it in place,
 * then sanitize. Returns how many samples were NaN or infinite (and were silenced).
 */
export function runCustomBlock(fn: CustomProcess, input: Float32Array[] | undefined, output: Float32Array[], params: Record<string, number>, info: CustomInfo): number {
  const left = output[0];
  const right = output[1] ?? output[0];
  const inL = input && input[0];
  const inR = (input && input[1]) || inL;
  if (inL) left.set(inL); else left.fill(0);
  if (right !== left) { if (inR) right.set(inR); else right.fill(0); }
  fn(left, right, params, info);
  let bad = 0;
  const channels = right === left ? [left] : [left, right];
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (v !== v || v === Infinity || v === -Infinity) { ch[i] = 0; bad++; }
      else if (v > 4) ch[i] = 4;
      else if (v < -4) ch[i] = -4;
    }
  }
  return bad;
}

/* Minimal AudioWorkletGlobalScope typings (not in the DOM lib). */
declare const AudioWorkletProcessor: { new (): { readonly port: MessagePort } };
declare function registerProcessor(name: string, processor: unknown): void;
declare const sampleRate: number;

/** Registers the 'vibe-custom-fx' processor. Errors bypass the effect and are reported once over the port. */
export function workletMain(compile: typeof compileCustomFx, run: typeof runCustomBlock) {
  class CustomFxProcessor extends AudioWorkletProcessor {
    declare params: Record<string, number>;
    declare info: CustomInfo;
    declare fn: CustomProcess | null;
    declare reported: boolean;
    constructor(options: { processorOptions: { code: string; params: Record<string, number>; bpm: number } }) {
      super();
      const o = options.processorOptions;
      this.params = Object.assign({}, o.params);
      this.info = { sampleRate, bpm: o.bpm };
      this.fn = null;
      this.reported = false;
      this.port.onmessage = (e: MessageEvent) => {
        if (e.data.params) Object.assign(this.params, e.data.params);
        if (e.data.bpm) this.info.bpm = e.data.bpm;
      };
      try { this.fn = compile(o.code, sampleRate, o.bpm); } catch (error) { this.report(error); }
    }
    report(error: unknown) {
      if (this.reported) return;
      this.reported = true;
      this.port.postMessage({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
    process(inputs: Float32Array[][], outputs: Float32Array[][]) {
      const out = outputs[0];
      if (this.fn) {
        try {
          if (run(this.fn, inputs[0], out, this.params, this.info)) this.report('process() produced NaN or infinite samples; they were silenced');
          return true;
        } catch (error) { this.fn = null; this.report(error); }
      }
      const input = inputs[0];
      for (let c = 0; c < out.length; c++) {
        const src = input && (input[c] || input[0]);
        if (src) out[c].set(src); else out[c].fill(0);
      }
      return true;
    }
  }
  registerProcessor('vibe-custom-fx', CustomFxProcessor);
}

export interface CustomTestRequest { code: string; params: Record<string, number>; bpm: number; sampleRate: number; seconds: number }
export interface CustomTestResult { error?: string; peak: number; rms: number; nonFinite: number; ms: number; seconds: number }

/**
 * Runs the effect over a test signal (a decaying chord, then noise, then silence for tails)
 * and measures it. Used in a throwaway worker so a runaway loop can simply be terminated.
 */
export function runCustomTest(compile: typeof compileCustomFx, run: typeof runCustomBlock, req: CustomTestRequest): CustomTestResult {
  const block = 128, sr = req.sampleRate;
  const blocks = Math.ceil((req.seconds * sr) / block);
  const inL = new Float32Array(block), inR = new Float32Array(block);
  const outL = new Float32Array(block), outR = new Float32Array(block);
  const info = { sampleRate: sr, bpm: req.bpm };
  const result: CustomTestResult = { peak: 0, rms: 0, nonFinite: 0, ms: 0, seconds: (blocks * block) / sr };
  const started = Date.now();
  let seed = 12345, sum = 0;
  try {
    const fn = compile(req.code, sr, req.bpm);
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < block; i++) {
        const t = (b * block + i) / sr, part = t / result.seconds;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = seed / 2147483648 - 1;
        const tone = (Math.sin(t * 2 * Math.PI * 220) + Math.sin(t * 2 * Math.PI * 277.18) + Math.sin(t * 2 * Math.PI * 329.63)) * 0.2 * Math.exp(-3 * (t % 0.5));
        const x = part < 0.45 ? tone : part < 0.75 ? noise * 0.3 : 0;
        inL[i] = x; inR[i] = part < 0.45 ? tone * 0.9 : x;
      }
      result.nonFinite += run(fn, [inL, inR], [outL, outR], req.params, info);
      for (let i = 0; i < block; i++) {
        const l = Math.abs(outL[i]), r = Math.abs(outR[i]);
        if (l > result.peak) result.peak = l;
        if (r > result.peak) result.peak = r;
        sum += outL[i] * outL[i] + outR[i] * outR[i];
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  result.rms = Math.sqrt(sum / Math.max(1, blocks * block * 2));
  result.ms = Date.now() - started;
  return result;
}

/** Strips network, storage and messaging APIs from a worker before untrusted code runs in it. */
export function lockDownWorker(scope: Record<string, unknown>) {
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'indexedDB', 'caches', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'navigator', 'Request', 'Response'];
  for (let o: Record<string, unknown> | null = scope; o; o = Object.getPrototypeOf(o)) {
    for (const name of names) { try { delete o[name]; } catch { /* not configurable */ } }
  }
  for (const name of names) {
    try { Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false }); } catch { /* already locked */ }
  }
}

export function workerMain(compile: typeof compileCustomFx, run: typeof runCustomBlock, test: typeof runCustomTest, lockDown: typeof lockDownWorker) {
  const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (data: unknown) => void };
  const post = scope.postMessage.bind(scope);
  scope.onmessage = (e: MessageEvent) => { post(test(compile, run, e.data)); };
  lockDown(self as unknown as Record<string, unknown>);
}
