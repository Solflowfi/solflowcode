/**
 * SOLFLOW official brand asset generator.
 * Builds vector logos (SVG) and renders high-resolution PNGs into /public/brand.
 * Pure geometric paths — no font dependencies, fully deterministic output.
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'brand');
mkdirSync(outDir, { recursive: true });

/* ---------- helpers ---------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** polygon with rounded corners -> svg path data */
function roundedPoly(pts, r) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const v1 = norm(sub(p1, p0));
    const v2 = norm(sub(p2, p1));
    const a = [p1[0] - v1[0] * r, p1[1] - v1[1] * r];
    const b = [p1[0] + v2[0] * r, p1[1] + v2[1] * r];
    d += (i === 0 ? `M ${a[0]} ${a[1]} ` : `L ${a[0]} ${a[1]} `);
    d += `Q ${p1[0]} ${p1[1]} ${b[0]} ${b[1]} `;
  }
  return d + 'Z';
}

/* ---------- shared geometry (512 design space) ---------- */

const SHIELD = [
  [128, 68], [384, 68], [466, 256], [384, 444], [128, 444], [46, 256],
];
const shieldPath = roundedPoly(SHIELD, 34);
const shieldInner = roundedPoly(
  SHIELD.map(([x, y]) => [256 + (x - 256) * 0.9, 256 + (y - 256) * 0.9]),
  30
);

const S_PATH =
  'M 330 172 H 232 Q 174 172 174 230 Q 174 288 232 288 H 280 Q 338 288 338 346 Q 338 404 280 404 H 182';

const GRADIENT_DEFS = `
  <linearGradient id="sf-mark" x1="60" y1="80" x2="452" y2="440" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#9945FF"/>
    <stop offset="0.5" stop-color="#00B7E8"/>
    <stop offset="1" stop-color="#14F195"/>
  </linearGradient>
  <linearGradient id="sf-frame" x1="46" y1="68" x2="466" y2="444" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#9D59FF"/>
    <stop offset="0.5" stop-color="#26C6E9"/>
    <stop offset="1" stop-color="#25D8A2"/>
  </linearGradient>
  <filter id="sf-soft" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="16"/>
  </filter>
`;

/**
 * The S core + shield + circuit details.
 * `color` = 'gradient' | '#ffffff' | '#0b0e17'
 */
function markGroup(color) {
  const sStroke = color === 'gradient' ? 'url(#sf-mark)' : color;
  const frameStroke = color === 'gradient' ? 'url(#sf-frame)' : color;
  const mono = color !== 'gradient';
  const glow = mono
    ? ''
    : `<path d="${S_PATH}" fill="none" stroke="${sStroke}" stroke-width="54" stroke-linecap="round" stroke-linejoin="round" opacity="0.28" filter="url(#sf-soft)"/>`;
  return `
  ${glow}
  <path d="${shieldPath}" fill="none" stroke="${frameStroke}" stroke-width="15" stroke-linejoin="round"/>
  <path d="${shieldInner}" fill="none" stroke="${mono ? color : 'rgba(148,163,184,0.22)'}" opacity="${mono ? 0.4 : 0.35}" stroke-width="3"/>
  <g stroke-linecap="round" stroke-width="7">
    <line x1="24" y1="216" x2="46" y2="216" stroke="${mono ? color : '#9945FF'}"/>
    <line x1="16" y1="256" x2="40" y2="256" stroke="${mono ? color : '#00B7E8'}"/>
    <line x1="24" y1="296" x2="46" y2="296" stroke="${mono ? color : '#14F195'}"/>
    <line x1="466" y1="216" x2="488" y2="216" stroke="${mono ? color : '#9945FF'}"/>
    <line x1="472" y1="256" x2="496" y2="256" stroke="${mono ? color : '#00B7E8'}"/>
    <line x1="466" y1="296" x2="488" y2="296" stroke="${mono ? color : '#14F195'}"/>
  </g>
  <g fill="none" stroke="${sStroke}" stroke-width="5" opacity="0.55" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 330 172 H 386 V 132"/>
    <path d="M 182 404 H 126 V 444"/>
  </g>
  <circle cx="386" cy="126" r="7" fill="${sStroke}"/>
  <circle cx="126" cy="450" r="7" fill="${sStroke}"/>
  <circle cx="146" cy="256" r="6" fill="${sStroke}" opacity="0.55"/>
  <circle cx="366" cy="256" r="6" fill="${sStroke}" opacity="0.55"/>
  <path d="${S_PATH}" fill="none" stroke="${sStroke}" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

function iconSvg(color = 'gradient') {
  const defs = color === 'gradient' ? GRADIENT_DEFS : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs}
  ${markGroup(color)}
</svg>`;
}

/* ---------- wordmark (custom geometric letterforms, cap y12..68) ---------- */

const LETTERS = {
  S: { w: 60, d: 'M 46 12 H 24 Q 10 12 10 26 Q 10 40 24 40 H 36 Q 50 40 50 54 Q 50 68 36 68 H 14' },
  O: { w: 60, rect: { x: 6.5, y: 12.5, w: 47, h: 55, r: 21 } },
  L: { w: 52, d: 'M 20 12 V 61 Q 20 68 27 68 H 52' },
  F: { w: 52, d: 'M 52 12 H 20 V 68 M 20 39 H 44' },
  W: { w: 74, d: 'M 12 12 L 23 68 L 37 36 L 51 68 L 62 12' },
};

function wordmarkGroup(color, gradientId) {
  const stroke = gradientId ? `url(#${gradientId})` : color;
  const seq = ['S', 'O', 'L', 'F', 'L', 'O', 'W'];
  let x = 6;
  let out = '';
  for (const ch of seq) {
    const L = LETTERS[ch];
    if (L.rect) {
      out += `<rect x="${x + L.rect.x}" y="${L.rect.y}" width="${L.rect.w}" height="${L.rect.h}" rx="${L.rect.r}" fill="none" stroke="${stroke}" stroke-width="13"/>`;
    } else {
      out += `<path d="${L.d}" fill="none" stroke="${stroke}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    x += L.w + 24;
  }
  return { body: out, width: x - 24 + 6 };
}

function wordmarkSvg(color = 'gradient') {
  const grad =
    color === 'gradient'
      ? `<linearGradient id="sf-word" x1="0" y1="0" x2="500" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#9945FF"/>
          <stop offset="0.5" stop-color="#00B7E8"/>
          <stop offset="1" stop-color="#14F195"/>
        </linearGradient>`
      : '';
  const { body, width } = wordmarkGroup(color, color === 'gradient' ? 'sf-word' : null);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 80">
  ${grad}
  ${body}
</svg>`;
}

/* ---------- primary lockup: icon + wordmark ---------- */

function primarySvg(color = 'gradient') {
  const mono = color !== 'gradient';
  const defs = mono
    ? ''
    : GRADIENT_DEFS.replaceAll('sf-mark', 'p-mark')
        .replaceAll('sf-frame', 'p-frame')
        .replaceAll('sf-soft', 'p-soft');
  const group = markGroup(color)
    .replaceAll('url(#sf-mark)', mono ? color : 'url(#p-mark)')
    .replaceAll('url(#sf-frame)', mono ? color : 'url(#p-frame)')
    .replaceAll('url(#sf-soft)', 'url(#p-soft)');
  const grad = mono
    ? ''
    : `<linearGradient id="p-word" x1="608" y1="0" x2="2140" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#9945FF"/>
        <stop offset="0.55" stop-color="#00B7E8"/>
        <stop offset="1" stop-color="#14F195"/>
      </linearGradient>`;
  const { body, width } = wordmarkGroup(color, mono ? null : 'p-word');
  const wordScale = 260 / 80;
  const wordW = width * wordScale;
  const totalW = 512 + 96 + wordW + 8;
  const wordY = (512 - 80 * wordScale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} 512">
  ${defs}
  ${grad}
  <g>${group}</g>
  <g transform="translate(${512 + 96}, ${wordY}) scale(${wordScale})">${body}</g>
</svg>`;
}

/* ---------- square app icon (dark premium background) ---------- */

function appIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048">
  ${GRADIENT_DEFS}
  <defs>
    <radialGradient id="sf-bg" cx="0.3" cy="0.25" r="1.1">
      <stop offset="0" stop-color="#181d33"/>
      <stop offset="0.55" stop-color="#0c0f1c"/>
      <stop offset="1" stop-color="#05060a"/>
    </radialGradient>
    <radialGradient id="sf-tint-a" cx="0.18" cy="0.14" r="0.55">
      <stop offset="0" stop-color="#9945FF" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#9945FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sf-tint-b" cx="0.86" cy="0.9" r="0.6">
      <stop offset="0" stop-color="#14F195" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#14F195" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="sf-squircle">
      <rect x="0" y="0" width="2048" height="2048" rx="460"/>
    </clipPath>
  </defs>
  <g clip-path="url(#sf-squircle)">
    <rect width="2048" height="2048" fill="url(#sf-bg)"/>
    <rect width="2048" height="2048" fill="url(#sf-tint-a)"/>
    <rect width="2048" height="2048" fill="url(#sf-tint-b)"/>
    <g transform="translate(430, 430) scale(2.32)">
      ${markGroup('gradient')}
    </g>
  </g>
</svg>`;
}

/* ---------- render + write ---------- */

function renderPng(svg, file, width) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  writeFileSync(join(outDir, file), resvg.render().asPng());
  console.log(`png  ${file}  (${width}px wide)`);
}

function writeSvg(svg, file) {
  writeFileSync(join(outDir, file), svg, 'utf8');
  console.log(`svg  ${file}`);
}

const jobs = [
  ['solflow-logo-icon', iconSvg('gradient'), 2048],
  ['solflow-logo-primary', primarySvg('gradient'), 4096],
  ['solflow-logo-wordmark', wordmarkSvg('gradient'), 4096],
  ['solflow-app-icon', appIconSvg(), 2048],
  ['solflow-logo-white', primarySvg('#FFFFFF'), 4096],
  ['solflow-logo-black', primarySvg('#0B0E17'), 4096],
  ['solflow-logo-icon-white', iconSvg('#FFFFFF'), 2048],
  ['solflow-logo-icon-black', iconSvg('#0B0E17'), 2048],
];

for (const [name, svg, width] of jobs) {
  writeSvg(svg, `${name}.svg`);
  renderPng(svg, `${name}.png`, width);
}

console.log('DONE — all brand assets generated.');



