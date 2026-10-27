import type { PcmData } from './wav';

/** Takes ownership of freshly rendered PCM; the UI stays responsive during export. */
export function encodeWavOffThread(pcm: PcmData, bitDepth: 16 | 24): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wav.worker.ts', import.meta.url), { type: 'module' });
    const fail = (message: string) => { worker.terminate(); reject(new Error(message)); };
    worker.onmessage = (event: MessageEvent<{ data?: ArrayBuffer; error?: string }>) => {
      if (event.data.error) return fail(event.data.error);
      if (event.data.data) { worker.terminate(); resolve(new Blob([event.data.data], { type: 'audio/wav' })); }
    };
    worker.onerror = (event) => fail(event.message || 'WAV encoding failed');
    worker.onmessageerror = () => fail('Could not receive encoded WAV');
    try { worker.postMessage({ pcm, bitDepth }, [...new Set(pcm.channels.map((c) => c.buffer))]); }
    catch (e) { fail(e instanceof Error ? e.message : String(e)); }
  });
}
