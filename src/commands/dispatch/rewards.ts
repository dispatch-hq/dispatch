import { makeIntegerOption, makeRoleOption, makeSubCommand, makeSubCommandGroup } from 'discord-hono';
import { deleteRewardTier, getQualifiedReporters, getRewardTiers, upsertRewardTier } from '../../db';
import { card, divider, notice, PUBLIC_V2, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { syncRewards } from '../../services/rewards';
import { announceReply, deny, guarded, inGuild, messages } from '../shared';

/** Existing reporters who qualify when a tier is added are backfilled, up to this many per run. */
const BACKFILL_LIMIT = 20;

const ROLE_HELP =
  'Make sure Dispatch has **Manage Roles** and that its own role sits **above** the reward role in Server Settings → Roles.';

const sub_add = factory.subCommand(
  makeSubCommand('add', 'Grant a role once a member has enough fixed bug reports').options([
    makeRoleOption('role', 'Role to grant').required(true),
    makeIntegerOption('reports', 'Fixed reports required').required(true).min_value(1).max_value(1000),
  ]),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const roleId = c.var.role;
    const threshold = c.var.reports;
    const role = c.ref.roles?.[roleId];
    if (roleId === ctx.guildId) return deny(c, "`@everyone` can't be a reward.");
    if (role?.managed) return deny(c, `<@&${roleId}> is managed by an integration and can't be assigned.`);

    return c.flags(...PUBLIC_V2).resDefer(
      guarded(async (c) => {
        await upsertRewardTier(c.env.DB, { guild_id: ctx.guildId, role_id: roleId, threshold });

        const tiers = await getRewardTiers(c.env.DB, ctx.guildId);
        const qualified = await getQualifiedReporters(c.env.DB, ctx.guildId, threshold, BACKFILL_LIMIT);
        let granted = 0;
        let blocked = false;
        for (const userId of qualified) {
          const sync = await syncRewards(c.env, ctx.guildId, userId, tiers);
          granted += sync.added.filter((t) => t.role_id === roleId).length;
          blocked ||= sync.errors.includes('missing_permissions');
        }

        const lines = [
          `### Reward saved\nMembers get <@&${roleId}> once **${threshold}** of their reports are fixed.`,
          granted > 0 ? `Granted it to **${granted}** member(s) who already qualify.` : null,
          qualified.length === BACKFILL_LIMIT
            ? `-# Others who already qualify will receive it the next time one of their reports is fixed.`
            : null,
          blocked ? `I couldn't assign the role. ${ROLE_HELP}` : null,
        ];
        await c.followup(view([notice(lines.filter(Boolean).join('\n'))]));
      })
    );
  }
);

const sub_remove = factory.subCommand(
  makeSubCommand('remove', 'Stop granting a reward role').options([
    makeRoleOption('role', 'Reward role to remove').required(true),
  ]),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const removed = await deleteRewardTier(c.env.DB, ctx.guildId, c.var.role);
    return removed
      ? announceReply(c, `<@&${c.var.role}> is no longer a reward. Members who already have it keep it.`)
      : deny(c, `<@&${c.var.role}> isn't a reward role.`);
  }
);

const sub_list = factory.subCommand(makeSubCommand('list', 'Show reward roles'), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const tiers = await getRewardTiers(c.env.DB, ctx.guildId);
  const body = tiers.length
    ? tiers.map((t) => `**${t.threshold}** fixed → <@&${t.role_id}>`).join('\n')
    : 'No reward roles yet. Add one with `/dispatch rewards add`.';

  return c.flags(...PUBLIC_V2).res(
    view([
      card([
        text('## Reward roles'),
        text(body),
        divider(),
        text(`-# A report counts once its issue is closed as **completed**. Reopening it takes the credit back. ${ROLE_HELP}`),
      ]),
    ])
  );
});

const rewardSubs = [sub_add, sub_remove, sub_list];

export const group_rewards = factory.subCommandGroup(
  makeSubCommandGroup('rewards', 'Roles granted for fixed bug reports').options(factory.getSubCommands(rewardSubs)),
  factory.subLoader(rewardSubs)
);
