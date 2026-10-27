import { encodeWav, type PcmData } from './wav';

self.onmessage = (event: MessageEvent<{ pcm: PcmData; bitDepth: 16 | 24 }>) => {
  try {
    const data = encodeWav(event.data.pcm, event.data.bitDepth);
    self.postMessage({ data }, { transfer: [data] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
