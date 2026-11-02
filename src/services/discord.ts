import {
  $channels$_$messages,
  $channels$_$messages$_,
  $channels$_$messages$_$threads,
  $guilds$_$members$_,
  $guilds$_$members$_$roles$_,
  $users$me$channels,
  createRest,
} from 'discord-hono';
import type { Container } from '../lib/ui';
import { message } from '../lib/ui';
import type { Bindings } from '../types';

/**
 * Thin wrappers around the Discord REST API for work that happens outside an
 * interaction response (webhooks, triage, notifications). Failures are logged
 * and reported as `false`/`null` — a missing DM or channel permission should
 * never break the bug-report pipeline.
 */

async function failed(label: string, res: { status: number; text(): Promise<string> }): Promise<false> {
  console.warn(`discord: ${label} failed (${res.status})`, await res.text().catch(() => ''));
  return false;
}

const DISCORD_API = 'https://discord.com/api/v10';
const GUILDS_PER_PAGE = 200;
/** Stops a runaway loop; 45 pages is 9,000 servers, and leaves room for D1 in the free plan's 50 subrequests. */
const MAX_GUILD_PAGES = 45;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type BotGuild = {
  id: string;
  name: string;
  icon: string | null;
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

/** `complete` is false if the page cap cut the list short, so a server missing from it may still have the bot. */
export type BotGuildList = { guilds: BotGuild[]; pages: number; complete: boolean };

/** Every server the bot is in. A 429 still means Discord answered, so it's `limited` rather than `down`. */
export async function listBotGuilds(env: Bindings): Promise<BotGuildList | 'limited' | 'down'> {
  const guilds: BotGuild[] = [];
  let after = '';

  for (let page = 1; page <= MAX_GUILD_PAGES; page++) {
    const url = `${DISCORD_API}/users/@me/guilds?with_counts=true&limit=${GUILDS_PER_PAGE}${after && `&after=${after}`}`;
    const res = await fetch(url, { headers: { authorization: `Bot ${env.DISCORD_TOKEN}` } });
    if (!res.ok) {
      console.warn(`discord: reading the server list failed (${res.status})`);
      return res.status === 429 ? 'limited' : 'down';
    }

    const batch = (await res.json()) as BotGuild[];
    guilds.push(...batch);
    if (batch.length < GUILDS_PER_PAGE) return { guilds, pages: page, complete: true };
    after = batch[batch.length - 1]!.id;

    if (res.headers.get('x-ratelimit-remaining') === '0') {
      await sleep(Number(res.headers.get('x-ratelimit-reset-after') ?? 1) * 1000);
    }
  }

  return { guilds, pages: MAX_GUILD_PAGES, complete: false };
}

export async function sendChannelMessage(
  env: Bindings,
  channelId: string,
  components: Container[],
  pingUsers: string[] = []
): Promise<string | null> {
  const res = await createRest(env.DISCORD_TOKEN)('POST', $channels$_$messages, [channelId], message(components, pingUsers));
  if (!res.ok) return failed(`post to channel ${channelId}`, res).then(() => null);
  return (await res.json()).id;
}

export async function editChannelMessage(
  env: Bindings,
  channelId: string,
  messageId: string,
  components: Container[]
): Promise<boolean> {
  const res = await createRest(env.DISCORD_TOKEN)('PATCH', $channels$_$messages$_, [channelId, messageId], message(components));
  return res.ok || failed(`edit message ${messageId}`, res);
}

export async function deleteChannelMessage(env: Bindings, channelId: string, messageId: string): Promise<boolean> {
  const res = await createRest(env.DISCORD_TOKEN)('DELETE', $channels$_$messages$_, [channelId, messageId]);
  return res.ok || failed(`delete message ${messageId}`, res);
}

/**
 * Starts a public thread on a message. The thread reuses the message's id, so
 * it can be addressed later without storing anything. Needs *Create Public
 * Threads*; without it the report simply has no thread.
 */
export async function startThread(
  env: Bindings,
  channelId: string,
  messageId: string,
  name: string
): Promise<boolean> {
  const res = await createRest(env.DISCORD_TOKEN)('POST', $channels$_$messages$_$threads, [channelId, messageId], {
    name,
    // 1 day: always allowed. Longer windows depend on the server's boost level.
    auto_archive_duration: 1440,
  });
  return res.ok || failed(`start thread on message ${messageId}`, res);
}

export async function sendDirectMessage(env: Bindings, userId: string, components: Container[]): Promise<boolean> {
  const rest = createRest(env.DISCORD_TOKEN);
  const channel = await rest('POST', $users$me$channels, [], { recipient_id: userId });
  if (!channel.ok) return failed(`open DM with ${userId}`, channel);

  const { id } = (await channel.json()) as { id: string };
  return (await sendChannelMessage(env, id, components)) !== null;
}

export async function getMemberRoles(env: Bindings, guildId: string, userId: string): Promise<string[] | null> {
  const res = await createRest(env.DISCORD_TOKEN)('GET', $guilds$_$members$_, [guildId, userId]);
  if (!res.ok) return null; // left the server, or never joined
  return (await res.json()).roles;
}

export type RoleChangeError = 'missing_permissions' | 'unknown';

export async function setMemberRole(
  env: Bindings,
  guildId: string,
  userId: string,
  roleId: string,
  present: boolean
): Promise<RoleChangeError | null> {
  const res = await createRest(env.DISCORD_TOKEN)(
    present ? 'PUT' : 'DELETE',
    $guilds$_$members$_$roles$_,
    [guildId, userId, roleId]
  );
  if (res.ok) return null;
  await failed(`${present ? 'add' : 'remove'} role ${roleId} for ${userId}`, res);
  return res.status === 403 ? 'missing_permissions' : 'unknown';
}
