import { create } from 'zustand';

// Configurable keyboard shortcuts. Each action has default combos; users can
// override them in Settings → Keyboard. Combos look like "Ctrl+Shift+Z", "Space", "?".

export type ActionId =
  | 'playPause' | 'stopRewind' | 'toggleLoop' | 'toggleMetronome'
  | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'duplicate' | 'delete' | 'split' | 'newClip'
  | 'inlineAI' | 'focusAgent' | 'help' | 'toggleBrowser' | 'toggleAgent' | 'zoomIn' | 'zoomOut'
  | 'drawTool' | 'selectTool' | 'quantize';

export interface ActionInfo { label: string; group: 'Transport' | 'Editing' | 'View' | 'AI' | 'Piano roll'; defaults: string[] }

export const ACTIONS: Record<ActionId, ActionInfo> = {
  playPause: { label: 'Play / pause', group: 'Transport', defaults: ['Space'] },
  stopRewind: { label: 'Stop and go to start', group: 'Transport', defaults: ['Home'] },
  toggleLoop: { label: 'Loop on/off', group: 'Transport', defaults: ['L'] },
  toggleMetronome: { label: 'Metronome on/off', group: 'Transport', defaults: ['M'] },
  undo: { label: 'Undo', group: 'Editing', defaults: ['Ctrl+Z'] },
  redo: { label: 'Redo', group: 'Editing', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  copy: { label: 'Copy', group: 'Editing', defaults: ['Ctrl+C'] },
  cut: { label: 'Cut', group: 'Editing', defaults: ['Ctrl+X'] },
  paste: { label: 'Paste', group: 'Editing', defaults: ['Ctrl+V'] },
  duplicate: { label: 'Duplicate', group: 'Editing', defaults: ['Ctrl+D'] },
  delete: { label: 'Delete', group: 'Editing', defaults: ['Delete', 'Backspace'] },
  split: { label: 'Split clips at playhead', group: 'Editing', defaults: ['Ctrl+E'] },
  newClip: { label: 'New clip on selected track', group: 'Editing', defaults: ['Ctrl+Shift+N'] },
  inlineAI: { label: 'Edit selection with AI', group: 'AI', defaults: ['Ctrl+K'] },
  focusAgent: { label: 'Jump to the Producer chat', group: 'AI', defaults: ['Ctrl+L'] },
  help: { label: 'Help & shortcuts', group: 'View', defaults: ['?'] },
  toggleBrowser: { label: 'Show/hide sound browser', group: 'View', defaults: ['Ctrl+B'] },
  toggleAgent: { label: 'Show/hide Producer panel', group: 'View', defaults: ['Ctrl+J'] },
  zoomIn: { label: 'Zoom timeline in', group: 'View', defaults: ['='] },
  zoomOut: { label: 'Zoom timeline out', group: 'View', defaults: ['-'] },
  drawTool: { label: 'Draw tool', group: 'Piano roll', defaults: ['B'] },
  selectTool: { label: 'Select tool', group: 'Piano roll', defaults: ['V'] },
  quantize: { label: 'Quantize', group: 'Piano roll', defaults: ['Q'] },
};

const KEY = 'vibe:keymap';

function load(): Partial<Record<ActionId, string[]>> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

interface KeymapState {
  overrides: Partial<Record<ActionId, string[]>>;
  setBinding: (id: ActionId, combos: string[]) => void;
  reset: (id?: ActionId) => void;
  /** Replace every override at once (used when shortcuts sync from another device). */
  replaceAll: (overrides: Partial<Record<ActionId, string[]>>) => void;
}

function save(o: Partial<Record<ActionId, string[]>>) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage off */ }
}

export const useKeymap = create<KeymapState>((set, get) => ({
  overrides: sanitizeKeymap(load()),
  setBinding: (id, combos) => {
    const overrides = { ...get().overrides, [id]: combos };
    save(overrides);
    set({ overrides });
  },
  reset: (id) => {
    const overrides = id ? { ...get().overrides } : {};
    if (id) delete overrides[id];
    save(overrides);
    set({ overrides });
  },
  replaceAll: (raw) => {
    const overrides = sanitizeKeymap(raw);
    save(overrides);
    set({ overrides });
  },
}));

export function sanitizeKeymap(raw: unknown): Partial<Record<ActionId, string[]>> {
  const out: Partial<Record<ActionId, string[]>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, combos] of Object.entries(raw)) {
    if (Object.hasOwn(ACTIONS, id) && Array.isArray(combos)) out[id as ActionId] = combos.filter((c): c is string => typeof c === 'string').slice(0, 8);
  }
  return out;
}

export function bindings(id: ActionId): string[] {
  return useKeymap.getState().overrides[id] ?? ACTIONS[id].defaults;
}

const NAMED: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };

/** Normalize a keyboard event to a combo string, or null for bare modifier presses. */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  let key = NAMED[e.key] ?? e.key;
  const printableSymbol = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Shift is implied by symbols like "?" or "+"; only record it for letters, digits and named keys.
  if (e.shiftKey && !printableSymbol) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function matches(e: KeyboardEvent | React.KeyboardEvent, id: ActionId): boolean {
  const combo = comboFromEvent(e);
  return !!combo && bindings(id).includes(combo);
}

/** Display string for tooltips: the first binding, or '' if unbound. */
export function keyLabel(id: ActionId): string {
  return bindings(id)[0] ?? '';
}

/** "Label (Key)" for title attributes, so tooltips show the current binding. */
export function tip(label: string, id: ActionId): string {
  const k = keyLabel(id);
  return k ? `${label} (${k})` : label;
}
