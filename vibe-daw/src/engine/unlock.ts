import { useSettings } from '../state/settings';

// Mobile browsers (iOS Safari above all) only let an AudioContext start from inside
// the gesture's own event handler. Play loads Tone lazily and resumes after several
// awaits, which is too late there: the tap does nothing. So the native context is
// created and resumed synchronously on every gesture, before any async work, and the
// engine wraps this same context when it loads.

let native: AudioContext | null = null;

/** A blocked resume can stay pending forever under browser autoplay policies. */
export async function resumeAudioContext(ctx: Pick<AudioContext, 'state' | 'resume'>): Promise<void> {
  if (ctx.state === 'running') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const blocked = () => new Error('Audio could not start. Click Play again, or allow sound for this site in your browser settings.');
  try {
    await Promise.race([
      ctx.resume(), // Invoke synchronously, while the caller still has user activation.
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(blocked()), 5000); }),
    ]);
    if ((ctx.state as AudioContextState) !== 'running') throw blocked();
  } finally { clearTimeout(timer); }
}

/** The realtime AudioContext. Created suspended if no gesture has happened yet. */
export function nativeAudioContext(): AudioContext {
  native ??= new AudioContext({ latencyHint: useSettings.getState().latency === 'low' ? 'interactive' : 'playback' });
  return native;
}

/** Start audio output. Must be called synchronously from a user gesture handler. */
export function unlockAudio() {
  const ctx = nativeAudioContext();
  // iOS reports 'interrupted' after a call or a trip to the background.
  if (ctx.state === 'running') return;
  void resumeAudioContext(ctx).catch(() => { /* retried on the next gesture */ });
  // Older iOS only unlocks output once a source actually starts inside the gesture.
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
}

/** Keep audio unlockable for the whole session; the first gesture also runs `onFirst`. */
export function unlockAudioOnGestures(onFirst: () => void) {
  // iOS plays Web Audio through the ringer channel, so the silent switch mutes it.
  // A DAW is a media app: route it like one.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'playback';
  let first = true;
  const go = (e: Event) => {
    // A touch's pointerdown isn't a user activation yet, so resuming there would fail.
    if (e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse') return;
    try { unlockAudio(); } catch (err) { console.warn('Audio unlock failed', err); }
    if (first) { first = false; onFirst(); }
  };
  // Touch input grants activation on pointerup/touchend, not pointerdown.
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const) window.addEventListener(type, go, true);
}
