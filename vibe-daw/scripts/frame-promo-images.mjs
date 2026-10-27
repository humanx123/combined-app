// Frame the freshly captured studio screenshots for sharing.
// Run npm run screenshots first; no mock UI or generated imagery is used.
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const OUT = fileURLToPath(new URL('../public/promo/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const shots = [
  { id: 'studio', title: 'Your session. Your creative control.', detail: 'A full music studio, with the Producer beside you.' },
  { id: 'producer', title: 'Describe it.\nBuild it together.', detail: 'Real instruments. Editable notes. Every change yours to keep.', portrait: true },
  { id: 'inline-edit', title: 'Select. Ask. Refine.', detail: 'Give the Producer exactly the phrase you want to change.' },
  { id: 'piano-roll', title: 'Every note is yours to shape.', detail: 'Write, edit and fine-tune the melody in the piano roll.' },
  { id: 'drums', title: 'Find your groove.', detail: 'Build a beat, one step at a time.' },
  { id: 'mixer', title: 'Make room for every sound.', detail: 'Shape the mix with real instruments and effects.', portrait: true },
];
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
const wordmark = `data:image/svg+xml;base64,${readFileSync(new URL('../public/brand/wordmark.svg', import.meta.url)).toString('base64')}`;
try {
  for (const shot of shots) {
    const image = `data:image/webp;base64,${readFileSync(new URL(`../public/screenshots/${shot.id}.webp`, import.meta.url)).toString('base64')}`;
    await page.setContent(`<!doctype html><html><head><style>
      *{box-sizing:border-box}body{margin:0;background:#101116;color:#f0f0f5;font-family:Arial,Helvetica,sans-serif}
      .canvas{width:1200px;height:800px;padding:48px 64px 32px;display:flex;flex-direction:column;position:relative;background:linear-gradient(135deg,#181923,#101116 65%)}
      header{display:flex;align-items:center;justify-content:space-between}header img{width:94px;height:auto}header span,footer{font-size:12px;letter-spacing:1.2px;color:#a0a0b2}
      main{flex:1;min-height:0;display:flex;flex-direction:column;padding-top:32px;gap:24px}
      h1{font-size:46px;line-height:1.08;letter-spacing:-1.7px;margin:0;font-weight:600;white-space:pre-line}p{font-size:17px;line-height:1.5;color:#a9a9bb;margin:14px 0 0;max-width:540px}
      .visual{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding-bottom:18px}
      .visual img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;border:1px solid #353641;border-radius:12px;box-shadow:0 18px 50px #0006}
      footer{display:flex;justify-content:space-between;border-top:1px solid #2b2c37;padding-top:18px;letter-spacing:0.3px}
      .portrait main{flex-direction:row;gap:64px;align-items:center;padding-block:24px}.portrait .copy{flex:1}.portrait h1{font-size:52px}.portrait .visual{width:45%;flex:none;height:100%;padding:0}.portrait .visual img{max-height:570px}
    </style></head><body><div class="canvas ${shot.portrait ? 'portrait' : ''}"><header><img src="${wordmark}" alt="Vibe"><span>THE OPEN SOURCE AGENTIC DAW</span></header><main><div class="copy"><h1>${shot.title}</h1><p>${shot.detail}</p></div><div class="visual"><img src="${image}" alt="${shot.id} screenshot"></div></main><footer><span>Enhance, not replace, human creativity.</span><span>github.com/cristonj/Vibe-DAW</span></footer></div></body></html>`);
    await page.locator('img').evaluateAll(async (imgs) => Promise.all(imgs.map((img) => img.decode())));
    await page.screenshot({ path: `${OUT}${shot.id}.png` });
    console.log(`promo/${shot.id}.png 2400x1600`);
  }
  const thumbs = shots.map((s) => `<figure><img src="data:image/png;base64,${readFileSync(`${OUT}${s.id}.png`).toString('base64')}"><figcaption>${s.id}</figcaption></figure>`).join('');
  await page.setViewportSize({ width: 1600, height: 850 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#22232b;font:16px Arial;color:#bbb;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}figure{margin:0}img{display:block;width:100%;border-radius:8px}figcaption{padding:8px}</style>${thumbs}`);
  await page.locator('img').evaluateAll(async (imgs) => Promise.all(imgs.map((img) => img.decode())));
  await page.screenshot({ path: `${OUT}contact-sheet.png` });
} finally { await browser.close(); }
