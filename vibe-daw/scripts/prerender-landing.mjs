// Runs after `vite build`. Writes the landing page's HTML into dist/index.html and keeps the
// empty app shell as dist/app.html, which every other route serves (see netlify.toml).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const out = 'dist-prerender';
await build({ logLevel: 'warn', build: { ssr: 'src/landing/prerender.tsx', outDir: out, emptyOutDir: true } });
const { render } = await import(pathToFileURL(`${out}/prerender.js`).href);
const shell = readFileSync('dist/index.html', 'utf8');
const root = '<div id="root"></div>';
if (!shell.includes(root)) throw new Error('dist/index.html has no empty #root to fill');
writeFileSync('dist/app.html', shell);
// The landing page is always dark, as main.tsx sets once it runs.
const page = shell.replace('<html lang="en">', '<html lang="en" style="color-scheme: dark">').replace(root, `<div id="root">${render()}</div>`);
writeFileSync('dist/index.html', page);
rmSync(out, { recursive: true, force: true });
console.log(`Prerendered the landing page (${Math.round(page.length / 1024)} KB).`);
