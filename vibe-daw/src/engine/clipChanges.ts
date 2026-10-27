import type { Clip } from '../model/types';

// Muted clips are never scheduled, so editing them cannot change what plays. Gesto's live
// recording grows muted clips bar by bar while its own scheduler makes the sound; treating
// those edits as "nothing audible changed" keeps playback from pausing on every bar.

/** True when both clip lists schedule exactly the same notes and audio. */
export function sameAudibleClips(before: Clip[] | null, after: Clip[]): boolean {
  if (!before) return false;
  if (before === after) return true;
  const a = before.filter((c) => !c.muted);
  const b = after.filter((c) => !c.muted);
  return a.length === b.length && a.every((c, i) => c === b[i]);
}
