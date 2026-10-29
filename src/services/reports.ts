import { buttonStyle, makeButton, makeLinkButton, makeMediaGallery } from 'discord-hono';
import {
  createReport,
  deleteReport,
  markPublished,
  parseAttachments,
  setTriageMessage,
  type NewReport,
} from '../db';
import { escapeMarkdown, isImage, issueBody, issueTitle, parseLabels, truncate } from '../lib/format';
import { card, divider, notice, row, section, text, type Container } from '../lib/ui';
import { getProvider, ProviderError, type CreatedIssue } from '../providers';
import type { Bindings, GuildRow, LinkedGuild, ReportRow } from '../types';
import { sendChannelMessage, sendDirectMessage, startThread } from './discord';

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
      return '**Awaiting review**';
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

/** Full report card, used in the triage queue. Buttons only show while pending. */
export function reportCard(report: ReportRow, error?: string): Container {
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
  const header = `## ${escapeMarkdown(truncate(report.title, 200))}\n-# Report #${report.id} · from <@${report.reporter_id}>${type}`;
  const pending = report.status === 'pending';

  return card([
    report.source_url ? section(header, makeLinkButton(report.source_url, 'Source message')) : text(header),
    divider(),
    text(details),
    images.length > 0 && makeMediaGallery(images.map((i) => i.url as `https://${string}`)),
    divider(),
    statusBlock(report, error),
    pending &&
      row(
        makeButton('triage-approve', 'Approve', buttonStyle.Secondary).custom_value(String(report.id)),
        makeButton('triage-reject', 'Reject', buttonStyle.Secondary).custom_value(String(report.id))
      ),
  ]);
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
  skipped: string[]
): Container {
  const title = `**${escapeMarkdown(truncate(report.title, 150))}**`;
  const headline =
    outcome === 'queued'
      ? `### Report submitted\nThanks! ${title} is waiting for a moderator to review it. You'll get a DM when it's approved.`
      : `### Issue created\nThanks! ${title} was filed as ${issueRef(report)}.`;

  return card([
    issue ? section(headline, makeLinkButton(issue.url, 'View issue')) : text(headline),
    skipped.length > 0 &&
      text(`-# Skipped ${skipped.length} file(s): ${skipped.map(escapeMarkdown).join(', ')} (unsupported type, too large, or over the limit of 3).`),
  ]);
}

/* -------------------------------------------------------------------------- */
/*                                  Pipeline                                  */
/* -------------------------------------------------------------------------- */

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
export async function publishReport(env: Bindings, guild: LinkedGuild, report: ReportRow): Promise<ReportRow> {
  const provider = getProvider(guild.provider);
  const issue = await provider.createIssue(env, guild, {
    title: issueTitle(report),
    body: issueBody(report, parseAttachments(report), env.PUBLIC_URL),
    // The server's base labels, plus the type the reporter picked (if any).
    labels: [...new Set([...parseLabels(guild.labels), ...(report.report_type ? [report.report_type] : [])])],
  });

  await markPublished(env.DB, report.id, {
    provider: guild.provider,
    repoId: guild.repo_id,
    fullName: guild.repo_full_name,
    number: issue.number,
    url: issue.url,
  });

  return {
    ...report,
    status: 'open',
    provider: guild.provider,
    repo_id: guild.repo_id,
    repo_full_name: guild.repo_full_name,
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
  guild: LinkedGuild,
  input: NewReport
): Promise<SubmitOutcome> {
  const report = await createReport(env.DB, input);

  if (guild.triage_channel_id) {
    const messageId = await sendChannelMessage(env, guild.triage_channel_id, [reportCard(report)]);
    if (messageId) {
      await setTriageMessage(env.DB, report.id, guild.triage_channel_id, messageId);
      // A thread per report keeps staff discussion out of the queue itself. Best
      // effort, and off the critical path so the reporter's receipt isn't delayed.
      ctx.waitUntil(startThread(env, guild.triage_channel_id, messageId, threadName(report)));
      return { kind: 'queued', report };
    }
    // Can't reach the triage channel (deleted, or missing permissions). Rather
    // than silently losing the report, fall through and file it directly.
    console.warn(`reports: triage channel ${guild.triage_channel_id} unavailable for guild ${guild.guild_id}`);
  }

  try {
    const published = await publishReport(env, guild, report);
    ctx.waitUntil(announce(env, guild, published, 'published'));
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

  if (copy.channel && guild?.updates_channel_id) {
    const ping = event === 'fixed' ? [report.reporter_id] : [];
    tasks.push(sendChannelMessage(env, guild.updates_channel_id, [notice(copy.channel)], ping));
  }
  if (copy.dm && (guild?.dm_reporters ?? 1)) {
    tasks.push(sendDirectMessage(env, report.reporter_id, [notice(copy.dm)]));
  }

  await Promise.allSettled(tasks);
}
