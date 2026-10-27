/**
 * App Store poster renderer, ported from ChatRPE (scripts/lib/appstore-poster.js)
 * with the brand pulled out into `brand` (see story.cjs). Each listing image is
 * an HTML page rendered by headless Chrome, because the look depends on things
 * SVG-through-Sharp cannot draw: a device tilted in 3D perspective, a slice of
 * the real UI lifted out of its screen, and a display face fitted to the canvas.
 *
 * The App Store shows the images side by side, so the background is one
 * listing-wide canvas (the brand's `motif`, gridlines and colour fields centred
 * on the seams). Each image is a window onto its own slice, so every shape that
 * leaves one image enters the next at the same height. The store leaves a gap
 * between images (`LAYOUT.seamGap`), and the canvas leaves the same gap.
 *
 * The highlight on each image is a pop-out: the capture's own pixels for one
 * element, cropped at the rect recorded when the screenshot was taken and
 * lifted toward the viewer from the spot where it sits. Nothing is redrawn.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { statusBarSvg, statusBarHeight, homeAreaHeight, FONT_STACK } = require('./status-bar.cjs');

// Listing length the canvas is drawn for; App Store Connect allows ten images.
const LISTING_PANELS = 10;
// The 6.9" iPhone screen (height / width); captures leave out its safe areas.
const PHONE_ASPECT = 2868 / 1320;
// CSS px of the page kept around a popped element, so it lifts with a margin.
const POP_MARGIN = 8;
// CSS px of page colour around a pop-out fitted by `trim`, so its card breathes.
const TRIM_PAD = 9;
// How much a chip's text grows over its words.
const CHIP_LIFT = 1.25;
const CHIP_PAD_CSS = 7;

const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const escHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The motif's height (fraction of H) at listing x, in half-panel steps. It
 * crosses every seam low on the canvas, below the headlines, and climbs over
 * the listing: progress, drawn once across all ten images.
 */
const TREND = [0.86, 0.66, 0.8, 0.6, 0.74, 0.54, 0.7, 0.5, 0.64, 0.46, 0.6, 0.42, 0.56, 0.4, 0.52, 0.36, 0.48, 0.34, 0.44, 0.3, 0.4];

function smoothPath(points) {
  // Catmull-Rom through every point, as cubic Béziers.
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},` +
      ` ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * Compositions, picked per shot by `shot.poster`:
 *
 *   hero     wordmark and a tagline over a tilted phone
 *   side     headline on top, the phone flying in from the side
 *   center   centered headline, the phone upright below it
 *   bottom   a whole phone up top, the headline underneath
 */
const COMPOSITIONS = {
  hero: { device: 0.98, tabletDevice: 0.84, tilt: 'side', align: 'center' },
  side: { device: 1.0, tabletDevice: 0.9, tilt: 'side', align: 'side' },
  center: { device: 0.96, tabletDevice: 0.86, tilt: 'upright', align: 'center' },
  bottom: { device: 0.9, tabletDevice: 0.84, tilt: 'side', align: 'side' },
};

/**
 * Every listing-wide spacing in one place. Widths are fractions of the canvas
 * width (W), heights of its height (H); `[phone, tablet]` pairs split by canvas
 * shape. One image's own tweaks live in its shot's `place` (story.cjs).
 */
const LAYOUT = {
  titleLeft: 0.065, titleTop: 0.04, titleWidth: 0.87,
  titleHeight: { top: [0.24, 0.18], bottom: [0.19, 0.19] },
  titleStartSize: 0.2,
  bottomTitleGap: 0.045, bottomPhoneTop: 0.03,
  phoneTuck: 0.45,
  bottomClearance: 0.015, popFloor: 0.96,
  minPhoneScale: 0.55,
  sideShift: [0.06, 0.03],
  tilt: { phone: { z: 6, y: 12, x: 7 }, tablet: { z: 4, y: 12, x: 7 }, upright: 8 },
  popMin: [0.86, 0.8], popMax: 0.9, popMinLift: 1.24,
  // The least a pop-out grows, so it always covers its own pixels.
  popFloorLift: 1.04,
  popEdge: 0.012,
  chipGap: 0.012, chipEdge: 0.03,
  // The gap the App Store leaves between images (about 4.2% of an image's
  // width; Apple publishes no figure).
  seamGap: 0.042,
  // Phone size multiplier on every composition; a phone may run off the foot.
  deviceScale: [1, 1],
  minSpill: 0.06,
};

const pick = (value, tablet) => (Array.isArray(value) ? value[tablet ? 1 : 0] : value);

function createPoster(brand) {
  const B = {
    screenBg: '#020716', ground: ['#050b1f', '#020716', '#01030a'], ink: '#CCFF00',
    glow: '204, 255, 0', cool: '56, 120, 255', text: '#ffffff', grid: '#ffffff', gridOpacity: 0.045,
    light: false, statusInk: '#ffffff', motif: 'trend', motifColors: null,
    ...brand,
  };
  // A story may override any listing-wide spacing (`brand.layout`), e.g. a
  // light ground cannot run a phone behind its headline, so it sets phoneTuck 0.
  const L = { ...LAYOUT, ...B.layout };
  const font = { weight: 900, uppercase: true, lineHeight: 0.92, letterSpacing: '-0.005em', ...B.font };
  // Every face the brand uses (headline, tagline), each a variable font with
  // its italic, so weights and italics render as the apps render them.
  const faces = [{ family: font.family, file: font.file, italic: font.italicFile }, ...(B.extraFonts || [])];
  const FONT_FACE = faces.flatMap(({ family, file, italic }) => [[file, 'normal'], [italic, 'italic']]
    .filter(([f]) => f)
    .map(([f, style]) => `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: 100 900; font-display: block;
    src: url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2'); }`))
    .join('\n');
  // Accent words: one colour, or the brand's gradient clipped to the letters.
  const accentCss = B.inkGradient
    ? `background-image: ${B.inkGradient}; -webkit-background-clip: text; background-clip: text; color: transparent;
       text-shadow: none; filter: drop-shadow(0 0.04em 0.08em rgba(0,0,0,0.6));`
    : '';
  // Light grounds get a soft shadow, dark grounds a heavy one.
  const SHADOW = B.light
    ? { title: '0 0.03em 0.12em rgba(60,40,20,0.18)', accent: `0 0 0.6em rgba(${B.glow}, 0.22)`, device: 0.28, pop: 0.32 }
    : { title: '0 0.05em 0.08em #000, 0 0.1em 0.25em rgba(0,0,0,0.95), 0 0 0.5em rgba(0,0,0,0.8)',
        accent: `0 0.04em 0.06em #000, 0 0 0.5em rgba(${B.glow}, 0.5), 0 0 1.1em rgba(${B.glow}, 0.25), 0 0.1em 0.25em rgba(0,0,0,0.95)`,
        device: 0.55, pop: 0.85 };

  /**
   * One slice of the listing-wide canvas. Panels sit `gap` px apart on it, as
   * the App Store lays them out; the creative assets are one panel (gap 0).
   * `trend` draws one glowing line with a dashed average under it; `staff`
   * five parallel lines riding the same curve; `ribbon` five thicker lines in
   * the brand's gradient colours.
   */
  function listingCanvas(W, H, index, tablet, gap = 0) {
    const P = W + gap;
    const total = P * LISTING_PANELS;
    const pts = TREND.map((y, i) => [i * P / 2 - gap / 2, y * H]);
    const trend = smoothPath(pts);
    const step = W / (tablet ? 4 : 3);
    const grid = [];
    for (let x = step; x < total; x += step) grid.push(`M ${x} 0 V ${H}`);
    for (let y = H * 0.2; y < H; y += H * 0.1) grid.push(`M 0 ${y} H ${total}`);
    const seamGlows = Array.from({ length: LISTING_PANELS + 1 }, (_, k) => {
      const warm = k % 2 === 0;
      return `<ellipse cx="${k * P - gap / 2}" cy="${H * (warm ? 0.72 : 0.3)}" rx="${W * 0.75}" ry="${H * 0.3}"
        fill="url(#${warm ? 'warm' : 'cool'})"/>`;
    }).join('');
    let motif;
    if (B.motif === 'trend') {
      const avg = smoothPath(pts.map(([x, y], i) => [x, y + H * (0.05 + 0.02 * Math.sin(i * 1.7))]));
      motif = `<path d="${trend} V ${H} H 0 Z" fill="url(#fill)"/>
        <path d="${avg}" stroke="rgb(${B.cool})" stroke-opacity=".55" stroke-width="${W * 0.008}" stroke-dasharray="${W * 0.025} ${W * 0.02}" stroke-linecap="round"/>
        <path d="${trend}" stroke="${B.ink}" stroke-width="${W * 0.03}" stroke-linecap="round" filter="url(#bloom)" opacity=".5"/>
        <path d="${trend}" stroke="${B.ink}" stroke-width="${W * 0.014}" stroke-linecap="round"/>`;
    } else {
      // Five lines one staff-space apart, riding the curve.
      const space = H * (B.motif === 'ribbon' ? 0.016 : 0.022);
      const colors = B.motifColors || Array(5).fill(B.ink);
      motif = colors.map((color, k) => {
        const d = smoothPath(pts.map(([x, y]) => [x, y + (k - 2) * space]));
        const width = W * (B.motif === 'ribbon' ? 0.008 : 0.005);
        return `<path d="${d}" stroke="${color}" stroke-width="${width * 3}" stroke-linecap="round" filter="url(#bloom)" opacity=".45"/>
          <path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity=".9"/>`;
      }).join('');
    }
    return `<svg class="canvas" width="${W}" height="${H}" viewBox="${index * P} 0 ${W} ${H}" fill="none">
      <defs>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${B.ground[0]}"/><stop offset=".55" stop-color="${B.ground[1]}"/><stop offset="1" stop-color="${B.ground[2]}"/>
        </linearGradient>
        <radialGradient id="warm"><stop stop-color="rgb(${B.glow})" stop-opacity=".2"/><stop offset="1" stop-color="rgb(${B.glow})" stop-opacity="0"/></radialGradient>
        <radialGradient id="cool"><stop stop-color="rgb(${B.cool})" stop-opacity=".22"/><stop offset="1" stop-color="rgb(${B.cool})" stop-opacity="0"/></radialGradient>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgb(${B.glow})" stop-opacity=".14"/><stop offset="1" stop-color="rgb(${B.glow})" stop-opacity="0"/>
        </linearGradient>
        <filter id="bloom" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="${W * 0.018}"/></filter>
      </defs>
      <rect x="0" y="0" width="${total}" height="${H}" fill="url(#ground)"/>
      ${seamGlows}
      <path d="${grid.join(' ')}" stroke="${B.grid}" stroke-opacity="${B.gridOpacity}" stroke-width="${Math.max(1, W * 0.0015)}"/>
      ${motif}
    </svg>`;
  }

  /** Headlines in the brand's text colour, `*words*` set in its accent. */
  const accentHtml = (lines) => lines.map((line) => {
    const big = line.startsWith('!');
    return `<span${big ? ' class="big"' : ''}>${escHtml(big ? line.slice(1) : line).replace(/\*([^*]+)\*/g, '<em>$1</em>')}</span>`;
  }).join('');

  /**
   * One device showing its capture, with the pop-out lifted from it: positioned
   * HTML plus CSS scoped to `#id`, so a canvas can hold several. `unit` sets
   * shadow and lift depth; `aspect` is the screen's height/width.
   */
  function deviceStage({ id, unit, aspect, deviceW, frame, rawUri, rawSize, edges = {}, pop, side, tilt, popMinW, popMaxW, popOrigin = '50% 50%', bare = false, left = 0, z = 2 }) {
    const home = frame === 'home';
    const bezel = Math.round(deviceW * (home ? 0.05 : frame === 'plain' ? 0.03 : 0.024));
    const chin = home ? Math.round(deviceW * 0.19) : bezel;
    const screenW = deviceW - 2 * bezel;
    const screenH = Math.round(screenW * aspect);
    const deviceH = screenH + 2 * chin;
    const screenR = home ? Math.round(screenW * 0.01) : Math.round(screenW * (frame === 'plain' ? 0.045 : 0.13));
    const deviceR = home ? Math.round(deviceW * 0.14) : screenR + bezel;
    const barKind = home ? 'home' : frame === 'island' ? 'phone' : 'tablet';
    const band = statusBarHeight({ w: screenW }, barKind);
    const statusSvg = statusBarSvg({ w: screenW }, { kind: barKind, ink: B.statusInk });
    const imgH = Math.round(screenW * (rawSize.height / rawSize.width));
    // The capture is the app area under the status bar (generate.cjs shortens
    // the viewport by this band), so it fills the screen flush to the bottom.
    const imgTop = band;
    const homeH = homeAreaHeight({ w: screenW }, barKind);
    const transform = `perspective(${unit * 2.6}px) ${tilt}`;

    let popHtml = '';
    if (pop) {
      const scale = screenW / pop.viewportWidth;
      const width = pop.width * scale;
      const height = pop.height * scale;
      // Never smaller than the pixels it covers, or the screen shows around it.
      const lift = Math.max(L.popFloorLift, Math.min(popMaxW / width, Math.max(L.popMinLift, popMinW / width)));
      popHtml = `<div class="pop" data-lift="${lift}" style="left:${bezel + pop.x * scale}px;top:${chin + imgTop + pop.y * scale}px;
        width:${width}px;height:${height}px;transform-origin:${popOrigin};transform:translateY(var(--pop-dy, 0px)) translateZ(${unit * 0.07}px) scale(${lift})">
        <img src="${pop.uri}" alt=""></div>`;
    }

    const at = `#${id}`;
    const css = `
      ${at} { position: absolute; z-index: ${z}; left: ${left}px; top: 0; width: ${deviceW}px; height: ${deviceH}px;
        transform: ${transform}; transform-origin: 50% 30%; transform-style: preserve-3d; }
      ${at} .device { position: absolute; inset: 0; border-radius: ${deviceR}px;
        background: linear-gradient(${side > 0 ? 125 : 235}deg, #9aa1ab 0%, #3a3e46 7%, #16181c 30%, #0b0c0f 70%, #4a4e57 100%);
        box-shadow: inset 0 0 0 ${Math.max(2, bezel * 0.12)}px rgba(255,255,255,0.28),
          ${-side * unit * 0.05}px ${unit * 0.07}px ${unit * 0.09}px rgba(0,0,0,${SHADOW.device}),
          ${-side * unit * 0.015}px ${unit * 0.02}px ${unit * 0.025}px rgba(0,0,0,0.4); }
      ${at} .screen { position: absolute; left: ${bezel}px; top: ${chin}px; width: ${screenW}px; height: ${screenH}px;
        border-radius: ${screenR}px; overflow: hidden;
        background: linear-gradient(${edges.top || B.screenBg} 50%, ${edges.bottom || B.screenBg} 50%); }
      ${at} .home-bar { position: absolute; left: ${(screenW - screenW * 0.36) / 2}px; bottom: ${Math.round(homeH * 0.3)}px;
        width: ${screenW * 0.36}px; height: ${Math.max(3, Math.round(screenW * 0.012))}px; border-radius: 99px;
        background: ${edges.bottomLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.8)'}; }
      ${at} .screen > img { position: absolute; left: 0; top: ${imgTop}px; width: ${screenW}px; height: ${imgH}px;
        filter: saturate(1.1) contrast(1.03); }
      ${at} .status { position: absolute; left: 0; top: 0; }
      ${at} .glare { position: absolute; inset: 0; border-radius: ${screenR}px;
        background: linear-gradient(${side > 0 ? 115 : 245}deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 38%); }
      ${at} .speaker { position: absolute; left: ${(deviceW - deviceW * 0.18) / 2}px; top: ${chin * 0.45}px; width: ${deviceW * 0.18}px;
        height: ${Math.max(3, deviceW * 0.012)}px; border-radius: 99px; background: #05070b; }
      ${at} .home-button { position: absolute; left: ${(deviceW - chin * 0.62) / 2}px; bottom: ${chin * 0.19}px; width: ${chin * 0.62}px;
        height: ${chin * 0.62}px; border-radius: 50%; box-shadow: inset 0 0 0 ${Math.max(2, deviceW * 0.006)}px rgba(255,255,255,0.22); }
      ${at} .pop { position: absolute; box-sizing: border-box; border-radius: ${Math.round(unit * 0.02)}px; overflow: hidden;
        background: ${B.screenBg};
        box-shadow: 0 0 ${unit * 0.09}px rgba(${B.glow}, 0.3), 0 ${unit * 0.04}px ${unit * 0.1}px rgba(0,0,0,${SHADOW.pop}); }
      ${bare ? `${at} .pop { box-shadow: 0 ${unit * 0.04}px ${unit * 0.1}px rgba(0,0,0,${SHADOW.pop}); }` : ''}
      ${at} .pop img { display: block; width: 100%; height: 100%; filter: saturate(1.1) contrast(1.03); }`;
    const html = `<div class="stage" id="${id}" data-ox="${bezel}" data-oy="${chin + imgTop}" data-sw="${screenW}"><div class="device">${home ? '<div class="speaker"></div><div class="home-button"></div>' : ''}</div>
        <div class="screen"><img src="${rawUri}" alt=""><div class="status">${statusSvg}</div>${homeH ? '<div class="home-bar"></div>' : ''}<div class="glare"></div></div>
        ${popHtml}
      </div>`;
    return { css, html, deviceH, transform };
  }

  const titleCss = `font-family: '${font.family}', Georgia, serif; font-weight: ${font.weight};
    text-transform: ${font.uppercase ? 'uppercase' : 'none'}; letter-spacing: ${font.letterSpacing};`;

  function posterHtml({ W, H, frame, rawUri, rawSize, edges, pop, chips = [], shot, index, from }) {
    // Layout follows the canvas shape, not the device family.
    const tablet = H / W < 1.6;
    const name = COMPOSITIONS[shot.poster] ? shot.poster : 'side';
    const comp = COMPOSITIONS[name];
    const side = from === 'left' ? 1 : -1;
    const hero = name === 'hero';
    const f = shot.place || {};
    // `titleTablet` replaces the headline on iPad, where a phone claim is wrong.
    const lines = (tablet && shot.titleTablet) || shot.title;

    const deviceW = Math.round(W * (tablet ? comp.tabletDevice : comp.device) * pick(L.deviceScale, tablet) * (f.scale || 1));
    const tiltKind = f.tilt || comp.tilt;
    const shift = tiltKind === 'side' ? side * W * pick(L.sideShift, tablet) : 0;
    const lean = side * (f.lean ?? 1);
    const deg = L.tilt[tablet ? 'tablet' : 'phone'];
    const tilt = tiltKind === 'upright'
      ? `rotateX(${L.tilt.upright}deg)`
      : `rotateZ(${-deg.z * lean}deg) rotateY(${deg.y * lean}deg) rotateX(${deg.x}deg)`;
    const popMaxW = W * (f.popWidth ?? L.popMax);
    const stage = deviceStage({
      id: 'stage', unit: W, aspect: H / W, deviceW, frame, rawUri, rawSize, edges, pop, side, tilt,
      left: Math.round((W - deviceW) / 2 - shift + (f.x || 0) * W), popOrigin: f.popOrigin,
      popMinW: Math.min(W * pick(L.popMin, tablet), popMaxW), popMaxW, bare: shot.popStyle === 'bare',
    });

    const align = comp.align === 'center' ? 'center' : side > 0 ? 'left' : 'right';
    const titleMaxW = Math.round(W * (hero ? (tablet ? 0.76 : 0.92) : L.titleWidth));
    const titleMaxH = Math.round(H * pick(L.titleHeight[name === 'bottom' ? 'bottom' : 'top'], tablet));
    const copy = hero
      ? `<div class="wordmark" id="wordmark"><span>${B.wordmarkHtml}</span></div>
         <h1 id="title" class="accent tagline">${accentHtml(lines)}</h1>`
      : `<h1 id="title" class="accent">${accentHtml(lines)}</h1>`;

    return `<!doctype html><html><head><meta charset="utf-8">
    <style>
      ${FONT_FACE}
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
      body { position: relative; background: ${B.ground[1]}; }
      .canvas { position: absolute; inset: 0; }
      .copy { position: absolute; z-index: 6; left: ${hero ? 0 : Math.round(W * L.titleLeft)}px; top: ${Math.round(H * L.titleTop)}px;
        width: ${hero ? W : titleMaxW}px; text-align: ${align}; }
      h1 { margin: 0 auto; width: ${titleMaxW}px; ${titleCss} line-height: ${font.lineHeight}; color: ${B.text};
        text-shadow: ${SHADOW.title}; }
      .copy:not(.centered) h1 { margin: 0; }
      h1 span { display: block; white-space: nowrap; }
      h1.accent em { font-style: ${font.italicAccent ? 'italic' : 'normal'}; color: ${B.ink}; text-shadow: ${SHADOW.accent}; ${accentCss} }
      h1.tagline { margin-top: ${Math.round(H * 0.01)}px; }
      .wordmark { ${titleCss} line-height: 1; color: ${B.text}; }
      .wordmark span { display: inline-block; white-space: nowrap; }
      .wordmark b { color: ${B.ink}; font-weight: inherit; }
      ${stage.css}
      .chip { position: absolute; z-index: 5; left: 0; top: 0; box-sizing: border-box; border-radius: ${Math.round(W * 0.016)}px; overflow: hidden;
        background: ${B.screenBg}; box-shadow: 0 0 ${W * 0.05}px rgba(${B.glow}, 0.3); }
      .chip img { display: block; width: 100%; height: 100%; }
    </style></head><body>
      ${listingCanvas(W, H, index, tablet, Math.round(W * L.seamGap))}
      <div class="copy ${comp.align === 'center' ? 'centered' : ''} ${name}" id="copy">${copy}</div>
      ${chips.length ? stage.html.replace(/<\/div>\s*$/, chips.map((chip) => `<div class="chip" data-src="${chip.src.join(',')}" data-cw="${chip.cssW}" data-ch="${chip.cssH}" data-vw="${chip.viewportWidth}"><img src="${chip.uri}" alt=""></div>`).join('') + '</div>') : stage.html}
      <script>
        (() => {
        // Largest size at which every line fits its column and the block its band.
        const fit = (el, start, maxW, maxH) => {
          let size = start;
          const lines = Array.from(el.children);
          const fits = () => el.scrollHeight <= maxH && lines.every((line) => line.scrollWidth <= maxW);
          el.style.fontSize = size + 'px';
          while (size > 40 && !fits()) { size -= 2; el.style.fontSize = size + 'px'; }
          return size;
        };
        window.fitTitle = () => {
          const H = ${H};
          const composition = ${JSON.stringify(name)};
          const copy = document.getElementById('copy');
          const title = document.getElementById('title');
          const stage = document.getElementById('stage');
          if (composition === 'hero') {
            fit(document.getElementById('wordmark'), ${Math.round(W * 0.3)}, ${Math.round(W * (tablet ? 0.72 : 0.9))}, H);
            fit(title, ${Math.round(W * 0.16)}, ${titleMaxW}, ${Math.round(H * (tablet ? 0.13 : 0.15))});
          } else {
            fit(title, ${Math.round(W * L.titleStartSize)}, ${titleMaxW}, ${titleMaxH});
          }
          const dy = ${Math.round(H * (f.y || 0))};
          if (composition === 'bottom') {
            copy.style.top = (H - copy.offsetHeight - ${Math.round(H * L.bottomTitleGap)}) + 'px';
            stage.style.top = (${Math.round(H * L.bottomPhoneTop)} + dy) + 'px';
          } else {
            const copyBox = copy.getBoundingClientRect();
            stage.style.top = Math.round(copyBox.bottom - copyBox.height * ${L.phoneTuck} + dy) + 'px';
          }
          // The popped element must land whole on the canvas and clear of a
          // bottom headline: shrink the device from its top edge until it
          // clears its floor, then nudge it sideways.
          const pop = stage.querySelector('.pop');
          const bottomCopy = composition === 'bottom';
          if (pop || bottomCopy) {
            const floor = bottomCopy
              ? copy.getBoundingClientRect().top - ${Math.round(H * L.bottomClearance)}
              : ${Math.round(H * L.popFloor)};
            const top = stage.getBoundingClientRect().top;
            // \`clearDevice\` keeps the whole phone off a bottom headline, not just its pop-out.
            const deviceBottom = stage.querySelector('.device').getBoundingClientRect().bottom;
            const bottom = pop
              ? (${Boolean(B.layout?.clearDevice)} && bottomCopy ? Math.max(pop.getBoundingClientRect().bottom, deviceBottom) : pop.getBoundingClientRect().bottom)
              : deviceBottom;
            if (bottom > floor && !${JSON.stringify(Boolean(f.keepScale))}) {
              stage.style.transformOrigin = '50% 0';
              stage.style.transform = ${JSON.stringify(stage.transform)} +
                ' scale(' + Math.max(${L.minPhoneScale}, (floor - top) / (bottom - top)) + ')';
            }
          }
          if (pop) {
            const margin = ${Math.round(W * L.popEdge)};
            const overflow = () => {
              const box = pop.getBoundingClientRect();
              return box.left < margin ? margin - box.left : box.right > ${W} - margin ? ${W} - margin - box.right : 0;
            };
            // Slide the pop-out's transform origin along its row (staying
            // inside the element, so it still covers its own pixels); what that
            // cannot absorb moves the whole phone.
            const [originX, originY] = getComputedStyle(pop).transformOrigin.split(' ');
            const w = pop.offsetWidth;
            let ox = parseFloat(originX);
            const setOrigin = (x) => { pop.style.transformOrigin = x + 'px ' + originY; };
            const at = pop.getBoundingClientRect().left;
            setOrigin(ox + 10);
            const perPx = (pop.getBoundingClientRect().left - at) / 10;
            setOrigin(ox);
            for (let i = 0; i < 4 && perPx && overflow(); i++) {
              ox = Math.min(w, Math.max(0, ox + overflow() / perPx));
              setOrigin(ox);
            }
            // Whatever the slide cannot absorb moves the whole phone, unless the
            // pop-out is wider than the canvas allows: then the phone stays put
            // and the pop-out bleeds evenly off both edges.
            const dx = overflow();
            if (dx && pop.getBoundingClientRect().width <= ${W} - 2 * margin) stage.style.left = (stage.offsetLeft + dx) + 'px';
          }
          // Chips lift from their own words, sharing one text size.
          const chips = Array.from(stage.querySelectorAll('.chip'));
          if (chips.length) {
            const ox = Number(stage.dataset.ox);
            const oy = Number(stage.dataset.oy);
            const screenW = Number(stage.dataset.sw);
            const layout = (lift) => {
              const placed = chips.map((chip) => {
                const [x, y, h] = chip.dataset.src.split(',').map(Number);
                const k = screenW / Number(chip.dataset.vw);
                const w = Number(chip.dataset.cw) * k * lift;
                const ht = Number(chip.dataset.ch) * k * lift;
                const left = ox + (x - ${CHIP_PAD_CSS} * lift) * k;
                return { chip, w, ht, left, top: oy + (y + h / 2) * k - ht / 2 };
              }).sort((p, q) => p.top - q.top);
              const gap = ${Math.round(W * L.chipGap)};
              placed.forEach((item, i) => {
                for (const prev of placed.slice(0, i)) {
                  const overlapX = item.left < prev.left + prev.w && prev.left < item.left + item.w;
                  if (overlapX && item.top < prev.top + prev.ht + gap) item.top = prev.top + prev.ht + gap;
                }
              });
              for (const item of placed) {
                Object.assign(item.chip.style, { left: item.left + 'px', top: item.top + 'px', width: item.w + 'px', height: item.ht + 'px',
                  transform: 'translateZ(2px)' });
              }
              return placed.every((item) => item.left + item.w <= ox + screenW
                && item.chip.getBoundingClientRect().right <= ${W} - ${Math.round(W * L.chipEdge)});
            };
            let lift = ${f.chipLift ?? CHIP_LIFT};
            while (!layout(lift) && lift > 0.8) lift -= 0.03;
          }
        };
        })();
      </script>
    </body></html>`;
  }

  /**
   * Thicken text in a pop-out: a max (dark ground) or min (light ground)
   * filter, run across then down, so every stroke grows by `r` px a side.
   */
  async function embolden(png, r) {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const better = B.light ? Math.min : Math.max;
    const pass = (src, horizontal) => {
      const out = Buffer.alloc(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let k = 0; k < c; k++) {
            let v = src[(y * w + x) * c + k];
            for (let d = -r; d <= r; d++) {
              const xx = horizontal ? Math.min(w - 1, Math.max(0, x + d)) : x;
              const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + d));
              v = better(v, src[(yy * w + xx) * c + k]);
            }
            out[(y * w + x) * c + k] = v;
          }
        }
      }
      return out;
    };
    return sharp(pass(pass(data, true), false), { raw: { width: w, height: h, channels: c } }).png().toBuffer();
  }

  /**
   * The popped element's pixels: the rect recorded at capture time (CSS px of
   * the capture viewport), widened by a margin and cropped from the raw.
   * `crop` replaces the rect with an exact region; `trim` ({ top, bottom }, CSS
   * px) cuts rows off the rect and fits the crop to what is left; `bold` (CSS
   * px) thickens its text.
   */
  async function loadPop(rawPath, rawSize, popPath, { crop: region, trim, bold = 0 } = {}) {
    const rect = JSON.parse(fs.readFileSync(popPath, 'utf8'));
    const margin = region || trim ? 0 : POP_MARGIN;
    if (region) Object.assign(rect, region);
    if (trim) Object.assign(rect, { y: rect.y + trim.top, height: rect.height - trim.top - trim.bottom });
    const x = Math.max(0, rect.x - margin);
    const y = Math.max(0, rect.y - margin);
    const width = Math.min(rect.viewportWidth - x, rect.width + 2 * margin);
    const height = Math.min(rect.viewportHeight - y, rect.height + 2 * margin);
    const ratio = rawSize.width / rect.viewportWidth;
    const crop = {
      left: Math.round(x * ratio), top: Math.round(y * ratio),
      width: Math.min(rawSize.width - Math.round(x * ratio), Math.round(width * ratio)),
      height: Math.min(rawSize.height - Math.round(y * ratio), Math.round(height * ratio)),
    };
    const padCss = trim ? TRIM_PAD : 0;
    const pad = Math.round(padCss * ratio);
    let data = await sharp(rawPath).extract(crop).png().toBuffer();
    let box = { x, y, width, height };
    if (trim) {
      const { data: fitted, info } = await sharp(data).trim({ background: B.screenBg, threshold: 40 }).png().toBuffer({ resolveWithObject: true });
      data = fitted;
      box = { x: x - info.trimOffsetLeft / ratio, y: y - info.trimOffsetTop / ratio, width: info.width / ratio, height: info.height / ratio };
    }
    data = await sharp(data).extend({ left: pad, right: pad, top: pad, bottom: pad, background: B.screenBg }).png().toBuffer();
    if (bold) {
      const meta = await sharp(data).metadata();
      data = await embolden(await sharp(data).resize({ width: meta.width * 2 }).png().toBuffer(), Math.round(bold * ratio * 2));
    }
    return { x: box.x - padCss, y: box.y - padCss, width: box.width + 2 * padCss, height: box.height + 2 * padCss,
      viewportWidth: rect.viewportWidth, uri: `data:image/png;base64,${data.toString('base64')}` };
  }

  /** One chip: one line of text from the capture, emboldened and padded. */
  async function loadChip(rawPath, popPath, part) {
    const { viewportWidth } = JSON.parse(fs.readFileSync(popPath, 'utf8'));
    const rawSize = await sharp(rawPath).metadata();
    const ratio = rawSize.width / viewportWidth;
    const pad = Math.round(7 * ratio);
    let data = await sharp(rawPath).extract({
      left: Math.round(part.x * ratio), top: Math.round(part.y * ratio),
      width: Math.round(part.width * ratio), height: Math.round(part.height * ratio),
    }).png().toBuffer();
    const { width } = await sharp(data).metadata();
    data = await embolden(await sharp(data).resize({ width: width * 2 }).png().toBuffer(), Math.round(0.45 * ratio * 2));
    data = await sharp(data).extend({ left: pad * 2, right: pad * 2, top: pad, bottom: pad, background: B.screenBg }).png().toBuffer();
    const meta = await sharp(data).metadata();
    return { uri: `data:image/png;base64,${data.toString('base64')}`, cssW: meta.width / (ratio * 2), cssH: meta.height / (ratio * 2),
      src: [part.x, part.y, part.height], viewportWidth };
  }

  /**
   * The capture's top and bottom edge colours, which fill the status bar and
   * home indicator bands as the app's own background does on a device.
   */
  async function edgeColours(rawPath) {
    const { data, info } = await sharp(rawPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const row = (y) => {
      const sum = [0, 0, 0];
      for (let x = 0; x < info.width; x++) for (let k = 0; k < 3; k++) sum[k] += data[(y * info.width + x) * 3 + k];
      return sum.map((v) => Math.round(v / info.width));
    };
    const css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
    const bottom = row(info.height - 1);
    return { top: css(row(0)), bottom: css(bottom), bottomLight: (bottom[0] + bottom[1] + bottom[2]) / 3 > 140 };
  }

  const layerPaths = (layerDir, shot) => ({
    bg: path.join(layerDir, `${shot.name}.bg.png`),
    stage: path.join(layerDir, `${shot.name}.stage.png`),
    pops: path.join(layerDir, `${shot.name}.pops.png`),
    copy: path.join(layerDir, `${shot.name}.copy.png`),
  });

  /**
   * Render one listing image's layers into `layerDir`: the canvas, the device
   * and its pop-outs (both three panels wide, so what runs off either edge is
   * kept), and the headline. `composePoster` then builds the image, letting a
   * neighbour's phone run on across the seam. `page` is a Playwright page.
   */
  async function renderPoster(page, { rawPath, layerDir, device, shot, index, popPath }) {
    const { width: W, height: H } = device.output;
    const rawSize = await sharp(rawPath).metadata();
    if (shot.popout && !popPath) throw new Error(`Missing pop-out rect for ${shot.name}; recapture before framing`);
    const captured = popPath ? JSON.parse(fs.readFileSync(popPath, 'utf8')) : {};
    if (shot.chips && !captured.chips) throw new Error(`${shot.name}: its pop-out rect predates its chips; recapture before framing`);
    const pop = shot.popout && popPath ? await loadPop(rawPath, rawSize, popPath, { trim: shot.popTrim, bold: shot.popBold }) : null;
    const chips = [];
    for (const parts of shot.chips ? captured.chips : []) for (const part of parts) chips.push(await loadChip(rawPath, popPath, part));
    const from = index % 2 === 0 ? 'left' : 'right';
    const frame = device.frame || (device.kind === 'tablet' ? 'plain' : 'island');
    const edges = await edgeColours(rawPath);
    const html = posterHtml({ W, H, frame, rawUri: dataUri(rawPath), rawSize, edges, pop, chips, shot, index, from });

    await page.setViewportSize({ width: W, height: H });
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate((family) => document.fonts.check(`100px "${family}"`), font.family);
    if (!loaded) throw new Error(`${font.family} did not load; refusing to render a fallback face`);
    await page.evaluate(() => window.fitTitle());

    const only = (css) => page.evaluate((text) => {
      let el = document.getElementById('layer-style');
      if (!el) { el = document.createElement('style'); el.id = 'layer-style'; document.head.appendChild(el); }
      el.textContent = text;
    }, css);
    const layers = layerPaths(layerDir, shot);
    fs.mkdirSync(layerDir, { recursive: true });
    await only('#copy, #stage { visibility: hidden; }');
    fs.writeFileSync(layers.bg, await page.screenshot({ type: 'png' }));
    await only('html, body { background: transparent !important; } .canvas, #stage { visibility: hidden; }');
    fs.writeFileSync(layers.copy, await page.screenshot({ type: 'png', omitBackground: true }));
    const wide = `html, body { width: ${3 * W}px !important; background: transparent !important; }
      .canvas, #copy { visibility: hidden; } #stage { margin-left: ${W}px; }`;
    await only(`${wide} #stage .pop, #stage .chip { visibility: hidden; }`);
    await page.setViewportSize({ width: 3 * W, height: H });
    fs.writeFileSync(layers.stage, await page.screenshot({ type: 'png', omitBackground: true }));
    await only(`${wide} #stage .device, #stage .screen { visibility: hidden; }`);
    fs.writeFileSync(layers.pops, await page.screenshot({ type: 'png', omitBackground: true }));
  }

  /**
   * The brand block: the app's mark, wordmark and landing-page tagline, laid
   * out for a block `BW` px wide. The listing's first image and the creative
   * assets both draw it, so the brand is identical everywhere. `shot.brand`:
   *   capture     the brand as its landing page renders it (generate.cjs
   *               shoots it); used whole, `width` share of BW
   *   mark        optional { svg: file, size (share of BW) }: the app's mark, above
   *   wordmark    { svg: file } or { html, family, weight, italic? }
   *   width       wordmark width, a share of BW ([phone, tablet])
   *   tagline     lines; `*words*` take the accent
   *   taglineFont { family, weight, italic?, size (share of BW), accentItalic?, accentInk? }
   * Returns { css, html, fit } where `fit` is page script that sizes the
   * text; the block's element is `#brand`.
   */
  function brandBlock({ BW, shot, capture, tablet = false, align = 'center' }) {
    const b = shot.brand;
    const shadow = B.light ? 0.12 : 0.6;
    const items = align === 'center' ? 'center' : 'flex-start';
    if (capture) {
      return {
        css: `#brand { position: absolute; z-index: 4; width: ${Math.round(BW * pick(b.width ?? [0.86, 0.62], tablet))}px; }
          #brand img { display: block; width: 100%; filter: drop-shadow(0 ${BW * 0.006}px ${BW * 0.02}px rgba(0,0,0,${shadow})); }`,
        html: `<div id="brand"><img src="${dataUri(capture)}" alt=""></div>`,
        fit: '',
      };
    }
    const wordW = Math.round(BW * pick(b.width ?? [0.78, 0.6], tablet));
    const wordmark = !b.wordmark ? '' : b.wordmark.svg
      ? `<img id="wordmark" src="data:image/svg+xml;base64,${fs.readFileSync(b.wordmark.svg).toString('base64')}" style="width:${wordW}px" alt="">`
      : `<div id="wordmark" class="word" style="font-family:'${b.wordmark.family}';font-weight:${b.wordmark.weight};font-style:${b.wordmark.italic ? 'italic' : 'normal'}">${b.wordmark.html}</div>`;
    const tf = b.taglineFont;
    const gap = Math.round(BW * (tablet ? 0.047 : 0.065));
    const mark = b.mark
      ? `<img id="mark" src="data:image/svg+xml;base64,${fs.readFileSync(b.mark.svg).toString('base64')}" style="width:${Math.round(BW * pick(b.mark.size, tablet))}px;margin-bottom:${gap}px" alt="">`
      : '';
    return {
      css: `#brand { position: absolute; z-index: 4; width: ${BW}px; display: flex; flex-direction: column; align-items: ${items}; text-align: ${align}; }
        #mark { display: block; filter: drop-shadow(0 ${BW * 0.01}px ${BW * 0.03}px rgba(0,0,0,${shadow})); }
        #wordmark { display: block; filter: drop-shadow(0 ${BW * 0.006}px ${BW * 0.02}px rgba(0,0,0,${shadow})); }
        .word { color: ${B.text}; line-height: 1; letter-spacing: -0.02em; white-space: nowrap; }
        .word b { color: ${B.ink}; font-weight: inherit; }
        .tagline { margin-top: ${gap}px; font-family: '${tf.family}'; font-weight: ${tf.weight};
          font-style: ${tf.italic ? 'italic' : 'normal'}; color: ${B.text}; line-height: 1.12; letter-spacing: -0.015em;
          text-shadow: ${B.light ? 'none' : '0 0.04em 0.12em rgba(0,0,0,0.8)'}; }
        .tagline span { display: block; white-space: nowrap; }
        .tagline em { font-style: ${tf.accentItalic ? 'italic' : 'inherit'}; ${tf.accentInk === false ? '' : `color: ${B.ink}; ${accentCss}`}
          ${tf.accentWeight ? `font-weight: ${tf.accentWeight};` : ''} ${tf.accentScale ? `font-size: ${tf.accentScale}em;` : ''} }`,
      html: `<div id="brand">${mark}${wordmark}<div class="tagline" id="tagline">${accentHtml(b.tagline)}</div></div>`,
      fit: `(() => {
          const fit = (el, start, maxW) => {
            let size = start;
            el.style.fontSize = size + 'px';
            while (size > 20 && Array.from(el.children.length ? el.children : [el]).some((c) => c.scrollWidth > maxW)) { size -= 2; el.style.fontSize = size + 'px'; }
          };
          const word = document.querySelector('.word');
          if (word) fit(word, ${Math.round(BW * 0.6)}, ${wordW});
          fit(document.getElementById('tagline'), ${Math.round(BW * (tf.size ?? 0.085) * (tablet ? 0.8 : 1))}, ${Math.round(BW * 0.96)});
        })();`,
    };
  }

  /**
   * The listing's first image: the brand block on the listing canvas, no
   * phone, centred a little above the middle (`brand.centre`).
   */
  function brandHtml({ W, H, index, shot, capture }) {
    const tablet = H / W < 1.6;
    const block = brandBlock({ BW: W, shot, capture, tablet });
    return `<!doctype html><html><head><meta charset="utf-8">
    <style>
      ${FONT_FACE}
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
      body { position: relative; background: ${B.ground[1]}; }
      .canvas { position: absolute; inset: 0; }
      ${block.css}
    </style></head><body>
      ${listingCanvas(W, H, index, tablet, Math.round(W * L.seamGap))}
      ${block.html}
      <script>
        window.fitTitle = () => {
          ${block.fit}
          const brand = document.getElementById('brand');
          brand.style.left = Math.round((${W} - brand.offsetWidth) / 2) + 'px';
          brand.style.top = Math.round(${H} * ${shot.brand.centre ?? 0.42} - brand.offsetHeight / 2) + 'px';
        };
      </script>
    </body></html>`;
  }

  /**
   * Render the brand image's layers: everything on the canvas layer, empty
   * phone layers (so a neighbour's phone may still run in across the seam).
   */
  async function renderBrand(page, { layerDir, device, shot, index, capture }) {
    const { width: W, height: H } = device.output;
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(brandHtml({ W, H, index, shot, capture }), { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.fitTitle());
    const layers = layerPaths(layerDir, shot);
    fs.mkdirSync(layerDir, { recursive: true });
    fs.writeFileSync(layers.bg, await page.screenshot({ type: 'png' }));
    const clear = (w) => sharp({ create: { width: w, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    fs.writeFileSync(layers.copy, await clear(W));
    fs.writeFileSync(layers.stage, await clear(3 * W));
    fs.writeFileSync(layers.pops, await clear(3 * W));
  }

  /** How far (px) a neighbour's spill reaches into an image from its seam. */
  async function spillReach(png, from) {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    for (let k = w - 1; k >= 0; k--) {
      const x = from === 'left' ? k : w - 1 - k;
      for (let y = 0; y < h; y += 2) if (data[(y * w + x) * c + 3] > 24) return k + 1;
    }
    return 0;
  }

  /**
   * Build one listing image from its layers and its neighbours'. Where two
   * phones meet, the one with the higher `place.layer` is on top in both
   * images (on a tie, the later one); pop-outs sit over every phone, the
   * headline over all.
   */
  async function composePoster({ layerDir, outPath, device, shot, prev, next }) {
    const { width: W, height: H } = device.output;
    const own = layerPaths(layerDir, shot);
    const gap = Math.round(W * L.seamGap);
    const spill = async (neighbour, side, kind = 'stage') => {
      const file = neighbour && layerPaths(layerDir, neighbour)[kind];
      if (!file || !fs.existsSync(file)) return [];
      const isOwn = side === 'own';
      const [from, width, at] = isOwn ? [W, W, 0] : side === 'prev' ? [2 * W + gap, W - gap, 0] : [0, W - gap, gap];
      const input = await sharp(file).extract({ left: from, top: 0, width, height: H }).png().toBuffer();
      if (!isOwn && (await spillReach(input, side === 'prev' ? 'left' : 'right')) < W * L.minSpill) return [];
      return [{ input, left: at, top: 0 }];
    };
    const layer = (s) => s.place?.layer ?? 0;
    const onTop = (neighbour, later) =>
      layer(neighbour) > layer(shot) || (layer(neighbour) === layer(shot) && later);
    const stack = async (kind) => {
      const under = [];
      const over = [];
      if (prev) (onTop(prev, false) ? over : under).push(...(await spill(prev, 'prev', kind)));
      if (next) (onTop(next, true) ? over : under).push(...(await spill(next, 'next', kind)));
      return [...under, ...(await spill(shot, 'own', kind)), ...over];
    };
    const out = await sharp(own.bg)
      .composite([...(await stack('stage')), ...(await stack('pops')), { input: own.copy, left: 0, top: 0 }])
      .flatten({ background: B.ground[1] }).removeAlpha().png().toBuffer();
    const meta = await sharp(out).metadata();
    if (meta.width !== W || meta.height !== H) {
      throw new Error(`Output size mismatch: got ${meta.width}x${meta.height}, want ${W}x${H}`);
    }
    // A synced folder (OneDrive) can briefly lock a file it is uploading.
    for (let attempt = 1; ; attempt++) {
      try { fs.writeFileSync(outPath, out); return; } catch (error) {
        if (attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  /**
   * Product page header and search result images (App Store Connect creative
   * assets). Apple asks for one clear idea, a centred focal point and only a
   * short phrase, so each is the brand block (the same one the listing opens
   * with) beside a row of whole, upright phones, all inside `safe`: the share
   * of the canvas every placement keeps (the 16:9 universal asset is cropped
   * to 21:9 for the header and 3:2 for search). Nothing overlaps, and no
   * phone is cut by an edge.
   */
  const CREATIVE_LAYOUTS = [
    { name: 'header-21x9', width: 3840, height: 1646, safe: [1, 1], count: 3 },
    { name: 'search-3x2', width: 3840, height: 2560, safe: [1, 1], count: 2 },
    { name: 'universal-16x9', width: 5244, height: 2950, safe: [(2950 * 3 / 2) / 5244, (5244 * 9 / 21) / 2950], count: 2 },
  ];
  // A framed island phone's height over its width (deviceStage's bezels).
  const DEVICE_RATIO = (1 - 2 * 0.024) * PHONE_ASPECT + 2 * 0.024;

  /**
   * The creatives' text column: what the app does for you, not the brand. The
   * app's square icon (rounded as iOS rounds it) over a plain value headline
   * in the listing's caption face, `*words*` in the accent. `copy` comes from
   * the story's `creativeCopy`: { icon: file, headline: lines }.
   */
  function copyBlock({ BW, copy }) {
    const icon = Math.round(BW * 0.22);
    return {
      css: `#brand { position: absolute; z-index: 4; width: ${BW}px; display: flex; flex-direction: column; align-items: flex-start; }
        #brand .icon { width: ${icon}px; height: ${icon}px; border-radius: ${Math.round(icon * 0.225)}px; overflow: hidden;
          box-shadow: 0 ${icon * 0.06}px ${icon * 0.2}px rgba(0,0,0,${B.light ? 0.18 : 0.6}), inset 0 0 0 1px rgba(${B.light ? '0,0,0,0.08' : '255,255,255,0.14'}); }
        #brand .icon img { display: block; width: 100%; height: 100%; }
        #brand h1 { margin: ${Math.round(BW * 0.07)}px 0 0; ${titleCss} line-height: ${font.lineHeight}; color: ${B.text}; text-shadow: ${SHADOW.title}; }
        #brand h1 span { display: block; white-space: nowrap; }
        /* A line written \`!words\` is the one to read first: larger and heavier. */
        #brand h1 span.big { font-size: ${copy.bigScale ?? 1.4}em; font-weight: 900; line-height: 1.05; margin: 0.08em 0 0.1em; }
        /* Around a big line, the others step back (lighter, a touch muted) so the lines never blend. */
        #brand h1:has(.big) span:not(.big) { font-weight: 400; opacity: 0.78; }
        #brand h1 em { font-style: ${font.italicAccent ? 'italic' : 'normal'}; color: ${B.ink}; text-shadow: ${SHADOW.accent}; ${accentCss} }`,
      // `wordmark` ({ svg } or { html, family, weight }) leads instead of the icon.
      html: `<div id="brand">${copy.wordmark?.svg
          ? `<img class="cw" src="data:image/svg+xml;base64,${fs.readFileSync(copy.wordmark.svg).toString('base64')}" style="width:${Math.round(BW * (copy.wordmark.width ?? 0.5))}px" alt="">`
          : copy.wordmark
            ? `<div class="cw" style="font-family:'${copy.wordmark.family}';font-weight:${copy.wordmark.weight};font-size:${Math.round(BW * (copy.wordmark.size ?? 0.2))}px;line-height:1;color:${B.text}">${copy.wordmark.html}</div>`
            : `<div class="icon"><img src="data:image/svg+xml;base64,${fs.readFileSync(copy.icon).toString('base64')}" alt=""></div>`}
        <h1 id="copy-title">${accentHtml(copy.headline)}</h1></div>`,
      fit: `(() => {
          const el = document.getElementById('copy-title');
          let size = ${Math.round(BW * 0.2)};
          el.style.fontSize = size + 'px';
          // Italic overhang runs past the box, so lines keep a margin.
          while (size > 20 && Array.from(el.children).some((c) => c.scrollWidth > ${Math.round(BW * 0.88)})) { size -= 2; el.style.fontSize = size + 'px'; }
        })();`,
    };
  }

  /**
   * `style` (the story's `creativeStyle`) can liven the row: `fan` tilts the
   * outer phones in toward the middle one, which stands taller in front;
   * `pops` lifts each phone's pop-out (its listing highlight) off the screen.
   */
  function creativeHtml({ W, H, safe, count, phones, shot, capture, copy, style = {} }) {
    const sw = W * safe[0];
    const sh = H * safe[1];
    const sx = (W - sw) / 2;
    const sy = (H - sh) / 2;
    // Brand column on the left, phones on the right.
    const colX = sx + sw * 0.03;
    const colW = sw * (style.big ? 0.4 : 0.46);
    const areaX = sx + sw * (style.big ? 0.42 : 0.5);
    const areaW = sw * (style.big ? 0.58 : 0.48);
    const n = Math.min(count, phones.length);
    // A fan overlaps its phones a little, so they read as one group.
    const gap = style.fan ? -sw * (style.big ? 0.035 : 0.012) : sw * 0.025;
    const deviceH = Math.min(sh * (style.fan ? (style.big ? 0.9 : 0.8) : 0.86), ((areaW - gap * (n - 1)) / n) * DEVICE_RATIO);
    const deviceW = Math.round(deviceH / DEVICE_RATIO);
    const rowW = n * deviceW + (n - 1) * gap;
    const mid = (n - 1) / 2;
    const stages = phones.slice(0, n).map((phone, i) => {
      // The middle phone (or every other one) sits a little higher.
      const lift = (n === 3 ? i === 1 : i % 2 === 1) ? sh * 0.035 : 0;
      const side = Math.sign(mid - i);
      const tilt = style.fan && side
        ? `rotateZ(${-4 * side}deg) rotateY(${16 * side}deg) rotateX(5deg)`
        : style.fan ? 'rotateX(5deg)' : 'rotateX(0deg)';
      // A big fan pops only its front phone, so the highlight reads at a glance.
      const pop = style.pops && (!style.big || !side) ? phone.pop : null;
      const stage = deviceStage({
        id: `phone${i}`, unit: deviceW * 1.6, aspect: PHONE_ASPECT, deviceW, frame: 'island',
        rawUri: phone.rawUri, rawSize: phone.rawSize, edges: phone.edges, pop, side: side || 1,
        // The middle phone stands in front of a fan.
        z: style.fan && !side ? 4 : 3, popMinW: deviceW * 1.08, popMaxW: deviceW * 1.22,
        tilt, left: Math.round(areaX + (areaW - rowW) / 2 + i * (deviceW + gap)),
      });
      const top = Math.round(sy + (sh - deviceH) / 2 - lift + sh * 0.0175);
      return { ...stage, css: `${stage.css}\n#phone${i} { top: ${top}px; }` };
    });
    const block = copy ? copyBlock({ BW: Math.round(colW), copy }) : brandBlock({ BW: Math.round(colW), shot, capture, align: 'center' });
    return `<!doctype html><html><head><meta charset="utf-8">
    <style>
      ${FONT_FACE}
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
      body { position: relative; background: ${B.ground[1]}; }
      .canvas { position: absolute; inset: 0; }
      ${block.css}
      ${stages.map((stage) => stage.css).join('\n')}
    </style></head><body>
      ${listingCanvas(W, H, 0, false)}
      ${`<div class="veil" style="position:absolute;z-index:3;left:0;top:0;bottom:0;width:${Math.round(areaX)}px;
        background:linear-gradient(90deg, ${B.ground[1]} 72%, transparent)"></div>`}
      ${block.html}
      ${stages.map((stage) => stage.html).join('\n')}
      <script>
        window.fitTitle = () => {
          ${block.fit}
          const brand = document.getElementById('brand');
          brand.style.left = Math.round(${colX} + (${colW} - brand.offsetWidth) / 2) + 'px';
          brand.style.top = Math.round(${sy} + (${sh} - brand.offsetHeight) / 2) + 'px';
        };
      </script>
    </body></html>`;
  }

  /**
   * Render the creative assets from the 6.9" captures. `creative` (story.cjs)
   * names the shots each asset shows, left to right; `brandShot` is the
   * listing's brand image, whose block leads every asset.
   */
  async function renderCreativeAssets(page, { rawDir, outDir, creative, brandShot, brandCapture, copy, style = {} }) {
    fs.mkdirSync(outDir, { recursive: true });
    const loaded = new Map();
    const load = async (name) => {
      if (loaded.has(name)) return loaded.get(name);
      const rawPath = path.join(rawDir, `${name}.png`);
      if (!fs.existsSync(rawPath)) throw new Error(`Creative assets need ${name} captured`);
      const rawSize = await sharp(rawPath).metadata();
      const popPath = path.join(rawDir, `${name}.popout.json`);
      const entry = { rawUri: dataUri(rawPath), rawSize, edges: await edgeColours(rawPath),
        pop: style.pops && fs.existsSync(popPath) ? await loadPop(rawPath, rawSize, popPath, {}) : null };
      loaded.set(name, entry);
      return entry;
    };
    const written = [];
    for (const layout of CREATIVE_LAYOUTS) {
      const spec = creative[layout.name];
      if (!spec) continue;
      const { width: W, height: H } = layout;
      const phones = [];
      for (const name of spec.phones.slice(0, layout.count)) phones.push(await load(name));
      await page.setViewportSize({ width: W, height: H });
      await page.setContent(creativeHtml({ W, H, safe: layout.safe, count: layout.count, phones, shot: brandShot, capture: brandCapture, copy, style }),
        { waitUntil: 'load', timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.fitTitle());
      const outPath = path.join(outDir, `${layout.name}.png`);
      await sharp(await page.screenshot({ type: 'png' })).flatten({ background: B.ground[1] }).removeAlpha().png().toFile(outPath);
      written.push(outPath);
    }
    return written;
  }

  return { renderPoster, renderBrand, composePoster, renderCreativeAssets };
}

module.exports = { createPoster, LAYOUT, FONT_STACK };
