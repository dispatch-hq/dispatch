import assets from './assets.bin';
import type { CardData } from './index';
import { renderCard } from './render';

/** Binds the renderer to the file Wrangler bundles. See `rules` in wrangler.jsonc. */
export function renderCardPng(data: CardData) {
  return renderCard(data, assets);
}
