import {
  $channels$_$messages,
  $channels$_$messages$_,
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
