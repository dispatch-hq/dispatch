import { signStable, verifyStable } from '../lib/crypto';
import type { Bindings } from '../types';

/**
 * The images on Dispatch's messages. An image's URL carries everything it shows,
 * signed so nobody else can have us draw their text, which makes it:
 *  - current: new data means a new URL, so editing the message swaps the picture
 *    (Discord's proxy caches by URL, and would otherwise keep showing the old one)
 *  - cheap: the same data is the same URL, so a redraw never touches the database
 *  - private: there are no guessable ids, and only people who can see a message
 *    can see its image
 *
 * This file stays free of the renderer so that commands don't load it.
 */

export type CardStatus = 'pending' | 'info' | 'rejected' | 'open' | 'fixed' | 'closed';

export type ReportCardData = {
  k: 'report';
  id: number;
  title: string;
  status: CardStatus;
  votes: number;
  by: string;
  /** Share of the reporter's reviewed reports that were accepted. */
  rate: number | null;
  trusted: boolean;
  /** Report type, when the server uses them. */
  type: string | null;
  ref: string | null;
};

export type ProfileCardData = {
  k: 'profile';
  name: string;
  fixed: number;
  filed: number;
  rate: number | null;
  trusted: boolean;
  /** Progress towards the next reward role. */
  next: { at: number } | null;
  /** Drawn as a celebration: a reward role was just earned. */
  unlocked: boolean;
};

export type LeadersCardData = {
  k: 'leaders';
  rows: { name: string; fixed: number }[];
};

export type BoardCardData = {
  k: 'board';
  repo: string | null;
  open: number;
  pending: number;
  fixed: number;
  /** Fixed in the last 7 days. */
  week: number;
  top: { title: string; votes: number }[];
};

export type CardData = ReportCardData | ProfileCardData | LeadersCardData | BoardCardData;

/**
 * Keeps text to what the bundled Latin fonts can draw, since anything else would
 * come out as blank boxes. The full text is always in the message beside the
 * image, so a title in another script only loses it from the picture.
 */
export function drawable(text: string, max: number): string {
  const kept = text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7e -ÿ–—‘’“”…]/g, '')
    .replace(/ +/g, ' ')
    .trim();
  return kept.length <= max ? kept : `${kept.slice(0, max - 1).trimEnd()}…`;
}

/** A signed, versioned image URL for this data. */
export async function cardUrl(env: Bindings, data: CardData): Promise<string> {
  return `${env.PUBLIC_URL}/cards/${await signStable(env.STATE_SECRET, data)}.png`;
}

export function verifyCard(env: Bindings, token: string): Promise<CardData | null> {
  return verifyStable<CardData>(env.STATE_SECRET, token);
}

/** An image block for a card. `alt` is what screen readers get instead of the picture. */
export function cardImage(url: string, alt: string) {
  return { type: 12 as const, items: [{ media: { url: url as `https://${string}` }, description: alt.slice(0, 1024) }] };
}
