import { sanitizeSettings, useSettings, type SettingsValues } from '../state/settings';
import { sanitizeAppearance, useTheme } from '../state/theme';
import { useKeymap } from '../state/keymap';
import { getFirebaseApp } from './firebase';

// Preference sync: AI settings (including the Gemini key), appearance and keyboard
// shortcuts live in one Firestore doc, users/{uid}/prefs/main, readable only by its owner.
// Each section is last-writer-wins on its own timestamp, so changing the theme on one
// device never reverts a key entered on another. Output latency and interface size stay
// per device: they depend on the hardware and screen, not on the person.

export type PrefSection = 'ai' | 'appearance' | 'keymap';
export const PREF_SECTIONS: PrefSection[] = ['ai', 'appearance', 'keymap'];
export interface StampedPref { data: string; updatedAt: number }
export type PrefsDoc = Partial<Record<PrefSection, StampedPref>>;

type DeviceOnly = 'latency';
const DEVICE_ONLY: DeviceOnly[] = ['latency'];

/** Current local value of each section, as stable JSON. */
export function readSections(): Record<PrefSection, string> {
  const s = useSettings.getState();
  const ai: Partial<SettingsValues> = sanitizeSettings(s);
  for (const k of DEVICE_ONLY) delete ai[k];
  const { theme, accent } = useTheme.getState();
  return {
    ai: JSON.stringify(ai),
    appearance: JSON.stringify({ theme, accent }),
    keymap: JSON.stringify(useKeymap.getState().overrides),
  };
}

function writeSection(section: PrefSection, data: string) {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(data) ?? {}; } catch { return; }
  if (section === 'ai') {
    const next = sanitizeSettings(parsed);
    const patch: Partial<SettingsValues> = { ...next };
    for (const k of DEVICE_ONLY) delete patch[k];
    useSettings.getState().set(patch);
  } else if (section === 'appearance') {
    useTheme.getState().set(sanitizeAppearance(parsed));
  } else {
    useKeymap.getState().replaceAll(parsed);
  }
}

/**
 * Decide, per section, whether the remote copy should replace the local one, and
 * whether the local copy needs uploading. Ties keep the local value and skip the upload.
 */
export function mergePrefs(local: Record<PrefSection, StampedPref>, remote: PrefsDoc | undefined) {
  const apply: Partial<Record<PrefSection, StampedPref>> = {};
  let push = false;
  for (const section of PREF_SECTIONS) {
    const l = local[section];
    const r = remote?.[section];
    if (!r || typeof r.data !== 'string' || typeof r.updatedAt !== 'number') { push = true; continue; }
    if (r.data === l.data) continue;
    // A tie with different data comes from per-build sanitizing (e.g. hosted AI off);
    // uploading it would make two devices overwrite each other forever.
    if (r.updatedAt > l.updatedAt) apply[section] = r;
    else if (l.updatedAt > r.updatedAt) push = true;
  }
  return { apply, push };
}

// ---------------------------------------------------------------- local stamps

const STAMPS = 'vibe:prefsUpdatedAt';
const OWNER = 'vibe:prefsOwner';

function loadStamps(): Record<PrefSection, number> {
  let raw: Partial<Record<PrefSection, unknown>> = {};
  try { raw = JSON.parse(localStorage.getItem(STAMPS) ?? '{}') ?? {}; } catch { /* storage off */ }
  return Object.fromEntries(PREF_SECTIONS.map((s) => [s, typeof raw[s] === 'number' ? raw[s] : 0])) as Record<PrefSection, number>;
}

let stamps = loadStamps();
let last = readSections();
let applyingRemote = false;
let uploadPending: (() => void) | null = null;

function saveStamps() {
  try { localStorage.setItem(STAMPS, JSON.stringify(stamps)); } catch { /* storage off */ }
}

function localStamped(): Record<PrefSection, StampedPref> {
  return Object.fromEntries(PREF_SECTIONS.map((s) => [s, { data: last[s], updatedAt: stamps[s] }])) as Record<PrefSection, StampedPref>;
}

let watching = false;
/** Stamp sections the user changes on this device. Safe to call more than once. */
export function trackLocalPrefChanges() {
  if (watching) return;
  watching = true;
  const check = () => {
    const now = readSections();
    let changed = false;
    for (const s of PREF_SECTIONS) {
      if (now[s] === last[s]) continue;
      changed = true;
      if (!applyingRemote) stamps[s] = Date.now();
    }
    last = now;
    if (!changed || applyingRemote) return;
    saveStamps();
    uploadPending?.();
  };
  useSettings.subscribe(check);
  useTheme.subscribe(check);
  useKeymap.subscribe(check);
}

/**
 * Local preferences last synced with a different account belong to that person: forget
 * their stamps so this account's cloud copy wins, and never carry their API key over.
 */
function adoptAccount(uid: string) {
  let owner: string | null = null;
  try { owner = localStorage.getItem(OWNER); } catch { /* storage off */ }
  if (owner && owner !== uid) {
    applyingRemote = true;
    try { useSettings.getState().set({ apiKey: '', customInstructions: '' }); } finally { applyingRemote = false; }
    last = readSections();
    stamps = { ai: 0, appearance: 0, keymap: 0 };
    saveStamps();
  }
  try { localStorage.setItem(OWNER, uid); } catch { /* storage off */ }
}

/** Start two-way sync for a signed-in user. Returns a stop function. */
export async function startPrefsSync(uid: string): Promise<() => void> {
  trackLocalPrefChanges();
  const app = await getFirebaseApp();
  if (!app) return () => {};
  const { doc, getFirestore, onSnapshot, runTransaction } = await import('firebase/firestore');
  const db = getFirestore(app);
  const ref = doc(db, 'users', uid, 'prefs', 'main');
  adoptAccount(uid);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const upload = () => {
    if (stopped) return;
    // Preferences set before sync existed have no stamp. Give them the oldest real one so
    // the first device to upload seeds the account and other unstamped devices adopt it.
    for (const s of PREF_SECTIONS) if (!stamps[s]) stamps[s] = 1;
    saveStamps();
    const local = localStamped();
    // Merge per section on the server: a device coming back online with one fresh section
    // must not overwrite newer sections another device uploaded meanwhile.
    runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const remote = (snap.exists() ? snap.data() : {}) as PrefsDoc;
      const out: PrefsDoc = {};
      for (const s of PREF_SECTIONS) {
        const r = remote[s];
        out[s] = r && typeof r.data === 'string' && typeof r.updatedAt === 'number' && r.updatedAt >= local[s].updatedAt ? r : local[s];
      }
      tx.set(ref, out);
    }).catch((e) => console.warn('Preference sync failed', e));
  };
  uploadPending = () => { clearTimeout(timer); timer = setTimeout(upload, 800); };

  const unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    // Only trust what the server has: a cache miss would look like an empty account.
    if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
    const { apply, push } = mergePrefs(localStamped(), snap.exists() ? (snap.data() as PrefsDoc) : undefined);
    const sections = Object.keys(apply) as PrefSection[];
    if (sections.length) {
      applyingRemote = true;
      try {
        for (const s of sections) writeSection(s, apply[s]!.data);
      } finally { applyingRemote = false; }
      for (const s of sections) stamps[s] = apply[s]!.updatedAt;
      last = readSections();
      saveStamps();
    }
    if (push) upload();
  }, (e) => console.warn('Preference sync unavailable', e));

  return () => {
    stopped = true;
    clearTimeout(timer);
    uploadPending = null;
    unsubscribe();
  };
}
