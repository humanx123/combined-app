// Streamed multisampled instruments. Buffers are fetched once, decoded, and cached as
// plain AudioBuffers so both the live engine and offline renders can share them.
//
// Sources:
//  - Salamander Grand Piano (CC-BY 3.0, Alexander Holm) via tonejs.github.io
//  - tonejs-instruments by Nicholaus Brosowsky (CC-BY 3.0) via GitHub Pages

import { decodeAudio } from '../samples/library';

const NB = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

interface MultiSample {
  baseUrl: string;
  /** note name (Tone format, e.g. "C4", "F#2") -> file name */
  files: Record<string, string>;
}

/** Turn "As2 C3 Ds4" style file stems into a Tone-style note map. */
function stems(list: string): Record<string, string> {
  return Object.fromEntries(
    list.split(/\s+/).filter(Boolean).map((stem) => [stem.replace('s', '#'), `${stem}.mp3`]),
  );
}

const SALAMANDER = Object.fromEntries(
  ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8']
    .map((s) => [s.replace('s', '#'), `${s}.mp3`]),
);

export const MULTISAMPLES: Record<string, MultiSample> = {
  piano: { baseUrl: 'https://tonejs.github.io/audio/salamander/', files: SALAMANDER },
  acoustic_guitar: { baseUrl: `${NB}guitar-acoustic/`, files: stems('D2 F2 A2 C3 E3 G3 A3 C4 E4 G4 A4 C5 D5') },
  electric_guitar: { baseUrl: `${NB}guitar-electric/`, files: stems('E2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6') },
  nylon_guitar: { baseUrl: `${NB}guitar-nylon/`, files: stems('B1 D2 E2 Fs2 A2 Cs3 E3 G3 B3 Cs4 E4 Fs4 A4 Cs5 E5 G5 A5') },
  electric_bass: { baseUrl: `${NB}bass-electric/`, files: stems('E1 G1 As1 Cs2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4') },
  cello: { baseUrl: `${NB}cello/`, files: stems('C2 E2 G2 As2 Cs3 E3 G3 As3 Cs4 E4 G4 C5') },
  violin: { baseUrl: `${NB}violin/`, files: stems('G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7') },
  flute: { baseUrl: `${NB}flute/`, files: stems('C4 E4 A4 C5 E5 A5 C6 E6 A6 C7') },
  harp: { baseUrl: `${NB}harp/`, files: stems('E1 G1 B1 D2 F2 A2 C3 E3 G3 B3 D4 F4 A4 C5 E5 G5 B5 D6 F6 A6 D7') },
  xylophone: { baseUrl: `${NB}xylophone/`, files: stems('G4 C5 G5 C6 G6 C7 G7 C8') },
  organ: { baseUrl: `${NB}organ/`, files: stems('C1 Fs1 C2 Fs2 C3 Fs3 C4 Fs4 C5 Fs5 C6') },
};

const cache = new Map<string, Promise<Record<string, AudioBuffer>>>();

/** Fetch and decode every zone of a multisampled instrument (deduplicated, cached). */
export function loadMultisample(preset: string): Promise<Record<string, AudioBuffer>> {
  const def = MULTISAMPLES[preset];
  if (!def) return Promise.resolve({});
  let p = cache.get(preset);
  if (!p) {
    p = (async () => {
      const entries = await Promise.all(
        Object.entries(def.files).map(async ([note, file]) => {
          try {
            const res = await fetch(def.baseUrl + file);
            if (!res.ok) throw new Error(`${res.status}`);
            return [note, await decodeAudio(await res.arrayBuffer())] as const;
          } catch (e) {
            console.warn(`Missing ${preset} zone ${note}`, e);
            return null;
          }
        }),
      );
      const zones = Object.fromEntries(entries.filter((e): e is readonly [string, AudioBuffer] => !!e));
      if (Object.keys(zones).length === 0) {
        cache.delete(preset);
        throw new Error(`Couldn't download the ${preset} samples. Check your connection.`);
      }
      return zones;
    })();
    cache.set(preset, p);
  }
  return p;
}

export function isMultisampled(preset: string): boolean {
  return preset in MULTISAMPLES;
}
