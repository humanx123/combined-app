// Writes the static brand files in public/brand (and the favicons) from src/brand/glyphs.ts.
// Run `npm run brand` after changing the glyphs. Needs Node 22.18+ to import the .ts file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { GLYPHS, WORDMARK, MARK, GRADIENT } from '../src/brand/glyphs.ts';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const OUT = `${PUBLIC}brand/`;
mkdirSync(OUT, { recursive: true });

const INK = '#ececee';
const BLACK = '#050505';
const TILE = '#0b0b0c';
const AGENT = GRADIENT[0];

const stops = GRADIENT.map((c, k) => `<stop offset="${k / (GRADIENT.length - 1)}" stop-color="${c}"/>`).join('');
/** The wordmark gradient, shifted so a letter drawn at its own origin gets its slice of it. */
const wordGradient = (id, x = 0) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${-x}" y1="0" x2="${WORDMARK.width - x}" y2="0">${stops}</linearGradient>`;
const markGradient = `<linearGradient id="m" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${MARK.width}" y2="${MARK.height}">${stops}</linearGradient>`;

// A slight raise, as in src/brand/Wordmark.tsx: a thin lip below and a soft vertical sheen.
// Every SVG that uses these includes SHEEN in its <defs>.
const SHEEN_STOPS = '<stop offset="0" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.48" stop-color="#fff" stop-opacity="0.04"/><stop offset="0.56" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/>';
const SHEEN = `<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="103">${SHEEN_STOPS}</linearGradient><linearGradient id="sheen-dot" x1="0" y1="0" x2="0" y2="1">${SHEEN_STOPS}</linearGradient>`;
const line = (g, paint, move = '') => `<path d="${g.d}"${move} fill="none" stroke="${paint}" stroke-width="${g.weight}" stroke-linecap="round" stroke-linejoin="${g.join}"/>`;
const stroke = (g, paint) => {
  const down = ` transform="translate(0 ${(g.weight * 0.07).toFixed(2)})"`;
  return line(g, paint, down) + line(g, 'rgba(0,0,0,0.4)', down) + line(g, paint) + line(g, 'url(#sheen)');
};
const dot = (d, paint) => {
  const y = (d.cy + d.r * 0.1).toFixed(2);
  return `<circle cx="${d.cx}" cy="${y}" r="${d.r}" fill="${paint}"/><circle cx="${d.cx}" cy="${y}" r="${d.r}" fill="rgba(0,0,0,0.35)"/><circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${paint}"/><circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="url(#sheen-dot)"/>`;
};
const svg = (viewBox, body, label = 'Vibe') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${label}">${body}</svg>\n`;

const files = {};

// The wordmark: gradient letters with a white dot for dark backgrounds, a navy dot for light ones.
const word = (letterPaint, dotPaint, defs = '') => {
  const body = WORDMARK.letters.map(({ name, x }) => {
    const g = GLYPHS[name];
    return `<g transform="translate(${x} 0)">${stroke(g, letterPaint(name, x))}${g.dot ? dot(g.dot, dotPaint) : ''}</g>`;
  }).join('');
  const pad = 2;
  return svg(`${-pad} ${-pad} ${WORDMARK.width + pad * 2} ${WORDMARK.height + pad * 2}`, `<defs>${SHEEN}${defs}</defs>${body}`);
};
const perLetter = WORDMARK.letters.map(({ name, x }) => wordGradient(`g-${name}`, x)).join('');
files['wordmark.svg'] = word((name) => `url(#g-${name})`, '#ffffff', perLetter);
files['wordmark-light.svg'] = word((name) => `url(#g-${name})`, BLACK, perLetter);
files['wordmark-mono.svg'] = word(() => INK, AGENT);

// Each letter on its own, with its slice of the gradient, so they line up again side by side.
for (const { name, x } of WORDMARK.letters) {
  const g = GLYPHS[name];
  files[`letter-${name.toLowerCase()}.svg`] = svg(`-2 -2 ${g.width + 4} ${WORDMARK.height + 4}`, `<defs>${SHEEN}${wordGradient('g', x)}</defs>${stroke(g, 'url(#g)')}${g.dot ? dot(g.dot, '#ffffff') : ''}`, name);
}

// The mark: the V holding the dot.
const pad = 4;
const markBody = (vPaint, dotPaint) => `${stroke(MARK.glyph, vPaint)}${dot(MARK.dot, dotPaint)}`;
const markBox = `${-pad} ${-pad} ${MARK.width + pad * 2} ${MARK.height + pad * 2}`;
files['mark.svg'] = svg(markBox, `<defs>${SHEEN}${markGradient}</defs>${markBody('url(#m)', '#ffffff')}`);
files['mark-mono.svg'] = svg(markBox, `<defs>${SHEEN}</defs>${markBody(INK, AGENT)}`);

// On a tile, for favicons and app icons. `round` is the corner radius as a share of the side,
// `share` how much of the height the mark fills (maskable icons keep it inside the safe zone).
const TILE_SIZE = 160;
const tile = (round, share = 0.64) => {
  const s = TILE_SIZE, scale = (s * share) / MARK.height;
  const tx = (s - MARK.width * scale) / 2, ty = (s - MARK.height * scale) / 2;
  return svg(`0 0 ${s} ${s}`, `<defs>${SHEEN}${markGradient}</defs><rect width="${s}" height="${s}" rx="${s * round}" fill="${TILE}"/><g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale})">${markBody('url(#m)', '#ffffff')}</g>`);
};
files['icon.svg'] = tile(0);
for (const [name, body] of Object.entries(files)) writeFileSync(OUT + name, body);
writeFileSync(`${PUBLIC}favicon.svg`, tile(0.22));

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
const page = await browser.newPage();
const shoot = async (file, width, height, html, type = 'png') => {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: PUBLIC + file, type, ...(type === 'jpeg' ? { quality: 90 } : {}) });
};
const bitmap = (svgText, size) => `<style>html,body{margin:0;background:${BLACK}}svg{display:block;width:${size}px;height:${size}px}</style>${svgText}`;

// Home screen and install icons. iOS rounds the corners itself; maskable keeps the mark in the safe zone.
for (const size of [180, 167, 152, 120]) await shoot(size === 180 ? 'apple-touch-icon.png' : `brand/apple-touch-icon-${size}.png`, size, size, bitmap(files['icon.svg'], size));
for (const size of [192, 512]) await shoot(`brand/icon-${size}.png`, size, size, bitmap(files['icon.svg'], size));
await shoot('brand/icon-maskable-512.png', 512, 512, bitmap(tile(0, 0.46), 512));

// iOS launch screens for installed use: the wordmark on black, portrait. Flat black keeps them
// small; each size matches a <link rel="apple-touch-startup-image"> in index.html.
const stage = `background:radial-gradient(closest-side at 40% 50%,rgba(182,156,255,.2),transparent),radial-gradient(closest-side at 64% 56%,rgba(255,143,207,.11),transparent) ${BLACK}`;
const SPLASHES = [[1290, 2796], [1179, 2556], [1284, 2778], [1170, 2532], [828, 1792], [750, 1334], [2048, 2732], [1668, 2388], [1640, 2360], [1620, 2160]];
for (const [w, h] of SPLASHES) {
  await shoot(`brand/splash-${w}x${h}.png`, w, h, `<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:${BLACK}}svg{width:${Math.round(w * 0.46)}px;height:auto}</style>${files['wordmark.svg']}`);
}

// The link preview card: the wordmark and the line from the landing page over a glimpse of the studio.
const studio = `data:image/webp;base64,${readFileSync(`${PUBLIC}screenshots/studio.webp`).toString('base64')}`;
await shoot('brand/og.jpg', 1200, 630, `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@600&display=block">
<style>
html,body{margin:0;height:100%;overflow:hidden}
body{position:relative;${stage};font-family:'Instrument Sans',sans-serif;color:#ececee;text-align:center}
.word{position:absolute;top:58px;left:50%;transform:translateX(-50%);height:118px;filter:drop-shadow(-30px 0 36px rgba(182,156,255,.24)) drop-shadow(30px 0 36px rgba(255,181,71,.2))}
.word svg{height:100%;width:auto}
h1{position:absolute;top:206px;left:0;right:0;margin:0;font-size:38px;font-weight:600;letter-spacing:-.03em;line-height:1.12}
h1 b{background:linear-gradient(100deg,#b69cff,#ff8fcf,#ffb547);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:600}
.shot{position:absolute;left:50%;top:330px;width:1040px;transform:translateX(-50%) perspective(1400px) rotateX(22deg);transform-origin:50% 0;border-radius:18px;box-shadow:0 0 0 1px #222225,0 30px 80px rgba(0,0,0,.8),0 0 120px -30px rgba(255,143,207,.35)}
</style>
<div class="word">${files['wordmark.svg']}</div>
<h1>The open source agentic DAW built to<br><b>enhance, not replace,</b> human creativity.</h1>
<img class="shot" src="${studio}">`, 'jpeg');
await browser.close();
console.log(`Wrote ${Object.keys(files).length + 9 + SPLASHES.length} files to public/`);
