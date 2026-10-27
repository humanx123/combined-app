import type { KeySignature, PitchClass, ScaleName } from './types';

export const PITCH_CLASSES: PitchClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const FLAT_TO_SHARP: Record<string, PitchClass> = {
  Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C',
};

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export function normalizePitchClass(name: string): PitchClass | null {
  const n = name.trim();
  if (!n) return null;
  const letter = n[0].toUpperCase();
  const rest = n.slice(1).replace('♯', '#').replace('♭', 'b');
  const candidate = letter + rest;
  if ((PITCH_CLASSES as string[]).includes(candidate)) return candidate as PitchClass;
  if (FLAT_TO_SHARP[candidate]) return FLAT_TO_SHARP[candidate];
  return null;
}

export function pitchClassIndex(pc: PitchClass): number {
  return PITCH_CLASSES.indexOf(pc);
}

/** "C4" -> 60, "F#2" -> 42, "Bb3" -> 58. Also accepts numbers / numeric strings. */
export function noteToMidi(note: string | number): number {
  if (typeof note === 'number') return clampMidi(Math.round(note));
  const s = String(note).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return clampMidi(Math.round(Number(s)));
  const m = s.match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)$/);
  if (!m) throw new Error(`Can't read note "${note}". Use names like C4, F#2, Bb3 or MIDI numbers.`);
  const pc = normalizePitchClass(m[1] + m[2]);
  if (!pc) throw new Error(`Unknown pitch "${note}"`);
  const octave = Number(m[3]);
  // Handle Cb / B# octave crossings
  let midi = (octave + 1) * 12 + pitchClassIndex(pc);
  if (m[1].toUpperCase() === 'C' && (m[2] === 'b' || m[2] === '♭')) midi -= 12;
  if (m[1].toUpperCase() === 'B' && (m[2] === '#' || m[2] === '♯')) midi += 12;
  return clampMidi(midi);
}

export function midiToNote(midi: number): string {
  const pc = PITCH_CLASSES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pc}${octave}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clampMidi(n: number): number {
  return Math.max(0, Math.min(127, n));
}

export function scalePitchClasses(key: KeySignature): number[] {
  const root = pitchClassIndex(key.root);
  return SCALES[key.scale].map((i) => (root + i) % 12);
}

export function isInKey(midi: number, key: KeySignature): boolean {
  return scalePitchClasses(key).includes(((midi % 12) + 12) % 12);
}

/** Snap a pitch to the nearest note in the key (ties resolve downward). */
export function snapToKey(midi: number, key: KeySignature): number {
  const pcs = scalePitchClasses(key);
  for (let d = 0; d < 12; d++) {
    if (pcs.includes((((midi - d) % 12) + 12) % 12)) return midi - d;
    if (pcs.includes((((midi + d) % 12) + 12) % 12)) return midi + d;
  }
  return midi;
}

export function formatKey(key: KeySignature): string {
  return `${key.root} ${key.scale.replace(/_/g, ' ')}`;
}

// ---------------------------------------------------------------- chords

const CHORD_QUALITIES: Array<[RegExp, number[]]> = [
  // Order matters: longest/most specific suffix first.
  [/^(maj9|M9|Δ9)$/, [0, 4, 7, 11, 14]],
  [/^(maj7|M7|Δ7|Δ)$/, [0, 4, 7, 11]],
  [/^(m9|min9|-9)$/, [0, 3, 7, 10, 14]],
  [/^(m11|min11|-11)$/, [0, 3, 7, 10, 14, 17]],
  [/^(m7b5|ø|ø7|min7b5)$/, [0, 3, 6, 10]],
  [/^(mmaj7|mM7|minmaj7)$/, [0, 3, 7, 11]],
  [/^(m7|min7|-7)$/, [0, 3, 7, 10]],
  [/^(m6|min6)$/, [0, 3, 7, 9]],
  [/^(madd9|minadd9)$/, [0, 3, 7, 14]],
  [/^(m|min|-)$/, [0, 3, 7]],
  [/^(dim7|°7|o7)$/, [0, 3, 6, 9]],
  [/^(dim|°|o)$/, [0, 3, 6]],
  [/^(aug|\+)$/, [0, 4, 8]],
  [/^(7sus4)$/, [0, 5, 7, 10]],
  [/^(sus2)$/, [0, 2, 7]],
  [/^(sus4|sus)$/, [0, 5, 7]],
  [/^(add9|add2)$/, [0, 4, 7, 14]],
  [/^(13)$/, [0, 4, 7, 10, 14, 21]],
  [/^(11)$/, [0, 4, 7, 10, 14, 17]],
  [/^(9)$/, [0, 4, 7, 10, 14]],
  [/^(7)$/, [0, 4, 7, 10]],
  [/^(6)$/, [0, 4, 7, 9]],
  [/^(5)$/, [0, 7]],
  [/^(maj|M|)$/, [0, 4, 7]],
];

export interface ParsedChord {
  root: number; // pitch class 0-11
  intervals: number[];
  bass?: number; // pitch class for slash chords
}

/** Parse chord symbols like "Am7", "F#m", "Bbmaj7", "C/E", "Gsus4". */
export function parseChord(symbol: string): ParsedChord {
  const s = symbol.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = s.match(/^([A-Ga-g][#b]?)([^/]*)(?:\/([A-Ga-g][#b]?))?$/);
  if (!m) throw new Error(`Can't read chord "${symbol}"`);
  const rootPc = normalizePitchClass(m[1]);
  if (!rootPc) throw new Error(`Unknown chord root in "${symbol}"`);
  const quality = m[2];
  const entry = CHORD_QUALITIES.find(([re]) => re.test(quality));
  if (!entry) throw new Error(`Unknown chord quality "${quality}" in "${symbol}"`);
  const bassPc = m[3] ? normalizePitchClass(m[3]) : null;
  return {
    root: pitchClassIndex(rootPc),
    intervals: entry[1],
    bass: bassPc ? pitchClassIndex(bassPc) : undefined,
  };
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

/**
 * Resolve a roman numeral ("vi", "IV", "bVII", "ii7", "V7", "iv") in a key into a chord symbol.
 * Case sets quality (upper = major, lower = minor); suffixes like 7, maj7, dim, sus4 pass through.
 */
export function romanToChord(roman: string, key: KeySignature): string {
  const m = roman.trim().match(/^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/);
  if (!m) throw new Error(`Can't read roman numeral "${roman}"`);
  const [, accidental, numeral, suffixRaw] = m;
  const degree = ROMAN.indexOf(numeral.toLowerCase());
  // Degrees are measured against the major scale for chromatic numerals (bVII etc.),
  // and against the key's own scale otherwise.
  const base = accidental ? SCALES.major : SCALES[key.scale].length === 7 ? SCALES[key.scale] : SCALES.major;
  let semis = base[degree];
  if (accidental === 'b') semis -= 1;
  if (accidental === '#') semis += 1;
  const rootPc = PITCH_CLASSES[(pitchClassIndex(key.root) + semis + 12) % 12];
  const isUpper = numeral === numeral.toUpperCase();
  let suffix = suffixRaw;
  if (suffix === '°' || suffix === 'o') suffix = 'dim';
  if (suffix.startsWith('dim') || suffix.startsWith('ø') || suffix.startsWith('m7b5')) return rootPc + suffix;
  if (!isUpper) {
    // minor chord: "ii7" -> m7, "ii" -> m, "iimaj7" -> mmaj7
    if (suffix === '7') return `${rootPc}m7`;
    if (suffix === '9') return `${rootPc}m9`;
    if (suffix === '') return `${rootPc}m`;
    if (suffix.startsWith('m')) return rootPc + suffix;
    return `${rootPc}m${suffix}`;
  }
  return rootPc + suffix;
}

export interface VoicingOptions {
  /** Octave of the chord root, default 4 (C4 = middle C). */
  octave?: number;
  /** 0 = root position, 1 = first inversion... */
  inversion?: number;
  /** 'close' (default), 'open' (spread 3rd up an octave), 'drop2'. */
  spread?: 'close' | 'open' | 'drop2';
  /** Add the root an octave below. */
  addBass?: boolean;
}

/** Turn a chord symbol into MIDI notes. */
export function chordNotes(symbol: string, opts: VoicingOptions = {}): number[] {
  const { root, intervals, bass } = parseChord(symbol);
  const octave = opts.octave ?? 4;
  const base = (octave + 1) * 12 + root;
  let notes = intervals.map((i) => base + i);
  const inv = Math.max(0, Math.min(notes.length - 1, opts.inversion ?? 0));
  for (let i = 0; i < inv; i++) {
    const n = notes.shift()!;
    notes.push(n + 12);
  }
  if (opts.spread === 'open' && notes.length >= 3) {
    notes[1] += 12;
    notes.sort((a, b) => a - b);
  } else if (opts.spread === 'drop2' && notes.length >= 4) {
    const sorted = [...notes].sort((a, b) => a - b);
    const second = sorted[sorted.length - 2];
    notes = sorted.map((n) => (n === second ? n - 12 : n)).sort((a, b) => a - b);
  }
  if (bass !== undefined) {
    let b = (octave) * 12 + bass; // one octave below root octave
    while (b >= notes[0]) b -= 12;
    notes.unshift(b);
  } else if (opts.addBass) {
    notes.unshift(base - 12);
  }
  return notes.map(clampMidi);
}

/** Root MIDI note for a chord symbol at a given octave (useful for 808s and basslines). */
export function chordRoot(symbol: string, octave = 1): number {
  const { root, bass } = parseChord(symbol);
  return clampMidi((octave + 1) * 12 + (bass ?? root));
}

/** Smooth voice-leading: pick the inversion of `symbol` closest to the previous voicing. */
export function voiceLead(prev: number[] | null, symbol: string, octave = 4): number[] {
  const candidates: number[][] = [];
  const size = parseChord(symbol).intervals.length;
  for (const oct of [octave - 1, octave, octave + 1]) {
    for (let inv = 0; inv < size; inv++) candidates.push(chordNotes(symbol, { octave: oct, inversion: inv }));
  }
  if (!prev || prev.length === 0) return chordNotes(symbol, { octave });
  const center = prev.reduce((a, b) => a + b, 0) / prev.length;
  const target = (octave + 1) * 12 + 5; // keep near the requested register
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const cCenter = c.reduce((a, b) => a + b, 0) / c.length;
    const motion = c.reduce((sum, n, i) => sum + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0);
    const score = motion + Math.abs(cCenter - center) * 0.5 + Math.abs(cCenter - target) * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------- key detection

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Estimate the key from a 12-bin pitch-class histogram (chroma). */
export function detectKey(chroma: number[]): { key: KeySignature; confidence: number } {
  let best: KeySignature = { root: 'C', scale: 'major' };
  let bestR = -Infinity;
  for (let i = 0; i < 12; i++) {
    const rotated = chroma.map((_, j) => chroma[(j + i) % 12]);
    const rMaj = correlation(rotated, MAJOR_PROFILE);
    const rMin = correlation(rotated, MINOR_PROFILE);
    if (rMaj > bestR) { bestR = rMaj; best = { root: PITCH_CLASSES[i], scale: 'major' }; }
    if (rMin > bestR) { bestR = rMin; best = { root: PITCH_CLASSES[i], scale: 'minor' }; }
  }
  return { key: best, confidence: Math.max(0, bestR) };
}

/** Parse "A minor", "C#m", "Bb major", "F# dorian" into a KeySignature. */
export function parseKey(text: string): KeySignature | null {
  const s = text.trim();
  const m = s.match(/^([A-Ga-g][#b♯♭]?)\s*(.*)$/);
  if (!m) return null;
  const root = normalizePitchClass(m[1]);
  if (!root) return null;
  const q = m[2].trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!q || q === 'maj' || q === 'major' || q === 'ionian') return { root, scale: 'major' };
  if (q === 'm' || q === 'min' || q === 'minor' || q === 'aeolian' || q === 'natural_minor') return { root, scale: 'minor' };
  if (q in SCALES) return { root, scale: q as ScaleName };
  return null;
}
