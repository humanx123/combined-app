/* Vibe's service worker. The build (vite.config.ts) fills in VERSION and PRECACHE.
   - The whole app is cached on install, so it opens offline from then on.
   - Pages go to the network first, so a new deploy is picked up on the next load.
   - Built files are hashed, so they come straight from the cache.
   - Instrument samples are kept after their first download. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const ASSETS = `vibe-assets-${VERSION}`;
const PAGES = 'vibe-pages';
const SAMPLES = 'vibe-samples';
const SAMPLE_HOSTS = new Set(['tonejs.github.io', 'nbrosowsky.github.io']);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(ASSETS).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

// Keep this build's files and the previous build's, so a tab still running the old build can
// load its lazy chunks. Anything older goes.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const meta = await caches.open('vibe-meta');
    const saved = await meta.match('/versions');
    const versions = [VERSION, ...(saved ? await saved.json() : []).filter((v) => v !== VERSION)].slice(0, 2);
    await meta.put('/versions', new Response(JSON.stringify(versions)));
    for (const name of await caches.keys()) {
      if (name.startsWith('vibe-assets-') && !versions.includes(name.slice('vibe-assets-'.length))) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Gesto Studio serves Gesture Synth under /gesto/: it is a separate app with its own caching.
  if (url.origin === self.location.origin && url.pathname.startsWith('/gesto/')) return;
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request, ASSETS));
    else if (url.pathname !== '/sw.js') event.respondWith(staleWhileRevalidate(request, PAGES));
  } else if (SAMPLE_HOSTS.has(url.hostname)) event.respondWith(cacheFirst(request, SAMPLES));
  else if (FONT_HOSTS.has(url.hostname)) event.respondWith(staleWhileRevalidate(request, PAGES));
});

/** "/" is the Gesto Studio launcher, other app routes share the empty shell, and legal pages keep their own offline copies. */
async function page(request) {
  const cache = await caches.open(PAGES);
  const pathname = new URL(request.url).pathname;
  const legal = pathname.match(/^\/(terms|privacy)(?:\/|\/index\.html)?$/);
  const key = legal ? `/${legal[1]}/` : pathname === '/' || pathname === '/index.html' ? '/index.html' : '/app.html';
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) ?? (await caches.match(key)) ?? Response.error();
  }
}

async function cacheFirst(request, name) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(name)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) void cache.put(request, response.clone());
    return response;
  });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}
