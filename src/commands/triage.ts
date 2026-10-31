import { makeButton, makeLabel, makeLinkButton, makeModal, makeStringSelect, makeTextInput, textInputStyle } from 'discord-hono';
import {
  answerInfoRequest,
  claimPendingReport,
  getCannedReplies,
  getCannedReply,
  getGuild,
  getGuildRepos,
  getReport,
  releaseReport,
  setInfoRequest,
} from '../db';
import { clean, escapeMarkdown, truncate } from '../lib/format';
import { canTriage } from '../lib/permissions';
import { card, EPHEMERAL_V2, notice, PUBLIC_V2, row, text, view } from '../lib/ui';
import { factory } from '../init';
import { refreshBoard } from '../services/board';
import { sendChannelMessage, sendDirectMessage } from '../services/discord';
import { hasPremium } from '../services/premium';
import { announce, describeError, publishReport, refreshReportMessages, repoUnavailable, reportCard, reportPicture } from '../services/reports';
import type { Bindings, CannedReply, GuildRow, ReportRow } from '../types';
import { deny, guarded, inGuild, messages, viewerId } from './shared';

/**
 * Buttons on triage-queue cards. The report id travels in the custom_id
 * (`triage-approve;42`), so the cards keep working across deploys.
 */

const EPHEMERAL_FLAG = 1 << 6;

type Decision = 'reject' | 'info';

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

function infoModal(reportId: number) {
  return makeModal('triage-info', 'Ask the reporter', [
    makeLabel(
      'What do you need to know?',
      makeTextInput('question', undefined, textInputStyle.Paragraph)
        .placeholder('e.g. Which version are you on? Can you add a screenshot of the error?')
        .max_length(500)
        .required(true)
    ),
  ]).custom_value(String(reportId));
}

function modalFor(decision: Decision, reportId: number) {
  return decision === 'reject' ? rejectModal(reportId) : infoModal(reportId);
}

/** Saved replies to choose from, offered when the server has any. Only the clicker sees this. */
function repliesPicker(decision: Decision, report: ReportRow, replies: CannedReply[]) {
  const select = makeStringSelect('triage-canned', [
    ...replies.map((reply) => [String(reply.id), truncate(reply.label, 100)] as const),
    ['custom', 'Write my own…'] as const,
  ])
    .placeholder('Choose a saved reply')
    .custom_value(`${decision}:${report.id}`);

  const title = escapeMarkdown(truncate(report.title, 100));
  const heading = decision === 'reject' ? `### Reject “${title}”` : `### Ask about “${title}”`;
  return view([card([text(`${heading}\nThe reporter gets this by DM.`), row(select)])]);
}

async function loadForReview(db: D1Database, guildId: string, reportId: number) {
  const [guild, report] = await Promise.all([getGuild(db, guildId), getReport(db, reportId)]);
  return { guild, report: report?.guild_id === guildId ? report : null };
}

/** The outcome of rejecting or asking, in words for the staff member who did it. */
async function applyDecision(
  env: Bindings,
  guild: GuildRow,
  report: ReportRow,
  reviewerId: string,
  decision: Decision,
  note: string | null
): Promise<string> {
  if (decision === 'reject') {
    const claimed = await claimPendingReport(env.DB, report.id, 'rejected', reviewerId, note);
    if (!claimed) {
      await refreshReportMessages(env, report.id);
      return 'Someone else already handled that report.';
    }
    await announce(env, guild, { ...report, status: 'rejected', reviewed_by: reviewerId, review_note: note }, 'rejected');
    await refreshReportMessages(env, report.id);
    return `Rejected report #${report.id}.`;
  }

  if (report.status !== 'pending' || !note) {
    await refreshReportMessages(env, report.id);
    return 'That report has already been reviewed.';
  }
  await setInfoRequest(env.DB, report.id, note, reviewerId);
  const asked = { ...report, info_request: note, info_requested_by: reviewerId };

  const sent = await sendDirectMessage(env, report.reporter_id, [
    card([
      await reportPicture(env, guild, asked),
      text(
        `### A moderator has a question\nAbout your report **${escapeMarkdown(truncate(report.title, 150))}**:\n> ${truncate(note, 500)}`
      ),
      row(makeButton('report-info', 'Add details').custom_value(String(report.id))),
    ]),
  ]);
  await refreshReportMessages(env, report.id);
  return sent
    ? `Asked <@${report.reporter_id}> by DM. The card updates when they answer.`
    : `I couldn't DM <@${report.reporter_id}>, probably because of their privacy settings. Try asking in the report's thread.`;
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

    return c
      .flags(...PUBLIC_V2)
      .update()
      .resDefer(
        guarded(async (c) => {
          if (!claimed) {
            // Someone else got there first — just refresh the card.
            await c.followup(view([await reportCard(c.env, guild, report)]));
            return;
          }
          const claimedReport = { ...report, info_request: null, info_requested_by: null, reviewed_by: ctx.member.user.id };
          try {
            const published = await publishReport(c.env, guild, repo, claimedReport);
            await c.followup(view([await reportCard(c.env, guild, published)]));
            await announce(c.env, guild, published, 'approved');
            await refreshBoard(c.env, ctx.guildId);
          } catch (error) {
            await releaseReport(c.env.DB, reportId);
            await c.followup(view([await reportCard(c.env, guild, { ...report, status: 'pending' }, describeError(error))]));
          }
        })
      );
  }
);

/** Reject and Request info both ask the same way: saved replies if there are any, otherwise a form. */
function decisionButton(decision: Decision) {
  return async (c: Parameters<Parameters<typeof factory.component>[1]>[0]) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const reportId = Number(c.ref.custom_value);
    const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, reportId);
    if (!guild || !report) return deny(c, 'That report no longer exists.');
    if (!canTriage(ctx.member, guild)) return deny(c, messages.staffOnly);
    if (report.status !== 'pending') {
      return c
        .flags(...PUBLIC_V2)
        .update()
        .resDefer(guarded(async (c) => c.followup(view([await reportCard(c.env, guild, report)]))));
    }

    const replies = await getCannedReplies(c.env.DB, ctx.guildId);
    return replies.length
      ? c.flags(...EPHEMERAL_V2).res(repliesPicker(decision, report, replies))
      : c.resModal(modalFor(decision, reportId));
  };
}

export const button_triage_reject = factory.component(makeButton('triage-reject', 'Reject'), decisionButton('reject'));
export const button_triage_info = factory.component(makeButton('triage-info', 'Request info'), decisionButton('info'));

export const select_triage_canned = factory.component(makeStringSelect('triage-canned', [['0', 'reply']]), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const [decision, id] = (c.ref.custom_value ?? '').split(':') as [Decision, string];
  const reportId = Number(id);
  const choice = c.ref.values?.[0];
  if (choice === 'custom') return c.resModal(modalFor(decision, reportId));

  return c
    .flags(...EPHEMERAL_V2)
    .update()
    .resDefer(
      guarded(async (c) => {
        const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, reportId);
        if (!guild || !report) return c.followup(view([notice('That report no longer exists.')]));
        if (!canTriage(ctx.member, guild)) return c.followup(view([notice(messages.staffOnly)]));

        const reply = await getCannedReply(c.env.DB, ctx.guildId, Number(choice));
        if (!reply) return c.followup(view([notice('That saved reply no longer exists. Click the button on the card again.')]));

        const outcome = await applyDecision(c.env, guild, report, ctx.member.user.id, decision, reply.body);
        await c.followup(view([notice(outcome)]));
      })
    );
});

/**
 * A form submitted from the saved-replies picker replaces the picker; one opened
 * directly from a card gets a new private message, leaving the card alone.
 */
function decisionModal(decision: Decision, field: 'reason' | 'question') {
  return (c: Parameters<Parameters<typeof factory.modal>[1]>[0]) => {
    const work = guarded<typeof c>(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const { guild, report } = await loadForReview(c.env.DB, ctx.guildId, Number(c.ref.custom_value));
      if (!guild || !report) return c.followup(view([notice('That report no longer exists.')]));
      if (!canTriage(ctx.member, guild)) return c.followup(view([notice(messages.staffOnly)]));

      const outcome = await applyDecision(c.env, guild, report, ctx.member.user.id, decision, clean((c.var as Record<string, unknown>)[field]));
      await c.followup(view([notice(outcome)]));
    });

    const fromPicker = ((c.interaction.message?.flags ?? 0) & EPHEMERAL_FLAG) !== 0;
    return fromPicker ? c.flags(...EPHEMERAL_V2).update().resDefer(work) : c.flags(...EPHEMERAL_V2).resDefer(work);
  };
}

export const modal_triage_reject = factory.modal(rejectModal(0), decisionModal('reject', 'reason'));
export const modal_triage_info = factory.modal(infoModal(0), decisionModal('info', 'question'));

/* -------------------------------------------------------------------------- */
/*                            The reporter's answer                           */
/* -------------------------------------------------------------------------- */

function detailsModal(reportId: number) {
  return makeModal('report-info', 'Add details', [
    makeLabel(
      'Your answer',
      makeTextInput('details', undefined, textInputStyle.Paragraph)
        .placeholder('Anything that helps: versions, steps, what you were doing…')
        .max_length(1000)
        .required(true)
    ),
  ]).custom_value(String(reportId));
}

/** Pressed from a DM, so only the reporter's own id can be checked, against the report. */
export const button_report_info = factory.component(makeButton('report-info', 'Add details'), async (c) => {
  const reportId = Number(c.ref.custom_value);
  const report = await getReport(c.env.DB, reportId);
  if (!report || report.reporter_id !== viewerId(c.interaction)) return deny(c, 'That report no longer exists.');
  if (report.status !== 'pending' || !report.info_request) return deny(c, 'The moderators no longer need anything for this report. Thanks!');
  return c.resModal(detailsModal(reportId));
});

export const modal_report_info = factory.modal(detailsModal(0), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const reportId = Number(c.ref.custom_value);
      const report = await getReport(c.env.DB, reportId);
      if (!report || report.reporter_id !== viewerId(c.interaction)) {
        return c.followup(view([notice('That report no longer exists.')]));
      }

      const answer = clean(c.var.details);
      if (!answer || !(await answerInfoRequest(c.env.DB, reportId, answer))) {
        return c.followup(view([notice('The moderators no longer need anything for this report. Thanks!')]));
      }

      await refreshReportMessages(c.env, reportId);
      // A card's thread shares its message id, so staff see the answer where they discuss it.
      if (report.triage_message_id) {
        await sendChannelMessage(
          c.env,
          report.triage_message_id,
          [notice(`<@${report.reporter_id}> answered <@${report.info_requested_by}>:\n> ${truncate(answer, 800)}`)],
          report.info_requested_by ? [report.info_requested_by] : []
        );
      }
      await c.followup(view([notice('Thanks! Your answer was added to the report.')]));
    })
  )
);
