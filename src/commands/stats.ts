import { makeSlashCommand, makeUserOption } from 'discord-hono';
import { cardImage, cardUrl, drawable } from '../cards';
import { getGuild, getLeaderboard, getRecentReports, getReporterName, getReporterStats, getRewardTiers } from '../db';
import { escapeMarkdown, truncate } from '../lib/format';
import { card, divider, PUBLIC_V2, text, view } from '../lib/ui';
import { factory } from '../init';
import { issueRef } from '../services/reports';
import { reputation, reputationLine } from '../services/reputation';
import type { ReportRow } from '../types';
import { deny, guarded, inGuild, messages } from './shared';

const STATUS_LABEL: Record<ReportRow['status'], string> = {
  pending: 'Awaiting review',
  rejected: 'Rejected',
  open: 'Open',
  fixed: 'Fixed',
  closed: 'Closed',
};

function reportLine(report: ReportRow): string {
  const title = escapeMarkdown(truncate(report.title, 70));
  const ref = report.issue_url ? ` · [${issueRef(report)}](${report.issue_url})` : '';
  return `${title}${ref}\n-# ${STATUS_LABEL[report.status]}`;
}

export const command_stats = factory.command(
  makeSlashCommand('stats', 'Bug report stats and reward progress')
    .options([makeUserOption('member', 'Whose stats to show (defaults to you)')])
    .contexts([0])
    .integration_types([0]),
  (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const userId = c.var.member ?? ctx.member.user.id;
    return c.flags(...PUBLIC_V2).resDefer(
      guarded(async (c) => {
        const [stats, recent, tiers, guild, name] = await Promise.all([
          getReporterStats(c.env.DB, ctx.guildId, userId),
          getRecentReports(c.env.DB, ctx.guildId, userId),
          getRewardTiers(c.env.DB, ctx.guildId),
          getGuild(c.env.DB, ctx.guildId),
          getReporterName(c.env.DB, ctx.guildId, userId),
        ]);

        const filed = stats.total - stats.pending - stats.rejected;
        const next = tiers.find((t) => t.threshold > stats.fixed);
        const earned = tiers.filter((t) => t.threshold <= stats.fixed);
        const rep = reputation(stats, guild);

        const summary = [
          `**${stats.fixed}** fixed · **${filed}** filed · **${stats.pending}** awaiting review · **${stats.rejected}** rejected`,
          stats.total > 0 ? reputationLine(rep) : null,
          earned.length ? `Rewards: ${earned.map((t) => `<@&${t.role_id}>`).join(' ')}` : null,
          next ? `Next: <@&${next.role_id}> in **${next.threshold - stats.fixed}** more fixed report(s)` : null,
        ];

        const picture = await cardUrl(c.env, {
          k: 'profile',
          name: drawable(name ?? (userId === ctx.member.user.id ? ctx.member.user.username : ''), 40) || 'Member',
          fixed: stats.fixed,
          filed,
          rate: rep.rate,
          trusted: rep.trusted,
          next: next ? { at: next.threshold } : null,
          unlocked: false,
        });

        await c.followup(
          view([
            card([
              cardImage(picture, `${stats.fixed} fixed, ${filed} filed. ${reputationLine(rep)}.`),
              text(`## Bug reports\n<@${userId}>`),
              divider(),
              text(summary.filter(Boolean).join('\n')),
              recent.length > 0 && divider(),
              recent.length > 0 && text(`### Recent\n${recent.map(reportLine).join('\n')}`),
              stats.total === 0 && text('No reports yet — found a bug? Use `/report`.'),
            ]),
          ])
        );
      })
    );
  }
);

export const command_leaderboard = factory.command(
  makeSlashCommand('leaderboard', 'Top bug reporters in this server').contexts([0]).integration_types([0]),
  (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    return c.flags(...PUBLIC_V2).resDefer(
      guarded(async (c) => {
        const rows = await getLeaderboard(c.env.DB, ctx.guildId);
        const body = rows.length
          ? rows.map((r, i) => `**${i + 1}.** <@${r.reporter_id}> — **${r.fixed}** fixed`).join('\n')
          : 'No fixed reports yet. Be the first — use `/report`!';

        const picture = await cardUrl(c.env, {
          k: 'leaders',
          rows: rows.slice(0, 5).map((r) => ({ name: drawable(r.reporter_name, 40) || 'Member', fixed: r.fixed })),
        });
        await c.followup(
          view([card([cardImage(picture, 'Top bug reporters by fixed reports.'), text('## Top bug reporters'), divider(), text(body)])])
        );
      })
    );
  }
);
