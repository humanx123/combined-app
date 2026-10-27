// Gesto Studio launcher. Same origin as Vibe DAW (/studio) and Gesture Synth (/gesto/), so it
// reads the progression Gesture Synth leaves in localStorage and writes the AI provider and key
// straight into Vibe's own settings ('vibe:settings', sanitized again by Vibe on load).

const SETTINGS_KEY = 'vibe:settings';
const PROGRESSION_KEY = 'gesto:progresion';
const REQUEST_KEY = 'gesto:pedido';

const GEMINI_MODELS = [
  ['gemini-3.8-flash', 'Gemini 3.8 Flash · rápido, recomendado'],
  ['gemini-4-argon', 'Gemini 4 Argon · el más capaz (requiere facturación)'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite · el más barato'],
];
const GROQ_SUGGESTED = [
  ['openai/gpt-oss-120b', 'GPT-OSS 120B · el mejor con herramientas'],
  ['qwen/qwen3.8-27b', 'Qwen 3.8 27B · equilibrado'],
  ['llama-3.3-70b-versatile', 'Llama 3.3 70B · rápido'],
];
// Groq lists speech, guard and TTS models too; none of them can drive the producer.
const NOT_CHAT = /whisper|guard|tts|playai|orpheus|distil|prompt-guard|safeguard/i;

const $ = (id) => document.getElementById(id);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };

// Inside the Android app there is nothing to download.
if (/GestoStudioApp/.test(navigator.userAgent)) $('descargar').hidden = true;

// ---------------------------------------------------------------- progression from Gesture Synth

function requestFor(p) {
  const modo = p.modo === 'minor' ? 'menor' : 'mayor';
  return `Haz una canción sobre esta progresión que toqué con las manos en Gesto: ${p.acordes.join(' – ')} (tonalidad ${p.tonalidad} ${modo}). `
    + 'Arma batería, bajo y los acordes con un instrumento que les quede; elige tú el tempo y el estilo, y explícame en breve lo que hiciste.';
}

const progression = read(PROGRESSION_KEY, null);
if (progression?.acordes?.length >= 2) {
  $('progresion').hidden = false;
  $('acordes').textContent = progression.acordes.join(' · ');
  const when = new Date(progression.actualizado);
  $('tono').textContent = `Tonalidad ${progression.tonalidad} ${progression.modo === 'minor' ? 'menor' : 'mayor'} · ${when.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('llevar').addEventListener('click', () => {
    write(REQUEST_KEY, { texto: requestFor(progression), creado: Date.now() });
    location.href = '/studio';
  });
}

// ---------------------------------------------------------------- AI provider and key

let provider = read(SETTINGS_KEY, {}).provider === 'groq' ? 'groq' : 'gemini';

function fillModels(list) {
  $('modelos').replaceChildren(...list.map(([id, label]) => Object.assign(document.createElement('option'), { value: id, label })));
}

function render() {
  const s = read(SETTINGS_KEY, {});
  document.querySelectorAll('[data-proveedor]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.proveedor === provider)));
  const groq = provider === 'groq';
  $('clave-etiqueta').textContent = groq ? 'Clave de Groq' : 'Clave de Gemini';
  $('clave').placeholder = groq ? 'gsk_…' : 'AIza…';
  $('clave').value = (groq ? s.groqKey : s.apiKey) ?? '';
  $('clave-ayuda').innerHTML = groq
    ? 'Gratis en <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Groq compone y edita, pero no puede escuchar el audio.'
    : 'Gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>. Gemini además escucha tu mezcla y tus sonidos.';
  $('modelo').value = (groq ? s.groqModel : s.model) ?? (groq ? GROQ_SUGGESTED[0][0] : GEMINI_MODELS[0][0]);
  $('modelo').readOnly = false;
  $('modelo-ayuda').textContent = groq ? 'Elige una sugerencia o escribe cualquier modelo de Groq.' : 'Puedes cambiarlo luego en Ajustes del estudio.';
  fillModels(groq ? GROQ_SUGGESTED : GEMINI_MODELS);
  status('');
}

function status(text, kind = '') {
  $('estado').textContent = text;
  $('estado').className = `estado ${kind}`;
}

async function checkGemini(key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=50&key=${encodeURIComponent(key)}`);
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error('Google rechazó esa clave.');
  if (!res.ok) throw new Error(`Google respondió ${res.status}. Prueba otra vez en un momento.`);
}

async function checkGroq(key) {
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) throw new Error('Groq rechazó esa clave.');
  if (!res.ok) throw new Error(`Groq respondió ${res.status}. Prueba otra vez en un momento.`);
  const ids = ((await res.json()).data ?? []).map((m) => m.id).filter((id) => !NOT_CHAT.test(id)).sort();
  return ids;
}

document.querySelectorAll('[data-proveedor]').forEach((b) => b.addEventListener('click', () => {
  provider = b.dataset.proveedor;
  render();
}));

$('form-ia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('clave').value.trim();
  const model = $('modelo').value.trim();
  if (!key) { status('Pega una clave primero.', 'mal'); return; }
  $('guardar').disabled = true;
  status('Probando la clave…');
  try {
    const s = read(SETTINGS_KEY, {});
    if (provider === 'groq') {
      const available = await checkGroq(key);
      if (available.length) fillModels(available.map((id) => [id, id]));
      const chosen = model || GROQ_SUGGESTED[0][0];
      const warn = available.length && !available.includes(chosen) ? ` Ojo: «${chosen}» no aparece en tu cuenta de Groq; elige uno de la lista.` : '';
      write(SETTINGS_KEY, { ...s, provider: 'groq', groqKey: key, groqModel: chosen });
      status(`Lista. El productor usará Groq (${chosen}).${warn}`, warn ? 'mal' : 'ok');
    } else {
      await checkGemini(key);
      const chosen = GEMINI_MODELS.some(([id]) => id === model) ? model : GEMINI_MODELS[0][0];
      write(SETTINGS_KEY, { ...s, provider: 'gemini', apiKey: key, connection: 'apikey', model: chosen });
      status(`Lista. El productor usará Gemini (${chosen}).`, 'ok');
    }
  } catch (err) {
    status(err instanceof TypeError ? 'Sin conexión con el proveedor. Revisa internet.' : err.message, 'mal');
  } finally {
    $('guardar').disabled = false;
  }
});

render();
