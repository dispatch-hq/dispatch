import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord-api-types/v10';
import {
  makeContainer,
  makeSeparator,
  makeTextDisplay,
  messageFlags,
} from 'discord-hono';

/** Shared look & feel for every Components V2 message Dispatch sends. */
export const colors = {
  brand: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  muted: 0x4f545c,
} as const;

export const EPHEMERAL_V2 = ['EPHEMERAL', 'IS_COMPONENTS_V2'] as const;
export const PUBLIC_V2 = ['IS_COMPONENTS_V2'] as const;

export type Block = Parameters<typeof makeContainer>[0][number];
export type Container = ReturnType<typeof makeContainer>;
export type RowItem = APIComponentInMessageActionRow | { toJSON(): APIComponentInMessageActionRow };

export const text = (content: string) => makeTextDisplay(content);
export const divider = (spacing: 1 | 2 = 1) => makeSeparator().spacing(spacing);
export const row = (...items: RowItem[]): APIActionRowComponent<APIComponentInMessageActionRow> => ({
  type: 1,
  components: items.map((item) => ('toJSON' in item ? item.toJSON() : item)),
});

export function card(blocks: (Block | null | undefined | false)[], accent: number = colors.brand): Container {
  return makeContainer(blocks.filter((b): b is Block => !!b)).accent_color(accent);
}

/** Single-paragraph card — the default shape for confirmations and errors. */
export function notice(content: string, accent: number = colors.muted): Container {
  return card([text(content)], accent);
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
