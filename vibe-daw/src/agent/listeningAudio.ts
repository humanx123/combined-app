import { encodeWav, resample, slicePcm, toMono, type PcmData } from '../engine/wav';
import type { ListeningChannels, ListeningQuality } from '../state/settings';

const RATES: Record<ListeningQuality, number> = { full: 44100, balanced: 22050, compact: 16000 };

/** One conversion for both the model input and the user's review player. */
export function prepareListeningAudio(pcm: PcmData, quality: ListeningQuality, channels: ListeningChannels, maxSeconds = 60) {
  const clipped = pcm.channels[0].length > maxSeconds * pcm.sampleRate ? slicePcm(pcm, 0, maxSeconds) : pcm;
  let audio = channels === 'mono' ? toMono(clipped) : clipped;
  const sampleRate = RATES[quality];
  if (audio.sampleRate !== sampleRate) audio = { sampleRate, channels: audio.channels.map((c) => resample(c, audio.sampleRate, sampleRate)) };
  return { wav: encodeWav(audio, 16), pcm: audio, label: `${sampleRate / 1000} kHz · ${channels}` };
}
