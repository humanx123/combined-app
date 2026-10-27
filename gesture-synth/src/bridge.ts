/* ─── Gesto Studio bridge ────────────────────────────────────────────────
 * Gesto Studio serves this instrument at /gesto/ and Vibe DAW at the site
 * root, so both share one origin and one localStorage. This module remembers
 * the chords you hold and hands them to Vibe's producer agent as a request:
 *   gesto:progresion → { acordes, tonalidad, modo, actualizado } (read by the launcher)
 *   gesto:pedido     → { texto, creado } (consumed once by Vibe's agent panel)
 * Passing chords while the hands move are ignored: a chord counts once it is
 * held for HOLD_MS. A pause of GAP_MS starts a new progression. */

import { KEYS } from './chords';

const PROGRESSION_KEY = 'gesto:progresion';
const REQUEST_KEY = 'gesto:pedido';
const HOLD_MS = 600;
const GAP_MS = 60_000;
const MAX_CHORDS = 16;

export interface Progression {
  acordes: string[];
  tonalidad: string;
  modo: 'major' | 'minor';
  actualizado: number;
}

let candidate: { name: string; since: number } | null = null;
let progression: Progression | null = load();
const listeners = new Set<(p: Progression | null) => void>();

function load(): Progression | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESSION_KEY) ?? 'null') as Progression | null;
    return saved && Array.isArray(saved.acordes) ? saved : null;
  } catch {
    return null;
  }
}

function save(p: Progression) {
  try {
    localStorage.setItem(PROGRESSION_KEY, JSON.stringify(p));
  } catch { /* storage full or disabled */ }
}

/** Called on every hand frame with the chord that is sounding (or null when silent). */
export function noteChord(name: string | null, keyOffset: number, mode: 'major' | 'minor') {
  const now = Date.now();
  if (!name) {
    candidate = null;
    return;
  }
  if (candidate?.name !== name) {
    candidate = { name, since: now };
    return;
  }
  if (now - candidate.since < HOLD_MS) return;
  const tonalidad = KEYS[((keyOffset % 12) + 12) % 12].name;
  const stale = !progression || now - progression.actualizado > GAP_MS || progression.tonalidad !== tonalidad || progression.modo !== mode;
  if (stale) progression = { acordes: [], tonalidad, modo: mode, actualizado: now };
  const p = progression!;
  if (p.acordes[p.acordes.length - 1] !== name) {
    p.acordes = [...p.acordes, name].slice(-MAX_CHORDS);
    listeners.forEach((fn) => fn(p));
  }
  p.actualizado = now;
  save(p);
}

/** The request Vibe's agent receives, in the player's language. */
export function requestFor(p: Progression): string {
  const modo = p.modo === 'minor' ? 'menor' : 'mayor';
  return `Haz una canción sobre esta progresión que toqué con las manos en Gesto: ${p.acordes.join(' – ')} (tonalidad ${p.tonalidad} ${modo}). `
    + 'Arma batería, bajo y los acordes con un instrumento que les quede; elige tú el tempo y el estilo, y explícame en breve lo que hiciste.';
}

function sendToStudio() {
  if (!progression || progression.acordes.length < 2) return;
  try {
    localStorage.setItem(REQUEST_KEY, JSON.stringify({ texto: requestFor(progression), creado: Date.now() }));
  } catch { /* storage full or disabled */ }
  window.location.href = '/studio';
}

/** Floating pill: home (the launcher) and, once two chords are held, "take it to the studio". */
export function mountStudioButton() {
  const style = document.createElement('style');
  style.textContent = `
    .gesto-pill{position:fixed;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));z-index:80;display:flex;gap:6px;font:500 13px/1 Inter,system-ui,sans-serif}
    .gesto-pill a,.gesto-pill button{all:unset;cursor:pointer;padding:9px 12px;border-radius:999px;color:#f4f1ff;background:rgba(14,12,30,.72);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
    .gesto-pill button{background:linear-gradient(135deg,#7c3aed,#ec4899);border-color:transparent;max-width:56vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gesto-pill a:focus-visible,.gesto-pill button:focus-visible{outline:2px solid #f9a8d4;outline-offset:2px}
    .gesto-pill [hidden]{display:none}`;
  document.head.appendChild(style);

  const pill = document.createElement('nav');
  pill.className = 'gesto-pill';
  pill.setAttribute('aria-label', 'Gesto Studio');
  const home = document.createElement('a');
  home.href = '/';
  home.textContent = '⌂';
  home.title = 'Volver al inicio de Gesto Studio';
  home.setAttribute('aria-label', 'Inicio de Gesto Studio');
  const studio = document.createElement('button');
  studio.type = 'button';
  studio.title = 'Abrir el estudio y pedirle al agente una canción con estos acordes';
  studio.addEventListener('click', sendToStudio);
  pill.append(home, studio);
  document.body.appendChild(pill);

  const render = (p: Progression | null) => {
    const ready = !!p && p.acordes.length >= 2;
    studio.hidden = !ready;
    if (ready) studio.textContent = `Al estudio ▸ ${p!.acordes.slice(-4).join(' · ')}`;
  };
  listeners.add(render);
  render(progression && Date.now() - progression.actualizado < GAP_MS ? progression : null);
}
