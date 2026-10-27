// Export options and the browser download helper. No audio imports here, so the UI
// can show the export menu without loading the engine.
import {hasNativeCapability,shareNativeFile} from '../native/native-bridge';

export type ExportFormat = 'mp3' | 'wav16' | 'wav24' | 'midi';

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; ext: string; hint: string }> = [
  { id: 'mp3', label: 'MP3', ext: 'mp3', hint: '320 kbps · about 2.4 MB per minute' },
  { id: 'wav16', label: 'WAV 16-bit', ext: 'wav', hint: 'CD quality · about 10 MB per minute' },
  { id: 'wav24', label: 'WAV 24-bit', ext: 'wav', hint: 'For mixing/mastering · about 16 MB per minute' },
  { id: 'midi', label: 'MIDI', ext: 'mid', hint: 'Notes and drums for another DAW · audio clips not included' },
];

/**
 * Exports end shortly after the last audible sound instead of carrying the whole
 * reverb/release safety tail (and any empty bars) as dead air. Tweak here:
 * - TRIM_THRESHOLD_DB: anything quieter than this counts as silence (-60 ≈ inaudible;
 *   lower it, e.g. -80, to keep more of a fading reverb).
 * - TRIM_PAD_SECONDS: silence kept after the last audible sample.
 * - Set TRIM_TRAILING_SILENCE to false to keep the full render length.
 */
export const TRIM_TRAILING_SILENCE = true;
export const TRIM_THRESHOLD_DB = -60;
export const TRIM_PAD_SECONDS = 0.25;

/** Length (in samples) to keep: last sample above the threshold, plus the pad. */
export function trimmedLength(channels: Float32Array[], sampleRate: number, thresholdDb = TRIM_THRESHOLD_DB, padSeconds = TRIM_PAD_SECONDS): number {
  const total = Math.max(0, ...channels.map((c) => c.length));
  const floor = 10 ** (thresholdDb / 20);
  let last = -1;
  for (const c of channels) for (let i = c.length - 1; i > last; i--) if (Math.abs(c[i]) > floor) { last = i; break; }
  if (last < 0) return total;
  return Math.min(total, last + 1 + Math.round(padSeconds * sampleRate));
}

export function downloadBlob(blob: Blob, filename: string) {
  if(hasNativeCapability('fileSharing')) {
    void shareNativeFile(blob,filename).catch(error=>alert(error.message));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
