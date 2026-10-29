import type { APIInteractionGuildMember } from 'discord-api-types/v10';
import { EPHEMERAL_V2, notice, PUBLIC_V2, view } from '../lib/ui';

type Flag = (typeof EPHEMERAL_V2)[number] | (typeof PUBLIC_V2)[number];

/** Minimal shape shared by command, component and modal contexts. */
type Responder = {
  flags(...flags: Flag[]): { res(data: ReturnType<typeof view>): Response };
};

type Followup = {
  followup(data: ReturnType<typeof view>): Promise<unknown>;
};

type GuildInteraction = {
  guild_id?: string;
  member?: APIInteractionGuildMember;
};

/** Guild id + member for interactions that must happen inside a server. */
export function inGuild(interaction: GuildInteraction) {
  return interaction.guild_id && interaction.member
    ? { guildId: interaction.guild_id, member: interaction.member }
    : null;
}

export function reply(c: Responder, message: string): Response {
  return c.flags(...EPHEMERAL_V2).res(view([notice(message)]));
}

/** Like `reply`, but visible to the whole channel — for outcomes others benefit from seeing. */
export function announceReply(c: Responder, message: string): Response {
  return c.flags(...PUBLIC_V2).res(view([notice(message)]));
}

export function deny(c: Responder, message: string): Response {
  return reply(c, message);
}

export const messages = {
  guildOnly: 'Dispatch only works inside a server.',
  notLinked:
    "This server hasn't connected a repository yet. An admin can set one up with `/dispatch setup`.",
  adminOnly: 'You need the **Manage Server** permission to do that.',
  staffOnly: 'Only staff (Manage Server, or the configured staff role) can review reports.',
  failed: 'Something went wrong on our side. Please try again in a moment.',
} as const;

/**
 * Wraps deferred work so an unexpected error replaces the "thinking…" state
 * with a friendly message instead of leaving it spinning for 15 minutes.
 */
export function guarded<C extends Followup>(work: (c: C) => Promise<unknown>) {
  return async (c: C) => {
    try {
      await work(c);
    } catch (error) {
      console.error('interaction failed', error);
      await c.followup(view([notice(messages.failed)])).catch(() => {});
    }
  };
}
