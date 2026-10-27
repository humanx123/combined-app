import { describe, expect, it } from 'vitest';
import { ChordReader, type ReaderConfig } from '../chordReader';
import type { HandData } from '../types';
import type { HandFrame } from '../input/types';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
function hand(label: 'Left' | 'Right', extended: string[], extra: Partial<HandData> = {}): HandData {
  return { landmarks: [], label, fingerCount: extended.length, extendedFingers: extended, tiltAngle: 0.2, positionY: 0.3, positionX: 0.5, ...extra };
}
const frame = (left: HandData | null, right: HandData | null, source: 'camera' | 'keyboard' = 'keyboard'): HandFrame => ({ left, right, source });
const diatonic: ReaderConfig = { harmony: 'diatonicMajor', style: 'fingers' };

describe('ChordReader', () => {
  it('reads the degree from the left hand and the style from the right', () => {
    const r = new ChordReader();
    const out = r.read(frame(hand('Left', FINGERS.slice(1, 4)), hand('Right', ['index', 'middle', 'ring'])), diatonic, 0);
    expect(out).toMatchObject({ playing: true, chordIndex: 2, scaleMode: 'major', modeOverride: undefined, chordStyle: '7th', octaveDown: false });
    expect(out.volume).toBeCloseTo(0.8);
  });

  it('needs the new degree held for 100 ms before switching', () => {
    const r = new ChordReader();
    const right = hand('Right', ['index']);
    r.read(frame(hand('Left', ['index']), right), diatonic, 0);
    expect(r.read(frame(hand('Left', ['index', 'middle', 'ring', 'pinky']), right), diatonic, 50).chordIndex).toBe(0);
    expect(r.read(frame(hand('Left', ['index', 'middle', 'ring', 'pinky']), right), diatonic, 160).chordIndex).toBe(3);
  });

  it('maps index+pinky to VI and adding the thumb to VII', () => {
    const r = new ChordReader();
    const right = hand('Right', ['index']);
    expect(r.read(frame(hand('Left', ['index', 'pinky']), right), diatonic, 0).chordIndex).toBe(5);
    r.reset();
    expect(r.read(frame(hand('Left', ['thumb', 'index', 'pinky']), right), diatonic, 0).chordIndex).toBe(6);
  });

  it('follows wrist tilt in tilt mode and locks the minor table in diatonic minor', () => {
    const r = new ChordReader();
    const right = hand('Right', ['index']);
    expect(r.read(frame(hand('Left', ['index'], { tiltAngle: -0.4 }), right), { harmony: 'tilt', style: 'fingers' }, 0).modeOverride).toBe('minor');
    expect(r.read(frame(hand('Left', ['index'], { tiltAngle: 0.4 }), right), { harmony: 'tilt', style: 'fingers' }, 10).modeOverride).toBe('major');
    expect(r.read(frame(hand('Left', ['index']), right), { harmony: 'diatonicMinor', style: 'sus4' }, 20)).toMatchObject({ scaleMode: 'minor', modeOverride: undefined, chordStyle: 'sus4' });
  });

  it('mutes on a left fist at once but rides out a dropped hand for the grace period', () => {
    const r = new ChordReader();
    const right = hand('Right', ['index']);
    r.read(frame(hand('Left', ['index', 'middle']), right), diatonic, 0);
    expect(r.read(frame(null, right), diatonic, 50)).toMatchObject({ playing: true, chordIndex: 1 });
    expect(r.read(frame(null, right), diatonic, 200).playing).toBe(false);
    r.read(frame(hand('Left', ['index']), right), diatonic, 300);
    expect(r.read(frame(hand('Left', []), right), diatonic, 310).playing).toBe(false);
  });

  it('reads the right thumb as one octave down', () => {
    const r = new ChordReader();
    expect(r.read(frame(hand('Left', ['index']), hand('Right', ['thumb', 'index'])), diatonic, 0).octaveDown).toBe(true);
  });

  it('keeps a camera pinky for VI even when one frame misses it', () => {
    const r = new ChordReader();
    const right = hand('Right', ['index']);
    r.read(frame(hand('Left', ['index', 'pinky']), right, 'camera'), diatonic, 0);
    expect(r.read(frame(hand('Left', ['index']), right, 'camera'), diatonic, 30).chordIndex).toBe(5);
  });
});
