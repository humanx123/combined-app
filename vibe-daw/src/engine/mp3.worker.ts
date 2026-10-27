/// <reference lib="webworker" />
import { encodeMp3Chunk } from './mp3encode';
import type { Mp3Chunk } from './mp3frames';

// Float32 stereo PCM in, MP3 frames out. Runs off the main thread; several of these
// encode chunks of one export in parallel (see mp3frames.ts).

interface Job { left: Float32Array; right: Float32Array; sampleRate: number; kbps: number; skip: Mp3Chunk['skip']; keep: Mp3Chunk['keep'] }

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const { left, right, sampleRate, kbps, skip, keep } = e.data;
    const data = encodeMp3Chunk(left, right, sampleRate, kbps, { skip, keep }, (progress) => self.postMessage({ progress }));
    self.postMessage({ data }, [data.buffer]);
  } catch (err) {
    self.postMessage({ error: (err as Error).message ?? String(err) });
  }
};
