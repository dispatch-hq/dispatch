import {
  getAdminServer,
  getStaleAdminServers,
  markAdminServerRefreshed,
  saveAdminServerDetails,
  saveServerList,
} from '../db';
import type { AdminServerRow, Bindings } from '../types';
import { listBotGuilds } from './discord';

/**
 * Keeps `admin_servers` current for the private /admin/servers page. The server
 * list is one call per 200 servers, but owners and full details take two calls
 * per server, which doesn't fit the free plan's 50 subrequests in one request.
 * So the hourly sync reads details for the stalest servers a few at a time.
 */

const DISCORD_API = 'https://discord.com/api/v10';
/** Discord calls one sync may make, leaving room for D1 in the free plan's 50 subrequests. */
const SYNC_CALLS = 40;
/** Text, then announcement: the channel types an invite can usefully land on. */
const INVITE_CHANNEL_TYPES = new Set([0, 5]);
/** Each refused channel costs a subrequest and counts toward Discord's invalid request limit. */
const MAX_INVITE_ATTEMPTS = 5;
const INVITE_MAX_AGE_SECONDS = 60 * 60;
/** Shown in the server's audit log next to the invite. */
const INVITE_AUDIT_REASON = 'Single-use invite created by the Dispatch developer';

export type GuildDetails = {
  id: string;
  name: string;
  icon: string | null;
  owner_id: string;
  description?: string | null;
  vanity_url_code?: string | null;
  widget_enabled?: boolean;
  system_channel_id?: string | null;
  rules_channel_id?: string | null;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  [key: string]: unknown;
};

export type GuildChannel = { id: string; name: string; type: number; position?: number };

const discord = (env: Bindings, path: string, init: RequestInit = {}) =>
  fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}`, ...init.headers },
  });

/** `limited` tells a batch to stop; anything else just moves on to the next server. */
export async function refreshServer(env: Bindings, guildId: string): Promise<'ok' | 'failed' | 'limited'> {
  const res = await discord(env, `/guilds/${guildId}?with_counts=true`);
  if (!res.ok) {
    console.warn(`admin: reading server ${guildId} failed (${res.status})`);
    if (res.status === 429) return 'limited';
    await markAdminServerRefreshed(env.DB, guildId, Date.now());
    return 'failed';
  }
  const guild = (await res.json()) as GuildDetails;

  // The server's details are still worth keeping if its owner can't be read.
  const ownerRes = await discord(env, `/users/${guild.owner_id}`);
  if (!ownerRes.ok) console.warn(`admin: reading owner of ${guildId} failed (${ownerRes.status})`);
  const owner = ownerRes.ok ? await ownerRes.text() : null;

  await saveAdminServerDetails(env.DB, {
    guildId,
    name: guild.name,
    icon: guild.icon,
    memberCount: guild.approximate_member_count ?? null,
    onlineCount: guild.approximate_presence_count ?? null,
    ownerId: guild.owner_id,
    owner,
    details: JSON.stringify(guild),
    at: Date.now(),
  });
  return ownerRes.status === 429 ? 'limited' : 'ok';
}

/** Records the current server list. Returns the failure if Discord couldn't be read, so nothing is marked as left. */
export async function syncServerList(env: Bindings) {
  const list = await listBotGuilds(env);
  if (list === 'limited' || list === 'down') return list;
  await saveServerList(env.DB, list.guilds, Date.now(), list.complete);
  return list;
}

/** The hourly cron job. */
export async function syncServers(env: Bindings): Promise<void> {
  const list = await syncServerList(env);
  if (list === 'limited' || list === 'down') return;

  const count = Math.floor((SYNC_CALLS - list.pages) / 2);
  if (count <= 0) return;
  for (const guildId of await getStaleAdminServers(env.DB, count)) {
    if ((await refreshServer(env, guildId)) === 'limited') return;
  }
}

/** Live, because channels change often and aren't worth storing. Discord leaves out channels the bot can't see. */
export async function getServerChannels(env: Bindings, guildId: string): Promise<GuildChannel[] | null> {
  const res = await discord(env, `/guilds/${guildId}/channels`);
  if (!res.ok) {
    console.warn(`admin: reading channels of ${guildId} failed (${res.status})`);
    return null;
  }
  return (await res.json()) as GuildChannel[];
}

/** The invite on a server's public widget, which only exists if its admins turned the widget on. */
export async function getWidgetInvite(env: Bindings, guildId: string): Promise<string | null> {
  const res = await discord(env, `/guilds/${guildId}/widget.json`);
  if (!res.ok) return null;
  return ((await res.json()) as { instant_invite?: string | null }).instant_invite ?? null;
}

export const parseDetails = (row: Pick<AdminServerRow, 'details'>) =>
  row.details ? (JSON.parse(row.details) as GuildDetails) : null;

export type InviteResult = { url: string } | { error: 'gone' | 'no_permission' | 'failed' };

/**
 * Creates a single-use invite that expires after an hour. The bot's permissions
 * come from each server's roles, and it doesn't ask for Create Invite, so it
 * can only do this where the server allows it. Tries the channels people are
 * sent to first, then the rest in order.
 */
export async function createServerInvite(env: Bindings, guildId: string): Promise<InviteResult> {
  const row = await getAdminServer(env.DB, guildId);
  if (!row || row.left_at !== null) return { error: 'gone' };

  const details = parseDetails(row);
  const channels = (await getServerChannels(env, guildId)) ?? [];
  const candidates = [
    details?.rules_channel_id,
    details?.system_channel_id,
    ...channels
      .filter((channel) => INVITE_CHANNEL_TYPES.has(channel.type))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((channel) => channel.id),
  ].filter((id): id is string => !!id);

  for (const channelId of [...new Set(candidates)].slice(0, MAX_INVITE_ATTEMPTS)) {
    const res = await discord(env, `/channels/${channelId}/invites`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-audit-log-reason': encodeURIComponent(INVITE_AUDIT_REASON),
      },
      body: JSON.stringify({ max_age: INVITE_MAX_AGE_SECONDS, max_uses: 1, unique: true }),
    });
    if (res.ok) {
      const { code } = (await res.json()) as { code: string };
      return { url: `https://discord.gg/${code}` };
    }
    console.warn(`admin: creating an invite in channel ${channelId} failed (${res.status})`);
    // Unknown channel (a stale rules or system channel id) is worth moving past too.
    if (res.status !== 403 && res.status !== 404) return { error: 'failed' };
  }
  return { error: 'no_permission' };
}
