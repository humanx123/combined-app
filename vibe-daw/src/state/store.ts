import { create } from 'zustand';
import { produce } from 'immer';
import { createProject } from '../model/project';
import type { Project } from '../model/types';
import type { EditSelection } from '../model/selection';

// Project document + undo history + editor UI state.
// History is snapshot-based: immer gives structural sharing, so each entry is cheap.

const HISTORY_LIMIT = 200;
const COALESCE_MS = 600;

export type BottomPanel = 'editor' | 'mixer' | 'track' | 'notes';

export interface Selection extends EditSelection {
  trackId: string | null;
}

interface DawState {
  project: Project;
  past: Array<{ project: Project; label: string }>;
  future: Array<{ project: Project; label: string }>;
  /** When set, edits are grouped into one undo step (used for agent runs). */
  transaction: string | null;
  lastLabel: string;
  lastTime: number;
  transactionStart: Project | null;

  selection: Selection;
  editorClipId: string | null;
  bottomPanel: BottomPanel;
  bottomOpen: boolean;
  /** Pixels per beat in the arrangement. */
  zoom: number;
  /** Grid snap in beats (0 = off). */
  snap: number;
  followPlayhead: boolean;

  update: (label: string, recipe: (draft: Project) => void, opts?: { coalesce?: boolean }) => void;
  replaceProject: (p: Project, opts?: { keepHistory?: boolean; label?: string }) => void;
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  undo: () => void;
  redo: () => void;

  select: (sel: Partial<Selection>) => void;
  openEditor: (clipId: string | null) => void;
  setBottom: (panel: BottomPanel, open?: boolean) => void;
  toggleBottom: () => void;
  setZoom: (z: number) => void;
  setSnap: (s: number) => void;
  setFollow: (f: boolean) => void;
}

export const useDaw = create<DawState>((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  transaction: null,
  lastLabel: '',
  lastTime: 0,
  transactionStart: null,

  selection: { trackId: null, clipIds: [] },
  editorClipId: null,
  bottomPanel: 'editor',
  bottomOpen: true,
  zoom: 22,
  snap: 0.25,
  followPlayhead: true,

  update: (label, recipe, opts) => {
    const s = get();
    const edited = produce(s.project, recipe);
    if (edited === s.project) return;
    const now = Date.now();
    const next = produce(edited, (d) => { d.updatedAt = now; });
    if (s.transaction) {
      set({ project: next, future: [], past: s.transactionStart
        ? [...s.past, { project: s.transactionStart, label: s.transaction }].slice(-HISTORY_LIMIT)
        : s.past, transactionStart: null });
      return;
    }
    const coalesce = opts?.coalesce && s.lastLabel === label && now - s.lastTime < COALESCE_MS;
    set({
      project: next,
      past: coalesce ? s.past : [...s.past, { project: s.project, label }].slice(-HISTORY_LIMIT),
      future: [],
      lastLabel: label,
      lastTime: now,
    });
  },

  replaceProject: (p, opts) => {
    const s = get();
    set({
      project: p,
      past: opts?.keepHistory ? [...s.past, { project: s.project, label: opts.label ?? 'Replace project' }].slice(-HISTORY_LIMIT) : [],
      future: [],
      transaction: null,
      transactionStart: null,
      lastLabel: '',
      lastTime: 0,
      selection: { trackId: null, clipIds: [] },
      editorClipId: opts?.keepHistory ? s.editorClipId : null,
    });
  },

  beginTransaction: (label) => {
    const s = get();
    if (s.transaction) return;
    set({ transaction: label, transactionStart: s.project, lastLabel: '', lastTime: 0 });
  },

  endTransaction: () => {
    const s = get();
    if (!s.transaction) return;
    set({ transaction: null, transactionStart: null, lastLabel: '', lastTime: 0 });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev || s.transaction) return;
    set({
      // Undo is a new change as far as sync is concerned: newer than what other devices hold.
      project: { ...prev.project, updatedAt: Date.now() },
      past: s.past.slice(0, -1),
      future: [{ project: s.project, label: prev.label }, ...s.future],
      lastLabel: '',
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next || s.transaction) return;
    set({
      project: { ...next.project, updatedAt: Date.now() },
      past: [...s.past, { project: s.project, label: next.label }],
      future: s.future.slice(1),
      lastLabel: '',
    });
  },

  select: (sel) => set((s) => ({ selection: {
    ...s.selection,
    // A fresh clip selection must not inherit a stale note/range selection.
    ...(sel.clipIds ? { notes: undefined, range: undefined } : {}),
    ...sel,
  } })),
  openEditor: (clipId) => set({ editorClipId: clipId, ...(clipId ? { bottomPanel: 'editor' as const, bottomOpen: true } : {}) }),
  setBottom: (panel, open = true) => set({ bottomPanel: panel, bottomOpen: open }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setZoom: (z) => set({ zoom: Math.max(4, Math.min(200, z)) }),
  setSnap: (snap) => set({ snap }),
  setFollow: (followPlayhead) => set({ followPlayhead }),
}));

/** Read the current project outside React. */
export const getProject = () => useDaw.getState().project;

// Playhead lives in its own store so 60fps updates don't re-render the whole app.
interface TransportState {
  playing: boolean;
  starting: boolean;
  /** Beats */
  position: number;
  recording: boolean;
  metronome: boolean;
  setPlaying: (p: boolean) => void;
  setStarting: (s: boolean) => void;
  setPosition: (b: number) => void;
  setMetronome: (m: boolean) => void;
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  starting: false,
  position: 0,
  recording: false,
  metronome: false,
  setPlaying: (playing) => set({ playing }),
  setStarting: (starting) => set({ starting }),
  setPosition: (position) => set({ position }),
  setMetronome: (metronome) => set({ metronome }),
}));
