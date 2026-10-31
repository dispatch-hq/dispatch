import type { BoardCardData, CardData, CardStatus, LeadersCardData, ProfileCardData, ReportCardData } from './index';
import { encodePng } from './png';
import {
  BORDER_INDEX,
  CHARS,
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
  type ColorName,
  type StyleName,
} from './spec';

/**
 * Draws a card by stamping prebuilt pieces (see scripts/build-card-assets.mjs) onto
 * a flat background: text is written straight into palette indices. That keeps a
 * card to a few milliseconds of CPU, inside the Workers Free plan's limit.
 *
 * Discord shows these at around 500px wide, so nothing is set below 30px on the
 * 1200px canvas, and anything meant to be read at a glance is much larger.
 */

const MARGIN = 64;
const STRIDE = WIDTH + 1; // every row starts with PNG's filter byte

type Style = { metrics: Int32Array; kern: Int8Array; coverage: Uint8Array };

type Assets = {
  palette: Uint8Array;
  /** The logo and wordmark, as finished rows for the top of a card. */
  header: Uint8Array;
  styles: Record<StyleName, Style>;
};

/** Views into the bundled file, with nothing copied or parsed. */
function openAssets(file: ArrayBuffer): Assets {
  const header = new Uint32Array(file, 0, HEADER_WORDS);
  const styles = {} as Record<StyleName, Style>;
  STYLES.forEach((style, i) => {
    const metrics = header[2 + i * 3]!;
    const kern = header[3 + i * 3]!;
    const next = i + 1 < STYLES.length ? header[2 + (i + 1) * 3]! : file.byteLength;
    styles[style.name] = {
      metrics: new Int32Array(file, metrics, CHARS.length * METRIC_WORDS),
      kern: new Int8Array(file, kern, KERN_CHARS * KERN_CHARS),
      coverage: new Uint8Array(file, header[4 + i * 3]!, next - header[4 + i * 3]!),
    };
  });
  return {
    palette: new Uint8Array(file, header[0]!, PALETTE_ENTRIES * 3),
    header: new Uint8Array(file, header[1]!, HEADER_HEIGHT * STRIDE),
    styles,
  };
}

/** Where each character sits in the metrics. Everything but a few punctuation marks is under U+0100. */
const CHAR_INDEX = new Int16Array(256).fill(-1);
const WIDE_CHARS = new Map<number, number>();
[...CHARS].forEach((char, i) => {
  const code = char.charCodeAt(0);
  if (code < 256) CHAR_INDEX[code] = i;
  else WIDE_CHARS.set(code, i);
});

const charIndex = (code: number) => (code < 256 ? CHAR_INDEX[code]! : (WIDE_CHARS.get(code) ?? -1));

type Options = { color?: ColorName; anchor?: 'start' | 'end' };

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    private readonly assets: Assets,
    readonly height: number
  ) {
    this.pixels = new Uint8Array(STRIDE * height); // all zero: a blank card
    this.pixels.set(assets.header);
  }

  /** Text's width in pixels, with kerning. */
  measure(content: string, styleName: StyleName): number {
    const { metrics, kern } = this.assets.styles[styleName];
    let width = 0;
    let previous = -1;
    for (let i = 0; i < content.length; i++) {
      const index = charIndex(content.charCodeAt(i));
      if (index < 0) continue;
      if (previous >= 0 && previous < KERN_CHARS && index < KERN_CHARS) width += kern[previous * KERN_CHARS + index]! / 4;
      width += metrics[index * METRIC_WORDS + 5]! / 16;
      previous = index;
    }
    return width;
  }

  /** Stamps text with its baseline at `y`. */
  text(x: number, y: number, content: string, styleName: StyleName, options: Options = {}) {
    const { metrics, kern, coverage } = this.assets.styles[styleName];
    const ramp = rampIndex(options.color ?? 'text') - 1;
    const pixels = this.pixels;
    const height = this.height;
    let pen = options.anchor === 'end' ? x - this.measure(content, styleName) : x;
    let previous = -1;

    for (let i = 0; i < content.length; i++) {
      const index = charIndex(content.charCodeAt(i));
      if (index < 0) continue;
      if (previous >= 0 && previous < KERN_CHARS && index < KERN_CHARS) pen += kern[previous * KERN_CHARS + index]! / 4;
      previous = index;

      const slot = index * METRIC_WORDS;
      const glyphWidth = metrics[slot + 1]!;
      const glyphHeight = metrics[slot + 2]!;
      const left = Math.round(pen) + metrics[slot + 3]!;
      const top = y - metrics[slot + 4]!;
      pen += metrics[slot + 5]! / 16;
      if (left < 0 || left + glyphWidth > WIDTH || top < 0 || top + glyphHeight > height) continue;

      let source = metrics[slot]!;
      for (let row = 0; row < glyphHeight; row++) {
        let target = (top + row) * STRIDE + 1 + left;
        for (const stop = source + glyphWidth; source < stop; source++, target++) {
          const level = coverage[source]!;
          if (level) pixels[target] = ramp + level;
        }
      }
    }
  }

  rect(x: number, y: number, width: number, height: number, index: number) {
    for (let row = y; row < y + height; row++) {
      const start = row * STRIDE + 1 + x;
      this.pixels.fill(index, start, start + width);
    }
  }

  /** Cuts text to a width with an ellipsis. */
  fit(content: string, styleName: StyleName, width: number): string {
    if (this.measure(content, styleName) <= width) return content;
    let low = 0;
    let high = content.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.measure(`${content.slice(0, middle).trimEnd()}…`, styleName) <= width) low = middle;
      else high = middle - 1;
    }
    return `${content.slice(0, low).trimEnd()}…`;
  }

  /** Wraps text onto at most `lines` lines; the last is cut if there's still more. */
  wrap(content: string, styleName: StyleName, width: number, lines: number): string[] {
    const out: string[] = [];
    let rest = content.split(' ');
    while (rest.length && out.length < lines) {
      let line = '';
      while (rest.length) {
        const next = line ? `${line} ${rest[0]}` : rest[0]!;
        if (line && this.measure(next, styleName) > width) break;
        line = next;
        rest = rest.slice(1);
      }
      out.push(line);
    }
    if (rest.length) out[out.length - 1] = `${out.at(-1)} ${rest.join(' ')}`;
    return out.map((line) => this.fit(line, styleName, width));
  }

  /** What this card is about, beside the logo and wordmark baked into the background. */
  section(content: string) {
    this.text(MARGIN + 212, 82, content ? `/ ${content}` : '', 'caption', { color: 'muted' });
  }

  /** A big number with a caption beneath it. */
  stat(x: number, y: number, value: string, caption: string, color: ColorName = 'text') {
    this.text(x, y, value, 'number', { color });
    this.text(x, y + 48, caption, 'caption', { color: 'muted' });
  }

  progress(y: number, value: number, max: number, color: ColorName) {
    const inner = WIDTH - MARGIN * 2;
    this.rect(MARGIN, y, inner, 20, BORDER_INDEX);
    const filled = Math.round(inner * Math.min(1, value / Math.max(1, max)));
    if (filled) this.rect(MARGIN, y, filled, 20, solidIndex(color));
  }
}

const STATUS: Record<CardStatus, { label: string; color: ColorName }> = {
  pending: { label: 'Awaiting review', color: 'amber' },
  info: { label: 'Waiting on reporter', color: 'amber' },
  rejected: { label: 'Rejected', color: 'red' },
  open: { label: 'Open', color: 'brand' },
  fixed: { label: 'Fixed', color: 'green' },
  closed: { label: 'Closed', color: 'muted' },
};

function drawReport(assets: Assets, data: ReportCardData): Canvas {
  const canvas = new Canvas(assets, 524);
  const inner = WIDTH - MARGIN * 2;
  canvas.section(`Report #${data.id}`);

  const { label, color } = STATUS[data.status];
  const pillWidth = Math.ceil(canvas.measure(label, 'label')) + 70;
  const pillLeft = WIDTH - MARGIN - pillWidth;
  canvas.rect(pillLeft, 46, pillWidth, 54, solidIndex(color));
  canvas.rect(pillLeft + 2, 48, pillWidth - 4, 50, tintIndex(color));
  canvas.rect(pillLeft + 22, 66, 14, 14, solidIndex(color));
  canvas.text(pillLeft + 48, 84, label, 'label', { color });

  const style: StyleName = canvas.measure(data.title, 'title') > inner * 1.7 ? 'heading' : 'title';
  const lineHeight = style === 'title' ? 76 : 62;
  canvas.wrap(data.title, style, inner, 2).forEach((line, i) => canvas.text(MARGIN, 186 + i * lineHeight, line, style));
  canvas.rect(MARGIN, 322, inner, 2, BORDER_INDEX);

  canvas.stat(MARGIN, 424, String(data.votes), data.votes === 1 ? 'upvote' : 'upvotes', data.votes ? 'brand' : 'muted');

  const column = 300;
  const columnWidth = WIDTH - MARGIN - column;
  const reporter = data.rate === null ? 'New reporter' : `${data.rate}% accepted`;
  const details = [data.ref, data.type].filter((part): part is string => !!part).join('  ·  ');
  canvas.text(column, 386, canvas.fit(data.by, 'name', columnWidth), 'name');
  canvas.text(column, 430, data.trusted ? `Trusted  ·  ${reporter}` : reporter, 'caption', { color: data.trusted ? 'green' : 'muted' });
  if (details) canvas.text(column, 472, canvas.fit(details, 'caption', columnWidth), 'caption', { color: 'muted' });
  return canvas;
}

function drawProfile(assets: Assets, data: ProfileCardData): Canvas {
  const canvas = new Canvas(assets, 524);
  const accent: ColorName = data.unlocked ? 'green' : 'brand';
  canvas.section(data.unlocked ? 'Reward unlocked' : 'Stats');
  if (data.trusted) canvas.text(WIDTH - MARGIN, 82, 'Trusted reporter', 'label', { color: 'green', anchor: 'end' });
  canvas.text(MARGIN, 182, canvas.fit(data.name, 'heading', WIDTH - MARGIN * 2), 'heading');

  canvas.stat(MARGIN, 306, String(data.fixed), 'fixed', accent);
  canvas.stat(420, 306, String(data.filed), 'filed');
  canvas.stat(760, 306, data.rate === null ? '–' : `${data.rate}%`, 'accepted');

  if (data.next) {
    canvas.progress(410, data.fixed, data.next.at, accent);
    canvas.text(MARGIN, 470, `${data.fixed} of ${data.next.at} fixed towards the next reward`, 'caption', { color: 'muted' });
  } else {
    canvas.progress(410, 1, 1, accent);
    canvas.text(MARGIN, 470, data.fixed ? 'Every reward earned' : 'No fixed reports yet', 'caption', { color: 'muted' });
  }
  return canvas;
}

function drawLeaders(assets: Assets, data: LeadersCardData): Canvas {
  const top = data.rows.slice(0, 5);
  const rowHeight = 78;
  const canvas = new Canvas(assets, 170 + Math.max(1, top.length) * rowHeight);
  canvas.section('Top reporters');
  if (!top.length) canvas.text(MARGIN, 190, 'No fixed reports yet', 'heading', { color: 'muted' });

  const most = Math.max(1, ...top.map((r) => r.fixed));
  const nameWidth = 480;
  const barLeft = MARGIN + 60 + nameWidth + 20;
  const barWidth = WIDTH - MARGIN - barLeft - 90;

  top.forEach((row, i) => {
    const y = 180 + i * rowHeight;
    const first = i === 0;
    const nameStyle: StyleName = first ? 'name' : 'row';
    canvas.text(MARGIN, y, String(i + 1), 'name', { color: first ? 'brand' : 'muted' });
    canvas.text(MARGIN + 60, y, canvas.fit(row.name, nameStyle, nameWidth), nameStyle);
    canvas.rect(barLeft, y - 28, Math.max(6, Math.round((barWidth * row.fixed) / most)), 28, first ? solidIndex('brand') : DIM_INDEX);
    canvas.text(WIDTH - MARGIN, y, String(row.fixed), 'name', { anchor: 'end' });
  });
  return canvas;
}

function drawBoard(assets: Assets, data: BoardCardData): Canvas {
  const top = data.top.slice(0, 3);
  const listTop = 382;
  const rowHeight = 60;
  const canvas = new Canvas(assets, top.length ? listTop + top.length * rowHeight - 6 : 340);

  canvas.section(canvas.fit(data.repo ?? 'Status', 'caption', 560));
  canvas.text(WIDTH - MARGIN, 82, data.week ? `${data.week} fixed this week` : 'Live', 'label', { color: data.week ? 'green' : 'muted', anchor: 'end' });

  canvas.stat(MARGIN, 214, String(data.open), 'open', 'brand');
  canvas.stat(420, 214, String(data.pending), 'in review', data.pending ? 'amber' : 'text');
  canvas.stat(760, 214, String(data.fixed), 'fixed', 'green');

  if (top.length) canvas.rect(MARGIN, 312, WIDTH - MARGIN * 2, 2, BORDER_INDEX);
  top.forEach((item, i) => {
    const y = listTop + i * rowHeight;
    canvas.text(MARGIN, y, String(item.votes), 'name', { color: 'brand' });
    canvas.text(MARGIN + 90, y, canvas.fit(item.title, 'row', WIDTH - MARGIN * 2 - 90), 'row');
  });
  return canvas;
}

let opened: { file: ArrayBuffer; assets: Assets } | undefined;

export function renderCard(data: CardData, file: ArrayBuffer): Uint8Array {
  if (opened?.file !== file) opened = { file, assets: openAssets(file) };
  const { assets } = opened;

  const canvas =
    data.k === 'report'
      ? drawReport(assets, data)
      : data.k === 'profile'
        ? drawProfile(assets, data)
        : data.k === 'leaders'
          ? drawLeaders(assets, data)
          : drawBoard(assets, data);
  return encodePng(canvas.pixels, WIDTH, canvas.height, assets.palette);
}
