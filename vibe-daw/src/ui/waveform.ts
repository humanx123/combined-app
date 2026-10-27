import { waveformPeaks } from '../samples/analysis';

type WaveBuffer = Parameters<typeof waveformPeaks>[0];
type Peaks = { forward: Float32Array; reverse?: Float32Array };

// AudioBuffer identity also invalidates replaced audio. Weak keys release peaks when
// the library releases its decoded buffer; several clips share a single PCM scan.
const cache = new WeakMap<WaveBuffer, Peaks>();

export function cachedPeaks(buffer: WaveBuffer | undefined, reverse = false): Float32Array | null {
  const peaks = buffer && cache.get(buffer);
  return (reverse ? peaks?.reverse : peaks?.forward) ?? null;
}

export function peaksForBuffer(buffer: WaveBuffer, reverse = false): Float32Array {
  let peaks = cache.get(buffer);
  if (!peaks) {
    peaks = { forward: waveformPeaks(buffer, 2048) };
    cache.set(buffer, peaks);
  }
  return reverse ? (peaks.reverse ??= peaks.forward.slice().reverse()) : peaks.forward;
}
