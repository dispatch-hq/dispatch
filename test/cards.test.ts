import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cardUrl, drawable, verifyCard, type CardData } from '../src/cards';
import { renderCard } from '../src/cards/render';
import { CHARS, PALETTE_ENTRIES } from '../src/cards/spec';
import { signToken } from '../src/lib/crypto';
import { createWorld, type World } from './support/harness';

// The bundled assets need Wrangler's rules, so the route gets a stand-in; `renderCard` is tested directly below.
vi.mock('../src/cards/runtime', () => ({ renderCardPng: async () => new Uint8Array([137, 80, 78, 71]) }));

const file = readFileSync(join(import.meta.dirname, '../src/cards/assets.bin'));
const assets = file.buffer.slice(file.byteOffset, file.byteOffset + file.length) as ArrayBuffer;

/** Reads a PNG strictly: every checksum must hold, and the pixels must fill the declared size. */
function decode(png: Uint8Array) {
  const bytes = Buffer.from(png);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map<string, Buffer>();
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    expect(crc32(bytes.subarray(at + 4, at + 8 + length))).toBe(bytes.readUInt32BE(at + 8 + length));
    chunks.set(type, bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const header = chunks.get('IHDR')!;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const rows = inflateSync(chunks.get('IDAT')!);
  expect(rows.length).toBe((width + 1) * height);
  expect(chunks.has('IEND')).toBe(true);
  expect(chunks.get('PLTE')!.length).toBe(PALETTE_ENTRIES * 3);
  return { width, height, rows };
}

const report: CardData = {
  k: 'report',
  id: 7,
  title: 'Crash on start',
  status: 'pending',
  votes: 3,
  by: 'sam',
  rate: 80,
  trusted: false,
  type: 'Crash',
  ref: 'acme/app',
};

const samples: CardData[] = [
  report,
  { k: 'profile', name: 'sam', fixed: 3, filed: 5, rate: 60, trusted: true, next: { at: 5 }, unlocked: false },
  { k: 'profile', name: 'sam', fixed: 5, filed: 5, rate: 100, trusted: false, next: null, unlocked: true },
  { k: 'leaders', rows: [{ name: 'sam', fixed: 3 }] },
  { k: 'leaders', rows: Array.from({ length: 5 }, (_, i) => ({ name: `member-${i}`, fixed: 5 - i })) },
  { k: 'leaders', rows: [] },
  { k: 'board', repo: 'acme/app', open: 1, pending: 2, fixed: 3, week: 1, top: [{ title: 'Crash', votes: 4 }] },
  { k: 'board', repo: 'acme/app', open: 1, pending: 2, fixed: 3, week: 1, top: Array.from({ length: 3 }, () => ({ title: 'Crash', votes: 4 })) },
  { k: 'board', repo: null, open: 0, pending: 0, fixed: 0, week: 0, top: [] },
];

describe('drawing', () => {
  it('draws every template, at its tallest, to a valid PNG', () => {
    for (const data of samples) {
      const { width, rows } = decode(renderCard(data, assets));
      expect(width).toBe(1200);
      expect(rows.every((index) => index < PALETTE_ENTRIES)).toBe(true); // every pixel is a real palette entry
    }
  });

  it('draws the whole wordmark', () => {
    // It once stopped at "Dis", from a bad path: the end of "Dispatch" must have ink in it.
    const { rows, width } = decode(renderCard(report, assets));
    let ink = 0;
    for (let y = 50; y < 95; y++) for (let x = 205; x < 255; x++) if (rows[y * (width + 1) + 1 + x]) ink++;
    expect(ink).toBeGreaterThan(100);
  });

  it('draws every character the styles damaged by that bug relied on', () => {
    const base = decode(renderCard({ k: 'leaders', rows: [{ name: 'a', fixed: 1 }, { name: 'b', fixed: 1 }] }, assets)).rows;
    for (const char of 'hnox256@') {
      const drawn = decode(renderCard({ k: 'leaders', rows: [{ name: 'a', fixed: 1 }, { name: char, fixed: 1 }] }, assets)).rows;
      expect(drawn.equals(base)).toBe(false);
    }
  });

  it('shows the new number when the data changes', () => {
    const three = decode(renderCard(report, assets)).rows;
    const again = decode(renderCard(report, assets)).rows;
    const four = decode(renderCard({ ...report, votes: 4 }, assets)).rows;
    expect(three.equals(again)).toBe(true);
    expect(three.equals(four)).toBe(false);
  });

  it('starts every card clean, with nothing left from the one before', () => {
    const first = decode(renderCard({ ...report, title: 'First' }, assets)).rows;
    renderCard({ ...report, title: 'A different and much longer title' }, assets);
    expect(decode(renderCard({ ...report, title: 'First' }, assets)).rows.equals(first)).toBe(true);
  });

  it('copes with text far too long for the card', () => {
    const long = 'W'.repeat(110);
    const { rows } = decode(renderCard({ ...report, title: long, by: long, type: long, ref: long }, assets));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('has a pre-drawn shape for everything drawable lets through', () => {
    let everything = '';
    for (let code = 0x20; code < 0x2100; code++) everything += String.fromCharCode(code);
    const kept = drawable(everything, 100_000);
    for (const char of kept) if (char !== ' ') expect(CHARS).toContain(char);
  });

  it('keeps only what the fonts can draw', () => {
    expect(drawable('Crash 💥 on\nstart', 50)).toBe('Crash on start');
    expect(drawable('Café “quoted” — ok…', 50)).toBe('Café “quoted” — ok…');
    expect(drawable('日本語', 50)).toBe('');
    expect(drawable('x'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('image URLs', () => {
  let w: World;
  const cached = new Map<string, Response>();

  beforeAll(() => {
    w = createWorld();
    vi.stubGlobal('caches', { default: { match: async (key: string) => cached.get(key)?.clone(), put: async (key: string, res: Response) => void cached.set(key, res) } });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('changes exactly when the data does', async () => {
    const three = await cardUrl(w.env, report);
    expect(await cardUrl(w.env, report)).toBe(three);
    expect(await cardUrl(w.env, { ...report, votes: 4 })).not.toBe(three);
  });

  it('fits in a Discord media URL at its longest', async () => {
    const url = await cardUrl(w.env, {
      k: 'board',
      repo: 'x'.repeat(60),
      open: 99999,
      pending: 99999,
      fixed: 99999,
      week: 99999,
      top: Array.from({ length: 3 }, () => ({ title: 'é'.repeat(70), votes: 99999 })),
    });
    expect(url.length).toBeLessThan(2048);
  });

  it('serves a signed image with a permanent cache lifetime', async () => {
    const res = await w.request(new URL(await cardUrl(w.env, report)).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it("can't be made to render again by adding a query string", async () => {
    const path = new URL(await cardUrl(w.env, { ...report, votes: 9 })).pathname;
    await w.request(`${path}?a=1`);
    const before = cached.size;
    const res = await w.request(`${path}?b=2`);
    expect(res.status).toBe(200);
    expect(cached.size).toBe(before);
    expect([...cached.keys()].some((key) => key.includes('?'))).toBe(false);
  });

  it('refuses tampered data and tokens signed for anything else', async () => {
    const url = await cardUrl(w.env, report);
    const [body, sig] = new URL(url).pathname.slice('/cards/'.length).split('.') as [string, string];

    const forged = btoa(JSON.stringify({ ...report, title: 'Free nitro at evil.test' })).replace(/=+$/, '');
    expect((await w.request(`/cards/${forged}.${sig}.png`)).status).toBe(404);
    expect((await w.request(`/cards/${body}.png`)).status).toBe(404);

    // An OAuth state token is signed with the same secret, but isn't valid here.
    const state = await signToken(w.env.STATE_SECRET, report, 600);
    expect(await verifyCard(w.env, state)).toBeNull();
  });
});
