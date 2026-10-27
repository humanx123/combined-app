/**
 * The iOS status bar drawn over the top of a framed capture. A headless
 * browser has no OS chrome, so this strip is what makes a framed capture read
 * as the app running on a phone rather than a website in a rounded box.
 * Ported from ChatRPE's scripts/lib/marketing.js; `ink` lets a light app draw
 * dark status text.
 */
const SYSTEM_UI_FONT = { win32: 'Segoe UI', darwin: 'SF Pro Text' }[process.platform] || 'Roboto';
const FONT_STACK = `${SYSTEM_UI_FONT}, system-ui, ui-sans-serif, Helvetica Neue, Arial, sans-serif`;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `kind`: 'phone' (Dynamic Island), 'home' (home-button iPhone) or 'tablet'. */
function statusBarHeight(dev, kind) {
  return Math.round(dev.w * (kind === 'phone' ? 0.122 : kind === 'home' ? 0.053 : 0.042));
}

function statusBarSvg(dev, { kind = 'phone', time = '9:41', ink = '#ffffff' } = {}) {
  const band = statusBarHeight(dev, kind);
  const phone = kind === 'phone';
  const centred = kind === 'home';
  const fontSize = Math.round(band * (phone ? 0.4 : 0.62));
  const baseline = phone ? Math.round(band * 0.66) : Math.round(band * 0.72);
  const sideInset = Math.round(dev.w * (phone ? 0.085 : 0.035));

  // Right cluster: cellular bars, wifi, battery, each placed from its painted bounds.
  const iconH = Math.round(fontSize * 0.72);
  const iconGap = Math.round(iconH * 0.65);
  const batteryW = Math.round(iconH * 1.95);
  const batteryH = Math.round(iconH * 0.92);
  const batteryX = dev.w - sideInset - batteryW - Math.ceil(batteryH * 0.32);
  const batteryY = baseline - batteryH + Math.round(batteryH * 0.16);
  const wifiR = iconH * 0.55;
  const wifiStroke = Math.max(2, iconH * 0.17);
  const wifiHalfW = wifiR + wifiStroke / 2;
  const wifiX = batteryX - batteryH * 0.055 - iconGap - wifiHalfW;
  const barW = Math.round(iconH * 0.22);
  const barGap = Math.round(iconH * 0.16);
  const barsW = 4 * barW + 3 * barGap;
  const barsX = wifiX - wifiHalfW - iconGap - barsW;
  const bars = [0.42, 0.62, 0.82, 1]
    .map((scale, i) => {
      const h = Math.round(iconH * scale);
      return `<rect x="${barsX + i * (barW + barGap)}" y="${baseline - h}" width="${barW}" height="${h}" rx="${Math.round(barW * 0.35)}" fill="${ink}"/>`;
    })
    .join('');
  const wifi = `
    <path d="M ${wifiX - wifiR} ${baseline - wifiR * 0.75} A ${wifiR * 1.35} ${wifiR * 1.35} 0 0 1 ${wifiX + wifiR} ${baseline - wifiR * 0.75}"
      fill="none" stroke="${ink}" stroke-width="${wifiStroke}" stroke-linecap="round"/>
    <path d="M ${wifiX - wifiR * 0.55} ${baseline - wifiR * 0.25} A ${wifiR * 0.75} ${wifiR * 0.75} 0 0 1 ${wifiX + wifiR * 0.55} ${baseline - wifiR * 0.25}"
      fill="none" stroke="${ink}" stroke-width="${wifiStroke}" stroke-linecap="round"/>
    <circle cx="${wifiX}" cy="${baseline - wifiR * 0.02}" r="${Math.max(1.5, iconH * 0.1)}" fill="${ink}"/>`;
  const battery = `
    <rect x="${batteryX}" y="${batteryY}" width="${batteryW}" height="${batteryH}" rx="${Math.round(batteryH * 0.32)}"
      fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="${Math.max(2, batteryH * 0.11)}"/>
    <rect x="${batteryX + batteryH * 0.16}" y="${batteryY + batteryH * 0.22}" width="${(batteryW - batteryH * 0.32) * 0.82}" height="${batteryH * 0.56}"
      rx="${Math.round(batteryH * 0.18)}" fill="${ink}"/>
    <path d="M ${batteryX + batteryW + batteryH * 0.12} ${batteryY + batteryH * 0.32}
      a ${batteryH * 0.2} ${batteryH * 0.2} 0 0 1 0 ${batteryH * 0.36}z" fill="${ink}" fill-opacity="0.55"/>`;
  const island = phone
    ? (() => {
        const iw = Math.round(dev.w * 0.283);
        const ih = Math.round(dev.w * 0.084);
        const ix = Math.round((dev.w - iw) / 2);
        const iy = Math.round(dev.w * 0.026);
        const lensR = Math.round(ih * 0.22);
        return `
          <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="${ih / 2}" fill="#000000"/>
          <circle cx="${ix + iw - ih * 0.52}" cy="${iy + ih / 2}" r="${lensR}" fill="#0b0f1a"/>
          <circle cx="${ix + iw - ih * 0.52}" cy="${iy + ih / 2}" r="${lensR * 0.45}" fill="#16203a"/>`;
      })()
    : '';
  return `<svg width="${dev.w}" height="${Math.max(band, Math.round(dev.w * 0.13))}" xmlns="http://www.w3.org/2000/svg">
    <text x="${centred ? dev.w / 2 : sideInset}" y="${baseline}" font-size="${fontSize}" font-family="${FONT_STACK}"
      font-weight="700" fill="${ink}"${centred ? ' text-anchor="middle"' : ''}>${esc(time)}</text>
    ${bars}${wifi}${battery}${island}
  </svg>`;
}

/**
 * The bottom safe area: home indicator and curved corners (34pt of a 440pt
 * iPhone, 20pt of a 1032pt iPad). Nothing interactive belongs in it.
 */
function homeAreaHeight(dev, kind) {
  return Math.round(dev.w * (kind === 'phone' ? 0.077 : kind === 'home' ? 0 : 0.0194));
}

module.exports = { statusBarSvg, statusBarHeight, homeAreaHeight, FONT_STACK };
