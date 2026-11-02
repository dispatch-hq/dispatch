import { deleteCommandsBefore, saveCommand, type NewCommand } from '../db';
import type { Bindings } from '../types';

/** Backs the private /admin/activity page. A logging failure must never affect the command itself. */

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const APPLICATION_COMMAND = 2;
const KINDS: Record<number, NewCommand['kind']> = { 1: 'slash', 2: 'user', 3: 'message' };
const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

type Option = { name: string; type: number; options?: Option[] };

type Interaction = {
  type: number;
  guild_id?: string;
  channel_id?: string;
  locale?: string;
  data?: { name?: string; type?: number; options?: Option[] };
  member?: { user?: User };
  user?: User;
};

type User = { id: string; username?: string; global_name?: string | null; avatar?: string | null };

/** The command's full name. Stops at subcommands, so the values people typed are never read. */
function commandName(name: string, options: Option[] = []): string {
  const sub = options.find((option) => option.type === SUB_COMMAND || option.type === SUB_COMMAND_GROUP);
  return sub ? `${name} ${commandName(sub.name, sub.options)}` : name;
}

/** Null for anything that isn't a command being run: pings, buttons, modals and autocomplete. */
export function parseCommand(body: string, at: number): NewCommand | null {
  const interaction = JSON.parse(body) as Interaction;
  if (interaction.type !== APPLICATION_COMMAND || !interaction.data?.name) return null;

  const user = interaction.member?.user ?? interaction.user;
  if (!user) return null;

  return {
    at,
    kind: KINDS[interaction.data.type ?? 1] ?? 'slash',
    command: commandName(interaction.data.name, interaction.data.options),
    guildId: interaction.guild_id ?? null,
    channelId: interaction.channel_id ?? null,
    userId: user.id,
    userName: user.username ?? null,
    userGlobalName: user.global_name ?? null,
    userAvatar: user.avatar ?? null,
    locale: interaction.locale ?? null,
  };
}

/** `body` must already have passed Discord's signature check, or anyone could write to the log. */
export async function recordCommand(env: Bindings, body: string): Promise<void> {
  try {
    const command = parseCommand(body, Date.now());
    if (command) await saveCommand(env.DB, command);
  } catch (error) {
    console.error('activity: recording a command failed', error);
  }
}

export async function pruneCommands(env: Bindings): Promise<void> {
  await deleteCommandsBefore(env.DB, Date.now() - RETENTION_MS).catch((error) =>
    console.error('activity: pruning the command log failed', error)
  );
}
