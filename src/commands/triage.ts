import { makeButton, makeLabel, makeModal, makeTextInput, textInputStyle } from 'discord-hono';
import { claimPendingReport, getGuild, getGuildRepos, getReport, releaseReport } from '../db';
import { clean } from '../lib/format';
import { canTriage } from '../lib/permissions';
import { PUBLIC_V2, view } from '../lib/ui';
import { factory } from '../init';
import { hasPremium } from '../services/premium';
import { announce, describeError, publishReport, repoUnavailable, reportCard } from '../services/reports';
import { deny, guarded, inGuild, messages } from './shared';

/**
 * Buttons on triage-queue cards. The report id travels in the custom_id
 * (`triage-approve;42`), so the cards keep working across deploys.
 */

function rejectModal(reportId: number) {
  return makeModal('triage-reject', 'Reject report', [
    makeLabel(
      'Reason (sent to the reporter)',
      makeTextInput('reason', undefined, textInputStyle.Paragraph)
        .placeholder('e.g. Duplicate of #123, or: not reproducible — please add steps')
        .max_length(500)
        .required(false)
    ),
  ]).custom_value(String(reportId));
}

async function loadForReview(db: D1Database, guildId: string, reportId: number) {
  const [guild, report] = await Promise.all([getGuild(db, guildId), getReport(db, reportId)]);
  return { guild, report: report?.guild_id === guildId ? report : null };
}

export const button_triage_approve = factory.component(
  makeButton('triage-approve', 'Approve'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const reportId = Number(c.ref.custom_value);
    const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, reportId);
    if (!guild || !report) return deny(c, 'That report no longer exists.');
    if (!canTriage(ctx.member, guild)) return deny(c, messages.staffOnly);

    // The repository the reporter chose. Reports queued before servers could have
    // several repositories carry none, and go to the primary one.
    const repos = await getGuildRepos(c.env.DB, ctx.guildId);
    if (!repos.length) return deny(c, messages.notLinked);
    const repo = report.repo_id ? repos.find((r) => r.provider === report.provider && r.repo_id === report.repo_id) : repos[0];
    const unavailable = repoUnavailable(repo, hasPremium(c.env, c.interaction, ctx.guildId), repos[0]);
    if (unavailable || !repo) return deny(c, unavailable ?? messages.notLinked);

    const claimed = await claimPendingReport(c.env.DB, reportId, 'open', ctx.member.user.id);
    if (!claimed) {
      // Someone else got there first — just refresh the card.
      return c.flags(...PUBLIC_V2).update().res(view([reportCard(report)]));
    }

    return c
      .flags(...PUBLIC_V2)
      .update()
      .resDefer(
        guarded(async (c) => {
          const claimedReport = { ...report, reviewed_by: ctx.member.user.id };
          try {
            const published = await publishReport(c.env, guild, repo, claimedReport);
            await c.followup(view([reportCard(published)]));
            await announce(c.env, guild, published, 'approved');
          } catch (error) {
            await releaseReport(c.env.DB, reportId);
            await c.followup(view([reportCard({ ...report, status: 'pending' }, describeError(error))]));
          }
        })
      );
  }
);

export const button_triage_reject = factory.component(
  makeButton('triage-reject', 'Reject'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const reportId = Number(c.ref.custom_value);
    const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, reportId);
    if (!guild || !report) return deny(c, 'That report no longer exists.');
    if (!canTriage(ctx.member, guild)) return deny(c, messages.staffOnly);
    if (report.status !== 'pending') return c.flags(...PUBLIC_V2).update().res(view([reportCard(report)]));

    return c.resModal(rejectModal(reportId));
  }
);

export const modal_triage_reject = factory.modal(rejectModal(0), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const reportId = Number(c.ref.custom_value);
  const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, reportId);
  if (!guild || !report) return deny(c, 'That report no longer exists.');
  if (!canTriage(ctx.member, guild)) return deny(c, messages.staffOnly);

  const note = clean(c.var.reason);
  const claimed = await claimPendingReport(c.env.DB, reportId, 'rejected', ctx.member.user.id, note);
  const current = claimed
    ? { ...report, status: 'rejected' as const, reviewed_by: ctx.member.user.id, review_note: note }
    : ((await getReport(c.env.DB, reportId)) ?? report);

  if (claimed) c.executionCtx.waitUntil(announce(c.env, guild, current, 'rejected'));
  return c.flags(...PUBLIC_V2).update().res(view([reportCard(current)]));
});
