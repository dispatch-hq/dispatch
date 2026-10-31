// Regenerates src/cards/assets.bin, the prebuilt pieces the message images are
// stamped from: the logo and wordmark, and every character in every text style.
//
//   node scripts/build-card-assets.mjs
//
// Rasterising these at request time would cost far more CPU than the Workers Free
// plan allows, so it happens once, here. The output is committed; this only needs
// running after changing the look (src/cards/spec.ts, or the header below).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import opentype from 'opentype.js';
import {
  BACKGROUND,
  BACKGROUND_INDEX,
  BORDER_INDEX,
  CHARS,
  COLOR_NAMES,
  COLORS,
  COVERAGE_LEVELS,
  DIM_INDEX,
  HEADER_HEIGHT,
  HEADER_WORDS,
  KERN_CHARS,
  METRIC_WORDS,
  PALETTE_ENTRIES,
  rampIndex,
  solidIndex,
  STYLES,
  tintIndex,
  WIDTH,
} from '../src/cards/spec.ts';

const root = join(import.meta.dirname, '..');
await initWasm(readFileSync(join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));

function loadFont(path) {
  const file = readFileSync(join(root, 'node_modules', path));
  return opentype.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
}

const FONTS = {
  'fraunces-400': loadFont('@fontsource/fraunces/files/fraunces-latin-400-normal.woff'),
  'dm-sans-400': loadFont('@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff'),
  'dm-sans-600': loadFont('@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff'),
};

/**
 * SVG path data for an opentype.js path. Its own `toPathData` writes `NaN` for some
 * coordinates at some sizes, and a renderer silently stops drawing at the first one,
 * cutting letters off. A bad coordinate here stops the build instead.
 */
function pathData(path) {
  const number = (value) => {
    if (!Number.isFinite(value)) throw new Error(`Bad coordinate in glyph path: ${value}`);
    return value.toFixed(3);
  };
  return path.commands
    .map((c) => {
      if (c.type === 'M' || c.type === 'L') return `${c.type}${number(c.x)} ${number(c.y)}`;
      if (c.type === 'Q') return `Q${number(c.x1)} ${number(c.y1)} ${number(c.x)} ${number(c.y)}`;
      if (c.type === 'C') return `C${number(c.x1)} ${number(c.y1)} ${number(c.x2)} ${number(c.y2)} ${number(c.x)} ${number(c.y)}`;
      if (c.type === 'Z') return 'Z';
      throw new Error(`Unknown path command: ${c.type}`);
    })
    .join('');
}

/** Draws white shapes on nothing, and returns how much each pixel is covered, 0 to COVERAGE_LEVELS. */
function coverageOf(width, height, shapes) {
  const resvg = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes}</svg>`);
  const image = resvg.render();
  const { pixels } = image;
  const coverage = new Uint8Array(width * height);
  for (let p = 0; p < coverage.length; p++) coverage[p] = Math.round((pixels[p * 4 + 3] / 255) * COVERAGE_LEVELS);
  image.free();
  resvg.free();
  return coverage;
}

/* -------------------------------------------------------------------------- */
/*                                   Header                                   */
/* -------------------------------------------------------------------------- */

const MARGIN = 64;

// The logo (site/public/logo.svg) and wordmark that start every card, laid out as
// finished PNG rows, each with its filter byte, ready to copy to the top of a card.
function buildHeader() {
  const logo =
    `<mask id="m" maskUnits="userSpaceOnUse" x="110" y="95" width="280" height="310"><rect x="110" y="95" width="280" height="310" fill="#fff"/><rect x="218" y="215" width="65" height="33" fill="#000"/><rect x="218" y="282" width="65" height="33" fill="#000"/></mask>` +
    `<g transform="translate(${MARGIN} 50) scale(0.13) translate(-110 -95)" fill="#fff"><g mask="url(#m)"><rect x="115" y="183" width="270" height="33"/><rect x="115" y="249" width="270" height="33"/><rect x="115" y="316" width="270" height="33"/><ellipse cx="250" cy="266" rx="100" ry="135"/><path d="M168 125 190 102 242 152 220 174Z"/><path d="M332 125 310 102 258 152 280 174Z"/></g></g>`;
  const wordmark = `<path d="${pathData(FONTS['fraunces-400'].getPath('Dispatch', MARGIN + 46, 82, 36))}" fill="#fff"/>`;

  const rows = new Uint8Array((WIDTH + 1) * HEADER_HEIGHT);
  const stamp = (coverage, color) => {
    coverage.forEach((level, p) => {
      if (level) rows[Math.floor(p / WIDTH) * (WIDTH + 1) + 1 + (p % WIDTH)] = rampIndex(color) + level - 1;
    });
  };
  stamp(coverageOf(WIDTH, HEADER_HEIGHT, logo), 'brand');
  stamp(coverageOf(WIDTH, HEADER_HEIGHT, wordmark), 'text');
  return rows;
}

/* -------------------------------------------------------------------------- */
/*                                   Palette                                  */
/* -------------------------------------------------------------------------- */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, amount) => a.map((value, i) => Math.round(value + (b[i] - value) * amount));

function buildPalette() {
  const base = rgb(BACKGROUND);
  const palette = new Uint8Array(PALETTE_ENTRIES * 3);
  const put = (index, color) => palette.set(color, index * 3);
  put(BACKGROUND_INDEX, base);
  for (const name of COLOR_NAMES) {
    const color = rgb(COLORS[name]);
    put(solidIndex(name), color);
    put(tintIndex(name), mix(base, color, 0.16));
    for (let level = 1; level <= COVERAGE_LEVELS; level++) {
      put(rampIndex(name) + level - 1, mix(base, color, level / COVERAGE_LEVELS));
    }
  }
  put(BORDER_INDEX, rgb('#2a2c32'));
  put(DIM_INDEX, rgb('#5c5e68'));
  return palette;
}

/* -------------------------------------------------------------------------- */
/*                                   Glyphs                                   */
/* -------------------------------------------------------------------------- */

function buildStyle(style) {
  const font = FONTS[style.font];
  const metrics = new Int32Array(CHARS.length * METRIC_WORDS);
  const chunks = [];
  let offset = 0;

  [...CHARS].forEach((char, i) => {
    if (style.chars && !style.chars.includes(char)) return;
    const glyph = font.charToGlyph(char);
    const slot = i * METRIC_WORDS;
    metrics[slot + 5] = Math.round((glyph.advanceWidth / font.unitsPerEm) * style.size * 16);

    const path = glyph.getPath(0, 0, style.size);
    if (!path.commands.length) return;
    const box = path.getBoundingBox();
    const left = Math.floor(box.x1) - 1;
    const top = Math.floor(box.y1) - 1;
    const width = Math.ceil(box.x2) + 1 - left;
    const height = Math.ceil(box.y2) + 1 - top;

    const coverage = coverageOf(width, height, `<path transform="translate(${-left} ${-top})" d="${pathData(path)}" fill="#fff"/>`);
    metrics.set([offset, width, height, left, -top], slot);
    chunks.push(coverage);
    offset += coverage.length;
  });

  const kern = new Int8Array(KERN_CHARS * KERN_CHARS);
  if (!style.chars) {
    for (let a = 0; a < KERN_CHARS; a++) {
      for (let b = 0; b < KERN_CHARS; b++) {
        const value = font.getKerningValue(font.charToGlyph(CHARS[a]), font.charToGlyph(CHARS[b]));
        kern[a * KERN_CHARS + b] = Math.round((value / font.unitsPerEm) * style.size * 4);
      }
    }
  }

  const coverage = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    coverage.set(chunk, at);
    at += chunk.length;
  }
  return { metrics, kern, coverage };
}

/* -------------------------------------------------------------------------- */
/*                                  The file                                  */
/* -------------------------------------------------------------------------- */

const palette = buildPalette();
const header = buildHeader();
const styles = STYLES.map(buildStyle);

const offsets = new Uint32Array(HEADER_WORDS);
const sections = [];
let end = HEADER_WORDS * 4;
const add = (bytes) => {
  // Metrics are read as 32-bit integers in place, so everything starts on a 4-byte boundary.
  end += (4 - (end % 4)) % 4;
  const start = end;
  sections.push([start, bytes]);
  end += bytes.byteLength;
  return start;
};

offsets[0] = add(palette);
offsets[1] = add(header);
styles.forEach((style, i) => {
  offsets[2 + i * 3] = add(new Uint8Array(style.metrics.buffer));
  offsets[3 + i * 3] = add(new Uint8Array(style.kern.buffer));
  offsets[4 + i * 3] = add(style.coverage);
});

const file = new Uint8Array(end);
file.set(new Uint8Array(offsets.buffer), 0);
for (const [start, bytes] of sections) file.set(bytes, start);
writeFileSync(join(root, 'src/cards/assets.bin'), file);
console.log(`assets.bin  ${(file.length / 1024).toFixed(0)} KB`);
