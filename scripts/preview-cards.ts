// Draws sample message images, and how long each took, to see a design change:
//
//   npx tsx scripts/preview-cards.ts <output directory>
//
// The first line is the slowest case that matters: a new isolate's first image.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardData } from '../src/cards';
import { renderCard } from '../src/cards/render';

const out = process.argv[2];
if (!out) throw new Error('Pass an output directory');
mkdirSync(out, { recursive: true });

const bytes = readFileSync(join(import.meta.dirname, '../src/cards/assets.bin'));
const assets = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;

const samples: Record<string, CardData> = {
  'report-pending': { k: 'report', id: 128, title: 'Crash when opening settings on Windows', status: 'pending', votes: 4, by: 'jakemackie', rate: 80, trusted: false, type: 'Crash', ref: 'acme/app' },
  'report-long': { k: 'report', id: 1042, title: 'WWWW The export button does nothing after you switch workspaces twice and then reopen the dialog from the sidebar menu again please', status: 'info', votes: 0, by: 'a_really_long_discord_username_x', rate: null, trusted: false, type: 'Performance & stability', ref: 'some-organisation/a_rather_long_repository_name' },
  'report-fixed': { k: 'report', id: 7, title: 'Typo on the homepage', status: 'fixed', votes: 23, by: 'sam', rate: 96, trusted: true, type: null, ref: 'acme/app#43' },
  'report-rejected': { k: 'report', id: 8, title: 'Please add dark mode', status: 'rejected', votes: 1, by: 'sam', rate: 50, trusted: false, type: 'UI', ref: 'acme/app' },
  'profile': { k: 'profile', name: 'jakemackie', fixed: 7, filed: 12, rate: 86, trusted: true, next: { at: 10 }, unlocked: false },
  'profile-unlocked': { k: 'profile', name: 'sam', fixed: 10, filed: 11, rate: 91, trusted: false, next: null, unlocked: true },
  'leaders': { k: 'leaders', rows: [{ name: 'jakemackie', fixed: 21 }, { name: 'sam', fixed: 14 }, { name: 'a_really_long_discord_username_x', fixed: 9 }, { name: 'pat', fixed: 3 }, { name: 'lee', fixed: 1 }] },
  'leaders-empty': { k: 'leaders', rows: [] },
  'board': { k: 'board', repo: 'acme/app', open: 18, pending: 3, fixed: 142, week: 6, top: [{ title: 'Crash when opening settings on Windows', votes: 23 }, { title: 'Export button does nothing after switching workspaces twice and reopening', votes: 9 }, { title: 'Typo on homepage', votes: 2 }] },
  'board-quiet': { k: 'board', repo: 'acme/app', open: 0, pending: 0, fixed: 0, week: 0, top: [] },
};

for (const [name, data] of Object.entries(samples)) {
  const start = performance.now();
  const png = renderCard(data, assets);
  console.log(`${name.padEnd(18)} ${(performance.now() - start).toFixed(1).padStart(6)} ms  ${(png.length / 1024).toFixed(0).padStart(4)} KB`);
  writeFileSync(join(out, `${name}.png`), png);
}
