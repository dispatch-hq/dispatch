import { buttonStyle, makeButton, makeLinkButton, makeMediaGallery } from 'discord-hono';
import { cardImage, cardUrl, drawable, type CardStatus } from '../cards';
import {
  createReport,
  deleteReport,
  getGuild,
  getReport,
  getReporterStats,
  markPublished,
  parseAttachments,
  setAnnounceMessage,
  setTriageMessage,
  type NewReport,
} from '../db';
import { escapeMarkdown, isImage, issueBody, issueTitle, parseLabels, truncate } from '../lib/format';
import { card, divider, row, section, text, type Block, type Container } from '../lib/ui';
import { getProvider, ProviderError, type CreatedIssue } from '../providers';
import type { Bindings, GuildRepo, GuildRow, ReportRow } from '../types';
import { refreshBoard } from './board';
import { editChannelMessage, sendChannelMessage, sendDirectMessage, startThread } from './discord';
import { reputation, reputationLine, type Reputation } from './reputation';

/* -------------------------------------------------------------------------- */
/*                                    Cards                                   */
/* -------------------------------------------------------------------------- */

export function issueRef(report: Pick<ReportRow, 'repo_full_name' | 'issue_number'>): string {
  return `${report.repo_full_name}#${report.issue_number}`;
}

function issueLink(report: ReportRow): string {
  return report.issue_url ? `[${issueRef(report)}](${report.issue_url})` : issueRef(report);
}

function statusLine(report: ReportRow, error?: string): string {
  if (error) return `**Couldn't create the issue**\n${error}`;
  switch (report.status) {
    case 'pending':
      if (report.info_request) {
        return `**Waiting on the reporter** · asked by <@${report.info_requested_by}>\n> ${truncate(report.info_request, 300)}`;
      }
      return report.repo_full_name ? `**Awaiting review** · for ${report.repo_full_name}` : '**Awaiting review**';
    case 'rejected':
      return `**Rejected** by <@${report.reviewed_by}>${report.review_note ? `\n> ${truncate(report.review_note, 300)}` : ''}`;
    case 'open':
      return `**Filed** as ${issueRef(report)}${report.reviewed_by ? ` · approved by <@${report.reviewed_by}>` : ''}`;
    case 'fixed':
      return `**Fixed** · ${issueRef(report)}`;
    case 'closed':
      return `**Closed** · ${issueRef(report)}`;
  }
}

/** Status text with the issue link, when there is one, as a button beside it. */
function statusBlock(report: ReportRow, error?: string) {
  const line = statusLine(report, error);
  return !error && report.issue_url ? section(line, makeLinkButton(report.issue_url, 'View issue')) : text(line);
}

/** Votes count for as long as the report is still something to act on. */
function canVote(report: ReportRow): boolean {
  return report.status === 'pending' || report.status === 'open';
}

function voteButton(report: ReportRow) {
  const label = report.votes ? `Upvote · ${report.votes}` : 'Upvote';
  return makeButton('report-vote', label, buttonStyle.Secondary).custom_value(String(report.id));
}

function cardStatus(report: ReportRow): CardStatus {
  return report.status === 'pending' && report.info_request ? 'info' : report.status;
}

const STATUS_ALT: Record<CardStatus, string> = {
  pending: 'Awaiting review',
  info: 'Waiting on the reporter',
  rejected: 'Rejected',
  open: 'Open',
  fixed: 'Fixed',
  closed: 'Closed',
};

/** The image for a report, reflecting its status and votes right now. */
async function reportImage(env: Bindings, report: ReportRow, rep: Reputation) {
  const ref = report.issue_number ? issueRef(report) : report.repo_full_name;
  const url = await cardUrl(env, {
    k: 'report',
    id: report.id,
    title: drawable(report.title, 110) || `Report #${report.id}`,
    status: cardStatus(report),
    votes: report.votes,
    by: drawable(report.reporter_name, 40) || 'Member',
    rate: rep.rate,
    trusted: rep.trusted,
    type: report.report_type ? drawable(report.report_type, 30) || null : null,
    ref: ref ? drawable(ref, 70) : null,
  });
  const votes = `${report.votes} upvote${report.votes === 1 ? '' : 's'}`;
  return cardImage(url, `Report #${report.id}: ${report.title}. ${STATUS_ALT[cardStatus(report)]}, ${votes}.`);
}

async function reporterReputation(env: Bindings, guild: GuildRow | null, report: ReportRow) {
  return reputation(await getReporterStats(env.DB, report.guild_id, report.reporter_id), guild);
}

/** The picture on its own, for messages that bring their own text. */
export async function reportPicture(env: Bindings, guild: GuildRow | null, report: ReportRow) {
  return reportImage(env, report, await reporterReputation(env, guild, report));
}

/** Full report card, used in the triage queue. Review buttons only show while pending. */
export async function reportCard(env: Bindings, guild: GuildRow | null, report: ReportRow, error?: string): Promise<Container> {
  const rep = await reporterReputation(env, guild, report);
  const attachments = parseAttachments(report);
  const images = attachments.filter(isImage);
  const files = attachments.filter((a) => !isImage(a));

  const details = [
    truncate(report.description, 1500),
    report.steps ? `**Steps to reproduce**\n${truncate(report.steps, 800)}` : null,
    report.environment ? `**Environment**\n${truncate(report.environment, 300)}` : null,
    files.length ? `**Files**\n${files.map((f) => `[${escapeMarkdown(f.name)}](${f.url})`).join(' · ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const type = report.report_type ? ` · ${escapeMarkdown(report.report_type)}` : '';
  const header = `## ${escapeMarkdown(truncate(report.title, 200))}\n-# Report #${report.id} · from <@${report.reporter_id}>${type} · ${reputationLine(rep)}`;
  const pending = report.status === 'pending';

  return card([
    await reportImage(env, report, rep),
    report.source_url ? section(header, makeLinkButton(report.source_url, 'Source message')) : text(header),
    divider(),
    text(details),
    images.length > 0 && makeMediaGallery(images.map((i) => i.url as `https://${string}`)),
    divider(),
    statusBlock(report, error),
    pending
      ? row(
          makeButton('triage-approve', 'Approve', buttonStyle.Success).custom_value(String(report.id)),
          makeButton('triage-reject', 'Reject', buttonStyle.Danger).custom_value(String(report.id)),
          makeButton('triage-info', 'Request info', buttonStyle.Secondary).custom_value(String(report.id)),
          voteButton(report)
        )
      : canVote(report) && row(voteButton(report)),
  ]);
}

/** A report's post in the updates channel: the public place members can upvote it. */
async function updatesCard(env: Bindings, guild: GuildRow | null, report: ReportRow): Promise<Container> {
  const line = `**${escapeMarkdown(truncate(report.title, 150))}**\n-# Reported by <@${report.reporter_id}>${report.report_type ? ` · ${escapeMarkdown(report.report_type)}` : ''}`;
  return card([
    await reportPicture(env, guild, report),
    report.issue_url ? section(line, makeLinkButton(report.issue_url, 'View issue')) : text(line),
    canVote(report) && row(voteButton(report)),
  ]);
}

/**
 * Redraws every message that shows a report after its votes or status change. A
 * message's image URL contains what it shows, so the edit is what updates the
 * picture. Best effort: whatever can't be edited catches up on the next change.
 */
export async function refreshReportMessages(env: Bindings, reportId: number): Promise<void> {
  const report = await getReport(env.DB, reportId);
  if (!report) return;
  const guild = await getGuild(env.DB, report.guild_id);

  const tasks: Promise<unknown>[] = [refreshBoard(env, report.guild_id)];
  if (report.triage_channel_id && report.triage_message_id) {
    tasks.push(editChannelMessage(env, report.triage_channel_id, report.triage_message_id, [await reportCard(env, guild, report)]));
  }
  if (report.announce_channel_id && report.announce_message_id) {
    tasks.push(editChannelMessage(env, report.announce_channel_id, report.announce_message_id, [await updatesCard(env, guild, report)]));
  }
  await Promise.allSettled(tasks);
}

/** Discord caps thread names at 100 characters and rejects line breaks. */
export function threadName(report: Pick<ReportRow, 'id' | 'title'>): string {
  return truncate(`Report #${report.id} · ${report.title.replace(/\s+/g, ' ').trim()}`, 100);
}

/** Compact confirmation shown to the reporter right after submitting. */
export function receiptCard(
  report: ReportRow,
  outcome: 'queued' | 'published',
  issue: CreatedIssue | null,
  skipped: string[],
  picture: Block
): Container {
  const title = `**${escapeMarkdown(truncate(report.title, 150))}**`;
  const headline =
    outcome === 'queued'
      ? `### Report submitted\nThanks! ${title} is waiting for a moderator to review it. You'll get a DM when it's approved.`
      : `### Issue created\nThanks! ${title} was filed as ${issueRef(report)}.`;

  return card([
    picture,
    issue ? section(headline, makeLinkButton(issue.url, 'View issue')) : text(headline),
    skipped.length > 0 &&
      text(`-# Skipped ${skipped.length} file(s): ${skipped.map(escapeMarkdown).join(', ')} (unsupported type, too large, or over the limit of 3).`),
  ]);
}

/* -------------------------------------------------------------------------- */
/*                                  Pipeline                                  */
/* -------------------------------------------------------------------------- */

/** Why a report can't be filed in the repository it was meant for, or null if it can. */
export function repoUnavailable(repo: GuildRepo | null | undefined, premium: boolean, primary: GuildRepo | undefined): string | null {
  if (!repo) return 'That repository has been disconnected from this server.';
  if (!premium && primary && repo.id !== primary.id) {
    return `**${repo.repo_full_name}** is paused because this server no longer has Dispatch Pro.`;
  }
  return null;
}

export function describeError(error: unknown): string {
  if (error instanceof ProviderError) {
    if (error.status === 404 || error.status === 403) {
      return 'Dispatch no longer has access to the repository. An admin should re-run `/dispatch setup`.';
    }
    if (error.status === 410) return 'Issues are disabled on the linked repository.';
    return `${error.message} (${error.status}${error.detail ? `: ${truncate(error.detail, 200)}` : ''})`;
  }
  console.error(error);
  return 'Something went wrong talking to the repository host. Please try again shortly.';
}

/** Creates the issue for a report and records it. Throws `ProviderError` on failure. */
export async function publishReport(
  env: Bindings,
  guild: GuildRow,
  repo: GuildRepo,
  report: ReportRow
): Promise<ReportRow> {
  const provider = getProvider(repo.provider);
  const issue = await provider.createIssue(env, repo, {
    title: issueTitle(report),
    body: issueBody(report, parseAttachments(report), env.PUBLIC_URL),
    // The server's base labels, plus the type the reporter picked (if any).
    labels: [...new Set([...parseLabels(guild.labels), ...(report.report_type ? [report.report_type] : [])])],
  });

  await markPublished(env.DB, report.id, {
    provider: repo.provider,
    repoId: repo.repo_id,
    fullName: repo.repo_full_name,
    number: issue.number,
    url: issue.url,
  });

  return {
    ...report,
    status: 'open',
    provider: repo.provider,
    repo_id: repo.repo_id,
    repo_full_name: repo.repo_full_name,
    issue_number: issue.number,
    issue_url: issue.url,
  };
}

export type SubmitOutcome =
  | { kind: 'queued'; report: ReportRow }
  | { kind: 'published'; report: ReportRow; issue: CreatedIssue }
  | { kind: 'failed'; error: string };

/**
 * Entry point for a new report: either drop it in the triage queue or file
 * the issue straight away, depending on the guild's settings.
 */
export async function submitReport(
  env: Bindings,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  guild: GuildRow,
  repo: GuildRepo,
  input: Omit<NewReport, 'repo'>
): Promise<SubmitOutcome> {
  const report = await createReport(env.DB, { ...input, repo });

  // Reporters with a strong track record skip the queue, if the server allows it.
  const { trusted } = await reporterReputation(env, guild, report);

  if (guild.triage_channel_id && !trusted) {
    const messageId = await sendChannelMessage(env, guild.triage_channel_id, [await reportCard(env, guild, report)]);
    if (messageId) {
      await setTriageMessage(env.DB, report.id, guild.triage_channel_id, messageId);
      // A thread per report keeps staff discussion out of the queue itself. Best
      // effort, and off the critical path so the reporter's receipt isn't delayed.
      ctx.waitUntil(startThread(env, guild.triage_channel_id, messageId, threadName(report)));
      ctx.waitUntil(refreshBoard(env, guild.guild_id));
      return { kind: 'queued', report };
    }
    // Can't reach the triage channel (deleted, or missing permissions). Rather
    // than silently losing the report, fall through and file it directly.
    console.warn(`reports: triage channel ${guild.triage_channel_id} unavailable for guild ${guild.guild_id}`);
  }

  try {
    const published = await publishReport(env, guild, repo, report);
    ctx.waitUntil(announce(env, guild, published, 'published').then(() => refreshBoard(env, guild.guild_id)));
    return {
      kind: 'published',
      report: published,
      issue: { number: published.issue_number!, url: published.issue_url! },
    };
  } catch (error) {
    await deleteReport(env.DB, report.id);
    return { kind: 'failed', error: describeError(error) };
  }
}

/* -------------------------------------------------------------------------- */
/*                                Notifications                               */
/* -------------------------------------------------------------------------- */

export type ReportEvent = 'published' | 'approved' | 'rejected' | 'fixed' | 'closed' | 'reopened';

function eventCopy(report: ReportRow, event: ReportEvent): { dm: string | null; channel: string | null } {
  const title = `**${escapeMarkdown(truncate(report.title, 150))}**`;
  const link = issueLink(report);
  const by = `<@${report.reporter_id}>`;

  switch (event) {
    case 'published':
      return { dm: null, channel: `New bug report from ${by}: ${title} → ${link}` };
    case 'approved':
      return {
        dm: `### Report approved\nYour report ${title} was reviewed and filed as ${link}. You'll hear from me when it's fixed.`,
        channel: `New bug report from ${by}: ${title} → ${link}`,
      };
    case 'rejected':
      return {
        dm: `### Report not accepted\nYour report ${title} wasn't filed this time.${report.review_note ? `\n> ${truncate(report.review_note, 500)}` : ''}`,
        channel: null,
      };
    case 'fixed':
      return {
        dm: `### Your bug was fixed\n${link} — ${title} was closed as completed. Thanks for reporting it!`,
        channel: `Fixed: ${link} ${title} — reported by ${by}`,
      };
    case 'closed':
      return {
        dm: `### Report closed\n${link} — ${title} was closed without a fix (e.g. not planned or duplicate).`,
        channel: `Closed: ${link} ${title}`,
      };
    case 'reopened':
      return {
        dm: `### Report reopened\n${link} — ${title} was reopened.`,
        channel: `Reopened: ${link} ${title}`,
      };
  }
}

/** Posts to the updates channel and/or DMs the reporter, per guild settings. */
export async function announce(env: Bindings, guild: GuildRow | null, report: ReportRow, event: ReportEvent) {
  const copy = eventCopy(report, event);
  const tasks: Promise<unknown>[] = [];
  const sendsDm = copy.dm && (guild?.dm_reporters ?? 1);
  const updatesChannel = copy.channel ? guild?.updates_channel_id : null;
  if (!sendsDm && !updatesChannel) return;

  const picture = await reportPicture(env, guild, report);

  if (updatesChannel) {
    if (event === 'published' || event === 'approved') {
      // The post members upvote from. It's remembered so it can keep up with the report.
      tasks.push(
        updatesCard(env, guild, report)
          .then((post) => sendChannelMessage(env, updatesChannel, [post]))
          .then(async (id) => {
            if (id) await setAnnounceMessage(env.DB, report.id, updatesChannel, id);
          })
      );
    } else {
      const ping = event === 'fixed' ? [report.reporter_id] : [];
      tasks.push(sendChannelMessage(env, updatesChannel, [card([picture, text(copy.channel!)])], ping));
    }
  }
  if (sendsDm) {
    tasks.push(sendDirectMessage(env, report.reporter_id, [card([picture, text(copy.dm!)])]));
  }

  await Promise.allSettled(tasks);
}
