import { expect, it } from 'vitest';
import { createMidiClip, createProject, createTrack } from '../model/project';
import { ProductionReview, soundSignature } from './productionReview';

function song() {
  const p = createProject();
  const t = createTrack(p, 'instrument', { preset: 'pad' });
  const clip = createMidiClip(p, 0, 16);
  clip.notes = [{ id: 'n1', pitch: 60, start: 0, duration: 4, velocity: 0.7 }];
  t.clips.push(clip); p.tracks.push(t);
  return p;
}

it('requires review after musical edits, including a further edit after listening', () => {
  const p = song(); const review = new ProductionReview(p);
  p.tracks[0].volumeDb -= 3;
  expect(review.needsReview(p)).toBe(true);
  review.record(p, {}, { heard: 'Bass masks the kick', bars: '1–5' });
  expect(review.needsReview(p)).toBe(false);
  expect(review.context(p, true)).toContain('excerpt only');
  p.tracks[0].volumeDb -= 2;
  expect(review.needsReview(p)).toBe(true);
});

it('does not treat a solo audition, failed listen or empty findings as a full-mix review', () => {
  const p = song(); const review = new ProductionReview(p); p.swing = 0.2;
  for (const [args, result] of [[{ track_ids: ['t1'] }, { heard: 'Nice' }], [{}, { error: 'Render failed' }], [{}, { heard: '' }]] as const) {
    review.record(p, args, result); expect(review.needsReview(p)).toBe(true);
  }
  review.record(p, { track_ids: [] }, { heard: 'Good balance' });
  expect(review.needsReview(p)).toBe(false);
});

it('does not demand audio review for names, annotations, or review markers', () => {
  const p = song(); const before = soundSignature(p);
  p.name = 'New title'; p.tracks[0].name = 'Renamed'; p.tracks[0].color = '#fff';
  p.tracks[0].clips[0].name = 'Phrase'; p.tracks[0].clips[0].aiPending = true;
  p.updatedAt++; p.annotations = [];
  expect(soundSignature(p)).toBe(before);
});

it('respects disabled listening and bounds correction attempts', () => {
  const p = song(); const review = new ProductionReview(p); p.bpm += 10;
  expect(review.completionReminder(p, false)).toBeNull();
  expect(review.completionReminder(p, true)).toContain('Call listen');
  expect(review.completionReminder(p, true)).toBeNull();
});

it('does not send silent or empty projects for a listening review', () => {
  const p = song(); const review = new ProductionReview(p);
  p.tracks[0].mute = true;
  expect(review.needsReview(p)).toBe(false);
  p.tracks = [];
  expect(review.needsReview(p)).toBe(false);
});
