/**
 * Global state store for the combined gesture-DAW platform.
 *
 * Uses Zustand with immer for immutable updates. The store is intentionally
 * flat: it holds the project, the current view, and the gesture/DAW integration
 * state in one place so that both the gesture synth and the DAW can read and
 * write the same state without prop drilling.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  CombinedState,
  Project,
  Track,
  Clip,
  GestureEvent,
  Suggestion,
  Checkpoint,
  HistoryEntry,
  ReferenceTrack,
} from '../types';

/** Actions available on the store. */
interface CombinedActions {
  // Project
  setProject: (project: Project) => void;
  updateProject: (patch: Partial<Project>) => void;
  addTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  addClip: (clip: Clip) => void;
  removeClip: (id: string) => void;

  // View & mode
  setView: (view: CombinedState['currentView']) => void;
  setGestureMode: (mode: CombinedState['gestureMode']) => void;
  setInputMode: (mode: CombinedState['inputMode']) => void;

  // Gesture events
  pushGestureEvent: (event: GestureEvent) => void;
  clearGestureEvents: () => void;

  // AI
  addSuggestion: (suggestion: Suggestion) => void;
  removeSuggestion: (id: string) => void;
  setAiInstructions: (instructions: string) => void;
  addReferenceTrack: (track: ReferenceTrack) => void;

  // Checkpoints & undo
  pushCheckpoint: (checkpoint: Checkpoint) => void;
  pushHistory: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;

  // Reset
  reset: () => void;
}

/** The full store type. */
type CombinedStore = CombinedState & CombinedActions;

/** Initial state. */
const initialState: CombinedState = {
  project: {
    id: 'project-001',
    name: 'Untitled Session',
    version: 1,
    tempo: 120,
    timeSignature: [4, 4],
    tracks: [],
    masterVolume: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  currentView: 'gesture',
  gestureMode: 'disabled',
  inputMode: 'gesture',
  aiInstructions: '',
  suggestions: [],
  referenceTracks: [],
  checkpoints: [],
  undoHistory: [],
};

/** The global state store. */
export const useCombinedStore = create<CombinedStore>()(
  immer((set, get) => ({
    ...initialState,

    // ─── Project ──────────────────────────────────────────────────────────
    setProject: (project) =>
      set((state) => {
        state.project = project;
      }),

    updateProject: (patch) =>
      set((state) => {
        Object.assign(state.project, patch);
        state.project.updatedAt = Date.now();
      }),

    addTrack: (track) =>
      set((state) => {
        state.project.tracks.push(track);
      }),

    removeTrack: (id) =>
      set((state) => {
        state.project.tracks = state.project.tracks.filter((t) => t.id !== id);
      }),

    updateTrack: (id, patch) =>
      set((state) => {
        const track = state.project.tracks.find((t) => t.id === id);
        if (track) Object.assign(track, patch);
      }),

    addClip: (clip) =>
      set((state) => {
        const track = state.project.tracks.find((t) => t.id === clip.trackId);
        if (track) track.clips.push(clip);
      }),

    removeClip: (id) =>
      set((state) => {
        for (const track of state.project.tracks) {
          track.clips = track.clips.filter((c) => c.id !== id);
        }
      }),

    // ─── View & mode ──────────────────────────────────────────────────────
    setView: (view) =>
      set((state) => {
        state.currentView = view;
      }),

    setGestureMode: (mode) =>
      set((state) => {
        state.gestureMode = mode;
      }),

    setInputMode: (mode) =>
      set((state) => {
        state.inputMode = mode;
      }),

    // ─── Gesture events ───────────────────────────────────────────────────
    pushGestureEvent: (event) =>
      set((state) => {
        // Keep the last 100 events to bound memory
        state.gestureEvents = [...(state.gestureEvents || []), event].slice(-100);
      }),

    clearGestureEvents: () =>
      set((state) => {
        state.gestureEvents = [];
      }),

    // ─── AI ───────────────────────────────────────────────────────────────
    addSuggestion: (suggestion) =>
      set((state) => {
        state.suggestions.push(suggestion);
      }),

    removeSuggestion: (id) =>
      set((state) => {
        state.suggestions = state.suggestions.filter((s) => s.id !== id);
      }),

    setAiInstructions: (instructions) =>
      set((state) => {
        state.aiInstructions = instructions;
      }),

    addReferenceTrack: (track) =>
      set((state) => {
        state.referenceTracks.push(track);
      }),

    // ─── Checkpoints & undo ───────────────────────────────────────────────
    pushCheckpoint: (checkpoint) =>
      set((state) => {
        state.checkpoints.push(checkpoint);
      }),

    pushHistory: (entry) =>
      set((state) => {
        state.undoHistory.push(entry);
      }),

    undo: () =>
      set((state) => {
        const entry = state.undoHistory.pop();
        if (entry) {
          state.project = entry.before;
        }
      }),

    redo: () =>
      set((state) => {
        // Redo is a no-op in this minimal implementation;
        // the DAW's own undo stack handles the full history.
      }),

    // ─── Reset ────────────────────────────────────────────────────────────
    reset: () =>
      set(() => ({ ...initialState })),
  })),
);