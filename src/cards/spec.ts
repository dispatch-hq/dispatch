/**
 * What the prebuilt image assets contain, shared by the code that builds them
 * (scripts/build-card-assets.mjs) and the code that draws with them (render.ts).
 * Changing anything here means rebuilding the assets.
 */

export const WIDTH = 1200;
/** Rows at the top of every card holding the prebuilt logo and wordmark. */
export const HEADER_HEIGHT = 110;
/** The flat colour behind everything: the site's page background. */
export const BACKGROUND = '#151618';

/** Every character images can draw. `drawable` in index.ts keeps text to this set. */
export const CHARS = (() => {
  let chars = '';
  for (let c = 0x20; c <= 0x7e; c++) chars += String.fromCharCode(c);
  for (let c = 0xa0; c <= 0xff; c++) chars += String.fromCharCode(c);
  return `${chars}–—‘’“”…`;
})();

const DIGITS = '0123456789%–, ';

/** Each style is a font at one size, pre-drawn. `chars` limits one used only for numbers. */
export const STYLES = [
  { name: 'title', font: 'fraunces-400', size: 66 },
  { name: 'heading', font: 'fraunces-400', size: 52 },
  { name: 'caption', font: 'dm-sans-400', size: 30 },
  { name: 'row', font: 'dm-sans-400', size: 36 },
  { name: 'label', font: 'dm-sans-600', size: 30 },
  { name: 'name', font: 'dm-sans-600', size: 40 },
  { name: 'number', font: 'dm-sans-600', size: 88, chars: DIGITS },
] as const;

export type StyleName = (typeof STYLES)[number]['name'];

/** Text colours, from the site's palette. */
export const COLORS = {
  text: '#eeeef2',
  muted: '#9b9da8',
  brand: '#8497fa',
  green: '#5ec98a',
  amber: '#e5b567',
  red: '#e5766f',
} as const;

export type ColorName = keyof typeof COLORS;
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[];

/**
 * The PNG palette: the background, then one flat and one tinted entry per colour,
 * two greys, then a ramp of edge shades per colour. With every shade a ready-made
 * entry, drawing text is just writing bytes. Index 0 being the background means a
 * zero-filled buffer is already a blank card.
 */
export const COVERAGE_LEVELS = 15;
export const BACKGROUND_INDEX = 0;
const FIRST_SOLID = 1;
const SOLIDS = COLOR_NAMES.length * 2 + 2;
const RAMPS = COLOR_NAMES.length * COVERAGE_LEVELS;

export const PALETTE_ENTRIES = FIRST_SOLID + SOLIDS + RAMPS;
export const solidIndex = (color: ColorName) => FIRST_SOLID + COLOR_NAMES.indexOf(color);
export const tintIndex = (color: ColorName) => FIRST_SOLID + COLOR_NAMES.length + COLOR_NAMES.indexOf(color);
export const BORDER_INDEX = FIRST_SOLID + COLOR_NAMES.length * 2;
export const DIM_INDEX = BORDER_INDEX + 1;
export const rampIndex = (color: ColorName) => FIRST_SOLID + SOLIDS + COLOR_NAMES.indexOf(color) * COVERAGE_LEVELS;

/** The file starts with this many 32-bit offsets: palette, header rows, then three per style. */
export const HEADER_WORDS = 2 + STYLES.length * 3;
/** Per character: pixel offset, width, height, left bearing, rise above the baseline, advance × 16. */
export const METRIC_WORDS = 6;
/** Kerning is stored for pairs of printable ASCII, in quarter pixels. */
export const KERN_CHARS = 95;
