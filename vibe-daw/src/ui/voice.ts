import { useEffect, useRef, useState } from 'react';
import { audioBufferToPcm } from '../engine/wav';
import { decodeAudio } from '../samples/library';
import { prepareListeningAudio } from '../agent/listeningAudio';
import { useSettings } from '../state/settings';

// Voice messages for the Producer chat: record from the mic and send the audio itself to
// the model, which hears it directly (no transcription step).

export type RecorderState = 'idle' | 'recording' | 'encoding';

export interface VoiceClip {
  /** 16 kHz mono WAV: plenty for speech, small enough to resend on every agent turn. */
  wav: ArrayBuffer;
  seconds: number;
  /** Object URL for replaying the message in the chat. */
  url: string;
}

export const MAX_VOICE_SECONDS = 90;

export function voiceSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

async function toClip(blob: Blob): Promise<VoiceClip | null> {
  const data = await blob.arrayBuffer();
  if (!data.byteLength) return null;
  const buf = await decodeAudio(data);
  const { wav } = prepareListeningAudio(audioBufferToPcm(buf, MAX_VOICE_SECONDS), 'compact', 'mono', MAX_VOICE_SECONDS);
  return { wav, seconds: buf.duration, url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })) };
}

/**
 * `start()` opens the mic; `stop()` resolves with the clip (null if canceled or empty);
 * `cancel()` discards. `onAutoStop` fires with the clip when the length limit is reached.
 */
export function useVoiceRecorder(onAutoStop: (clip: VoiceClip) => void, onError: (message: string) => void) {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const finishRef = useRef<((keep: boolean) => Promise<VoiceClip | null>) | null>(null);
  const starting = useRef(false);
  const cb = useRef({ onAutoStop, onError });
  cb.current = { onAutoStop, onError };

  const start = async () => {
    // A second tap while the permission prompt is up must not open a second recorder.
    if (finishRef.current || starting.current) return;
    starting.current = true;
    let stream: MediaStream;
    try {
      // Noise suppression treats sustained tones as noise and smears humming; it can be turned off in Settings.
      const noiseSuppression = useSettings.getState().micNoiseSuppression;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression } });
    } catch {
      cb.current.onError('Microphone access was blocked. Allow it in your browser’s site settings to talk to the Producer.');
      return;
    } finally {
      starting.current = false;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const began = performance.now();
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const tick = setInterval(() => {
      const s = (performance.now() - began) / 1000;
      setSeconds(s);
      if (s >= MAX_VOICE_SECONDS) void finish(true).then((clip) => clip && cb.current.onAutoStop(clip));
    }, 200);
    let pending: Promise<VoiceClip | null> | null = null;
    const finish = (keep: boolean) => pending ??= new Promise<VoiceClip | null>((resolve) => {
      clearInterval(tick);
      finishRef.current = null;
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!keep) { setState('idle'); resolve(null); return; }
        setState('encoding');
        try {
          resolve(await toClip(new Blob(chunks, { type: rec.mimeType })));
        } catch (e) {
          cb.current.onError(`Couldn’t read the recording: ${(e as Error).message}`);
          resolve(null);
        } finally {
          setState('idle');
        }
      };
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop(new Event('stop'));
    });
    finishRef.current = finish;
    rec.start();
    setSeconds(0);
    setState('recording');
  };

  useEffect(() => () => { void finishRef.current?.(false); }, []);

  return {
    state,
    seconds,
    start,
    stop: () => finishRef.current?.(true) ?? Promise.resolve(null),
    cancel: () => { void finishRef.current?.(false); },
  };
}
