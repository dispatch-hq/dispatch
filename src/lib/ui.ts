import type { APIActionRowComponent, APIComponentInMessageActionRow } from 'discord-api-types/v10';
import {
  makeContainer,
  makeSection,
  makeSeparator,
  makeTextDisplay,
  messageFlags,
} from 'discord-hono';

/**
 * Shared look & feel for every Components V2 message Dispatch sends: uncoloured containers, plain text, buttons.
 *
 * Button colours: Success / Danger are reserved for constructive / destructive decisions (approve, reject,
 * disconnect), Primary is for the one action a message exists to do, and Secondary is for everything else
 * (cancel, paging, toggles). Link buttons are always grey, which is Discord's own rule.
 */

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

/** Text with a single button (usually a link) pinned to its right. */
export const section = (content: string, accessory: Parameters<typeof makeSection>[1]) =>
  makeSection([makeTextDisplay(content)], accessory);

export function card(blocks: (Block | null | undefined | false)[]): Container {
  return makeContainer(blocks.filter((b): b is Block => !!b));
}

/** Single-paragraph card — the default shape for confirmations and errors. */
export function notice(content: string): Container {
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
