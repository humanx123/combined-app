import type { DrumLane } from '../model/types';

// Gesto's live band: drum grooves and bass lines that follow the chord in your hands.
// Patterns are one 4/4 bar of 16ths in step strings (X accent, x hit, o ghost, . rest);
// other meters repeat them over their own bar length.

export type Groove = 'off' | 'boombap' | 'trap' | 'house' | 'lofi' | 'reggaeton';
export type BassStyle = 'off' | 'kick' | 'roots' | 'octaves' | 'walk';
export type DrumKit = 'trap' | 'boombap' | 'lofi' | 'house';

export const GROOVES: Array<{ id: Groove; name: string; kit: DrumKit; bassPreset: string }> = [
  { id: 'boombap', name: 'Boom bap', kit: 'boombap', bassPreset: 'electric_bass' },
  { id: 'trap', name: 'Trap', kit: 'trap', bassPreset: 'bass808' },
  { id: 'house', name: 'House', kit: 'house', bassPreset: 'fm_bass' },
  { id: 'lofi', name: 'Lo-fi', kit: 'lofi', bassPreset: 'electric_bass' },
  { id: 'reggaeton', name: 'Reggaetón (dembow)', kit: 'trap', bassPreset: 'sub_bass' },
];

export const BASS_STYLES: Array<{ id: BassStyle; name: string }> = [
  { id: 'kick', name: 'Follows the kick' },
  { id: 'roots', name: 'Roots (half notes)' },
  { id: 'octaves', name: 'Octaves (8ths)' },
  { id: 'walk', name: 'Walking (root · 5th · octave)' },
  { id: 'off', name: 'No bass' },
];

const PATTERNS: Record<Exclude<Groove, 'off'>, Record<string, string>> = {
  boombap: {
    kick: 'X......x..x.....',
    snare: '....X.......X...',
    hat: 'x.o.x.o.x.o.x.oo',
  },
  trap: {
    kick: 'X.........x..x..',
    clap: '........X.......',
    hat: 'xoxoxoxoxoxoxxxx',
  },
  house: {
    kick: 'X...X...X...X...',
    clap: '....X.......X...',
    openhat: '..x...x...x...x.',
  },
  lofi: {
    kick: 'X.....x...x.....',
    snare: '....X.......X..o',
    hat: 'x.o.x.ox.o.x.o.o',
  },
  reggaeton: {
    kick: 'X...X...X...X...',
    snare: '...X..X....X..X.',
    hat: 'x.x.x.x.x.x.x.x.',
  },
};

/** The extra percussion layer, on whichever percussion lane the kit has. */
const PERCUSSION: Record<Exclude<Groove, 'off'>, string> = {
  boombap: 'oxoxoxoxoxoxoxox',
  trap: '...x......x..x..',
  house: 'x..x..x...x..x..',
  lofi: 'o.xo.oxo.o.xo.ox',
  reggaeton: 'oxoxoxoxoxoxoxox',
};

/** A missing lane falls back to its closest relative in the kit. */
const FALLBACK: Record<string, string[]> = {
  snare: ['clap', 'rim'],
  clap: ['snare', 'rim'],
  hat: ['openhat', 'shaker', 'ride'],
  openhat: ['hat', 'ride'],
  perc: ['shaker', 'perc', 'rim', 'perc2'],
};

const VELOCITY: Record<string, number> = { X: 1, x: 0.8, o: 0.45 };

export interface DrumHit { note: number; velocity: number }

function laneNote(lanes: DrumLane[], name: string): number | null {
  for (const n of [name, ...(FALLBACK[name] ?? [])]) {
    const lane = lanes.find((l) => l.name === n);
    if (lane) return lane.note;
  }
  return null;
}

/** Drum hits on one 16th step of a bar (`bar` drives the phrase ending fill). */
export function drumHits(groove: Groove, step: number, bar: number, lanes: DrumLane[], percussion: boolean): DrumHit[] {
  if (groove === 'off') return [];
  const i = step % 16;
  const hits: DrumHit[] = [];
  const lanesWanted: Array<[string, string]> = Object.entries(PATTERNS[groove]);
  if (percussion) lanesWanted.push(['perc', PERCUSSION[groove]]);
  for (const [name, pattern] of lanesWanted) {
    const c = pattern[i];
    const note = c && c !== '.' ? laneNote(lanes, name) : null;
    // Small, fixed velocity drift so repeated bars don't sound machine-stamped.
    if (note !== null) hits.push({ note, velocity: Math.max(0.2, Math.min(1, VELOCITY[c] - ((step * 7 + bar * 3) % 5) * 0.02)) });
  }
  // Every 4th bar ends with a snare pickup; every 8th starts on the crash, when the kit has one.
  if (bar % 4 === 3 && (i === 14 || i === 15)) {
    const snare = laneNote(lanes, 'snare');
    if (snare !== null && !hits.some((h) => h.note === snare)) hits.push({ note: snare, velocity: i === 15 ? 0.7 : 0.5 });
  }
  if (bar % 8 === 0 && i === 0) {
    const crash = lanes.find((l) => l.name === 'crash');
    if (crash) hits.push({ note: crash.note, velocity: 0.75 });
  }
  return hits;
}

export interface BassStep {
  /** Semitones above the chord's bass root. */
  interval: number;
  /** Length in 16th steps. */
  steps: number;
  velocity: number;
}

/** Kick steps of a groove's bar (the "follows the kick" bass plays on them). */
function kickSteps(groove: Groove): number[] {
  if (groove === 'off') return [0, 8];
  return [...PATTERNS[groove].kick].flatMap((c, i) => (c !== '.' ? [i] : []));
}

/** The bass note starting on this 16th step, if any. */
export function bassStep(style: BassStyle, groove: Groove, step: number): BassStep | null {
  const i = step % 16;
  switch (style) {
    case 'off':
      return null;
    case 'kick': {
      const kicks = kickSteps(groove);
      const at = kicks.indexOf(i);
      if (at < 0) return null;
      const next = kicks[at + 1] ?? 16;
      return { interval: 0, steps: next - i, velocity: at === 0 ? 0.95 : 0.85 };
    }
    case 'roots':
      return i % 8 === 0 ? { interval: 0, steps: 8, velocity: 0.9 } : null;
    case 'octaves':
      return i % 2 === 0 ? { interval: (i / 2) % 2 === 0 ? 0 : 12, steps: 2, velocity: (i / 2) % 2 === 0 ? 0.9 : 0.75 } : null;
    case 'walk':
      return i % 4 === 0 ? { interval: [0, 7, 12, 7][i / 4], steps: 4, velocity: i === 0 ? 0.92 : 0.8 } : null;
  }
}

/** Steps from this one to the next bass onset in the bar (how long a chord-change hit rings). */
export function stepsToNextBass(style: BassStyle, groove: Groove, step: number): number {
  const i = step % 16;
  for (let j = i + 1; j < 16; j++) if (bassStep(style, groove, j)) return j - i;
  return 16 - i;
}

/** Where the band's bass plays a chord root: C2–B2, the low register of every bass preset. */
export function bassRootFor(rootPitchClass: number): number {
  return 36 + (((rootPitchClass % 12) + 12) % 12);
}
