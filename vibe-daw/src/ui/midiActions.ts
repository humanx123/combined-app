import { parseMidi, insertMidi } from '../model/midiImport';
import { useDaw, useTransport } from '../state/store';

export async function importMidiFile(file: File): Promise<{ tracks: number; warnings: string[] }> {
  const projectId = useDaw.getState().project.id;
  const data = await file.arrayBuffer();
  const midi = parseMidi(data);
  const state = useDaw.getState();
  if (state.project.id !== projectId) throw new Error('The project changed while opening MIDI');
  if (state.transaction) throw new Error('Finish or stop the Producer before importing MIDI');
  const warnings = [...midi.warnings];
  if (state.project.tracks.length && midi.bpm && Math.abs(state.project.bpm - midi.bpm) > 0.1) warnings.push(`Kept your project tempo (${state.project.bpm} BPM); MIDI notes were imported in beats.`);
  let trackIds: string[] = [];
  state.update(`Import ${file.name}`, (p) => { trackIds = insertMidi(p, midi, useTransport.getState().position); });
  const first = useDaw.getState().project.tracks.find((t) => t.id === trackIds[0]);
  const clipIds = first?.clips.map((c) => c.id) ?? [];
  useDaw.getState().select({ trackId: trackIds[0] ?? null, clipIds });
  if (clipIds[0]) useDaw.getState().openEditor(clipIds[0]);
  return { tracks: trackIds.length, warnings };
}
