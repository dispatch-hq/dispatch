import { makeButton } from 'discord-hono';
import { getReport, isMuted, toggleVote } from '../db';
import { EPHEMERAL_V2, notice, view } from '../lib/ui';
import { factory } from '../init';
import { refreshReportMessages } from '../services/reports';
import { guarded, inGuild, messages } from './shared';

/**
 * The upvote button on triage cards and updates-channel posts. The answer is
 * private; everyone else sees the new count when the cards are redrawn.
 */
export const button_report_vote = factory.component(makeButton('report-vote', 'Upvote'), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const userId = ctx.member.user.id;
      const reportId = Number(c.ref.custom_value);
      const report = await getReport(c.env.DB, reportId);
      if (report?.guild_id !== ctx.guildId) return c.followup(view([notice('That report no longer exists.')]));
      if (report.status !== 'pending' && report.status !== 'open') {
        return c.followup(view([notice("This report is closed, so it can't take votes any more.")]));
      }
      if (report.reporter_id === userId) return c.followup(view([notice("You can't upvote your own report.")]));
      if (await isMuted(c.env.DB, ctx.guildId, userId)) return c.followup(view([notice(messages.muted)]));

      const { voted, votes } = await toggleVote(c.env.DB, reportId, userId);
      await refreshReportMessages(c.env, reportId);
      await c.followup(
        view([notice(`${voted ? 'Upvote added' : 'Upvote removed'}. This report has **${votes}** now.`)])
      );
    })
  )
);
