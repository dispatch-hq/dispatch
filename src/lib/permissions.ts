import type { APIInteractionGuildMember } from 'discord-api-types/v10';
import type { GuildRow } from '../types';

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;

/** Permission bit for `default_member_permissions` on admin-only commands. */
export const MANAGE_GUILD_PERMISSION = MANAGE_GUILD.toString();

export function canManageGuild(member: APIInteractionGuildMember | undefined): boolean {
  if (!member) return false;
  const permissions = BigInt(member.permissions);
  return (permissions & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;
}

/** Staff may approve or reject reports in the triage queue. */
export function canTriage(member: APIInteractionGuildMember | undefined, guild: GuildRow): boolean {
  if (!member) return false;
  if (canManageGuild(member)) return true;
  return !!guild.staff_role_id && member.roles.includes(guild.staff_role_id);
}

export function displayName(member: APIInteractionGuildMember | undefined): string {
  if (!member) return 'Unknown user';
  return member.nick ?? member.user.global_name ?? member.user.username;
}
