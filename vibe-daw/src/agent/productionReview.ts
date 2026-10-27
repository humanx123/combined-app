import type { Project } from '../model/types';

/** Ignore UI/annotation/name changes; invalidate a review when the sound changes. */
export function soundSignature(project: Project): string {
  return JSON.stringify({
    bpm: project.bpm, timeSignature: project.timeSignature, swing: project.swing, master: project.master,
    tracks: project.tracks.map(({ kind, volumeDb, pan, mute, solo, instrument, drumLanes, effects, clips }) => ({
      kind, volumeDb, pan, mute, solo, instrument, drumLanes, effects,
      clips: clips.map(({ id: _id, name: _name, aiPending: _pending, ...clip }) => clip),
    })),
  });
}

export function hasPlayableContent(project: Project): boolean {
  const solo = project.tracks.some((track) => track.solo);
  return project.tracks.some((track) => !track.mute && (!solo || track.solo) && track.clips.some((clip) => !clip.muted && clip.length > 0 && (clip.type === 'audio' || clip.notes.some((note) => note.velocity > 0 && note.start >= 0 && note.start < clip.length))));
}

/** Run-local evidence lives outside compactable chat history. */
export class ProductionReview {
  private baseline: string;
  private reviewed: string | null = null;
  private nudges = 0;
  private bars = '';
  constructor(project: Project) { this.baseline = soundSignature(project); }

  record(project: Project, args: Record<string, unknown>, result: Record<string, unknown>) {
    if ('error' in result || !String(result.heard ?? '').trim() || (Array.isArray(args.track_ids) && args.track_ids.length)) return;
    this.reviewed = soundSignature(project);
    this.bars = String(result.bars ?? 'an excerpt');
  }

  needsReview(project: Project): boolean {
    const sound = soundSignature(project);
    return hasPlayableContent(project) && sound !== this.baseline && sound !== this.reviewed;
  }

  context(project: Project, canListen: boolean): string {
    return `<production_review>\n${!canListen ? 'Listening is disabled. Do not claim an audio review.' : this.needsReview(project) ? 'The current audible edits have not had a full-mix listening review. Normally use one short listen on a representative edited passage before finishing. Inspect notes first; re-listen only for a specific unresolved audible issue.' : this.reviewed === soundSignature(project) ? `Current mix reviewed: ${this.bars} (excerpt only; do not claim the whole song was checked).` : 'No unreviewed audible edits in this run.'}\n</production_review>`;
  }

  completionReminder(project: Project, canListen: boolean): string | null {
    if (!canListen || !this.needsReview(project) || this.nudges >= 1) return null;
    this.nudges++;
    return 'Before finishing: the current audio edits have not been reviewed in the full mix. Call listen without track_ids on a representative passage containing your changes. Use its actual findings to fix the highest-impact issue if needed; recheck only if that issue remains uncertain. If listening fails, report that limitation honestly instead of claiming verification.';
  }
}
