import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord-api-types/v10';
import {
  makeContainer,
  makeSection,
  makeSeparator,
  makeTextDisplay,
  messageFlags,
} from 'discord-hono';

/**
 * Shared look & feel for every Components V2 message Dispatch sends: brand-coloured containers, plain text, buttons.
 *
 * Button colours: Success / Danger are reserved for constructive / destructive decisions (approve, reject,
 * disconnect), Primary is for the one action a message exists to do, and Secondary is for everything else
 * (cancel, paging, toggles). Link buttons are always grey, which is Discord's own rule.
 */

/** Portage, the same accent as the site. */
export const BRAND_COLOR = 0x8497fa;

let accent = BRAND_COLOR;

/**
 * Overrides the accent for this deployment, from the optional `ACCENT_COLOR` var (hex, with or without `#`).
 * It is constant for a deployment, so setting it per request is safe. Beta uses it to tell itself apart.
 */
export function setAccent(hex: string | undefined) {
  const value = hex ? Number.parseInt(hex.replace(/^#/, ''), 16) : Number.NaN;
  accent = Number.isFinite(value) && value >= 0 && value <= 0xffffff ? value : BRAND_COLOR;
}

export const EPHEMERAL_V2 = ['EPHEMERAL', 'IS_COMPONENTS_V2'] as const;
export const PUBLIC_V2 = ['IS_COMPONENTS_V2'] as const;

export type Block = Parameters<typeof makeContainer>[0][number];
export type RowItem = APIComponentInMessageActionRow | { toJSON(): APIComponentInMessageActionRow };

export const text = (content: string) => makeTextDisplay(content);
export const divider = (spacing: 1 | 2 = 1) => makeSeparator().spacing(spacing);
export const row = (...items: RowItem[]): APIActionRowComponent<APIComponentInMessageActionRow> => ({
  type: 1,
  components: items.map((item) => ('toJSON' in item ? item.toJSON() : item)),
});

/** Text with a single button (usually a link) pinned to its right. */
export const section = (content: string, accessory: Parameters<typeof makeSection>[1]) =>
  makeSection([makeTextDisplay(content)], accessory);

export function card(blocks: (Block | null | undefined | false)[]) {
  return makeContainer(blocks.filter((b): b is Block => !!b)).accent_color(accent);
}

export type Container = ReturnType<typeof card>;

/** Single-paragraph card — the default shape for confirmations and errors. */
export function notice(content: string) {
  return card([text(content)]);
}

/**
 * Interaction response / followup body. Mentions are rendered but never ping
 * unless a caller explicitly allows specific users.
 */
export function view(components: Container[], pingUsers: string[] = []) {
  return {
    components,
    allowed_mentions: { parse: [], users: pingUsers },
  };
}

/** Body for messages sent through the REST API (channels / DMs). */
export function message(components: Container[], pingUsers: string[] = []) {
  return {
    ...view(components, pingUsers),
    flags: messageFlags('IS_COMPONENTS_V2'),
  };
}
