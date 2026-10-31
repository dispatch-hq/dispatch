import { cardImage, cardUrl, drawable } from '../cards';
import { getReporterName, getReporterStats, getRewardTiers } from '../db';
import { card, text } from '../lib/ui';
import type { Bindings, GuildRow, RewardTier } from '../types';
import { reputation } from './reputation';
import { getMemberRoles, sendChannelMessage, sendDirectMessage, setMemberRole, type RoleChangeError } from './discord';

export type RewardSync = {
  fixed: number;
  added: RewardTier[];
  removed: RewardTier[];
  errors: RoleChangeError[];
};

/**
 * Brings a member's reward roles in line with their fixed-report count:
 * grants every tier they've reached and removes tiers they no longer meet
 * (e.g. after an issue is reopened). Only roles configured as reward tiers are
 * ever touched.
 */
export async function syncRewards(
  env: Bindings,
  guildId: string,
  userId: string,
  tiers?: RewardTier[]
): Promise<RewardSync> {
  const result: RewardSync = { fixed: 0, added: [], removed: [], errors: [] };
  tiers ??= await getRewardTiers(env.DB, guildId);
  if (tiers.length === 0) return result;

  const [stats, roles] = await Promise.all([
    getReporterStats(env.DB, guildId, userId),
    getMemberRoles(env, guildId, userId),
  ]);
  result.fixed = stats.fixed;
  if (!roles) return result; // no longer in the server

  for (const tier of tiers) {
    const earned = stats.fixed >= tier.threshold;
    const has = roles.includes(tier.role_id);
    if (earned === has) continue;

    const error = await setMemberRole(env, guildId, userId, tier.role_id, earned);
    if (error) result.errors.push(error);
    else (earned ? result.added : result.removed).push(tier);
  }

  return result;
}

/** Celebrate newly earned roles in the updates channel and the member's DMs. */
export async function announceRewards(env: Bindings, guild: GuildRow, userId: string, sync: RewardSync) {
  if (sync.added.length === 0) return;

  const roles = sync.added.map((t) => `<@&${t.role_id}>`).join(', ');
  const tasks: Promise<unknown>[] = [];

  const [stats, name, tiers] = await Promise.all([
    getReporterStats(env.DB, guild.guild_id, userId),
    getReporterName(env.DB, guild.guild_id, userId),
    getRewardTiers(env.DB, guild.guild_id),
  ]);
  const rep = reputation(stats, guild);
  const next = tiers.find((t) => t.threshold > sync.fixed);
  const url = await cardUrl(env, {
    k: 'profile',
    name: drawable(name ?? '', 40) || 'Member',
    fixed: sync.fixed,
    filed: stats.total - stats.pending - stats.rejected,
    rate: rep.rate,
    trusted: rep.trusted,
    next: next ? { at: next.threshold } : null,
    unlocked: true,
  });
  const picture = cardImage(url, `Reward unlocked for ${sync.fixed} fixed bug reports.`);

  if (guild.updates_channel_id) {
    tasks.push(
      sendChannelMessage(
        env,
        guild.updates_channel_id,
        [card([picture, text(`<@${userId}> earned ${roles} for **${sync.fixed}** fixed bug reports.`)])],
        [userId]
      )
    );
  }
  if (guild.dm_reporters) {
    tasks.push(
      sendDirectMessage(env, userId, [
        card([picture, text(`### New reward unlocked\nYou've had **${sync.fixed}** bug reports fixed and earned a new role. Thank you!`)]),
      ])
    );
  }

  await Promise.allSettled(tasks);
}
