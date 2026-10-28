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
import { card, colors, divider, notice, row, text, type Container } from '../lib/ui';
import { getProvider, ProviderError, type CreatedIssue } from '../providers';
import type { Bindings, GuildRow, LinkedGuild, ReportRow } from '../types';
import { sendChannelMessage, sendDirectMessage } from './discord';

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
  if (error) return `⚠️ **Couldn't create the issue:** ${error}`;
  switch (report.status) {
    case 'pending':
      return '⏳ **Awaiting review**';
    case 'rejected':
      return `❌ **Rejected** by <@${report.reviewed_by}>${report.review_note ? `\n> ${truncate(report.review_note, 300)}` : ''}`;
    case 'open':
      return `✅ **Filed** as ${issueLink(report)}${report.reviewed_by ? ` · approved by <@${report.reviewed_by}>` : ''}`;
    case 'fixed':
      return `🎉 **Fixed** · ${issueLink(report)}`;
    case 'closed':
      return `🔒 **Closed** · ${issueLink(report)}`;
  }
}

function statusColor(report: ReportRow, error?: string): number {
  if (error) return colors.danger;
  switch (report.status) {
    case 'pending':
      return colors.warning;
    case 'rejected':
      return colors.danger;
    case 'closed':
      return colors.muted;
    default:
      return colors.success;
  }
}

/** Full report card, used in the triage queue. Buttons only show while pending. */
export function reportCard(report: ReportRow, error?: string): Container {
  const attachments = parseAttachments(report);
  const images = attachments.filter(isImage);
  const files = attachments.filter((a) => !isImage(a));

  const meta = [
    `Report #${report.id}`,
    `from <@${report.reporter_id}>`,
    report.source_url ? `[source message](${report.source_url})` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const details = [
    truncate(report.description, 1500),
    report.steps ? `**Steps to reproduce**\n${truncate(report.steps, 800)}` : null,
    report.environment ? `**Environment**\n${truncate(report.environment, 300)}` : null,
    files.length ? `**Files**\n${files.map((f) => `[${escapeMarkdown(f.name)}](${f.url})`).join(' · ')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const pending = report.status === 'pending';

  return card(
    [
      text(`## ${escapeMarkdown(truncate(report.title, 200))}\n-# ${meta}`),
      divider(),
      text(details),
      images.length > 0 && makeMediaGallery(images.map((i) => i.url as `https://${string}`)),
      divider(),
      text(statusLine(report, error)),
      pending &&
        row(
          makeButton('triage-approve', ['✅', 'Approve'], buttonStyle.Success).custom_value(String(report.id)),
          makeButton('triage-reject', ['✖️', 'Reject'], buttonStyle.Danger).custom_value(String(report.id))
        ),
    ],
    statusColor(report, error)
  );
}

/** Compact confirmation shown to the reporter right after submitting. */
export function receiptCard(
  report: ReportRow,
  outcome: 'queued' | 'published',
  issue: CreatedIssue | null,
  skipped: string[]
): Container {
  const headline =
    outcome === 'queued'
      ? `### 📨 Report submitted\nThanks! **${escapeMarkdown(truncate(report.title, 150))}** is waiting for a moderator to review it. You'll get a DM when it's approved.`
      : `### ✅ Issue created\nThanks! **${escapeMarkdown(truncate(report.title, 150))}** was filed as ${issueLink(report)}.`;

  return card(
    [
      text(headline),
      skipped.length > 0 &&
        text(`-# Skipped ${skipped.length} file(s): ${skipped.map(escapeMarkdown).join(', ')} (unsupported type, too large, or over the limit of 3).`),
      issue && row(makeLinkButton(issue.url, ['🔗', 'View issue'])),
    ],
    outcome === 'queued' ? colors.brand : colors.success
  );
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
    labels: parseLabels(guild.labels),
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

function eventCopy(report: ReportRow, event: ReportEvent): { dm: string | null; channel: string | null; color: number } {
  const title = `**${escapeMarkdown(truncate(report.title, 150))}**`;
  const link = issueLink(report);
  const by = `<@${report.reporter_id}>`;

  switch (event) {
    case 'published':
      return { dm: null, channel: `📮 New bug report from ${by}: ${title} → ${link}`, color: colors.brand };
    case 'approved':
      return {
        dm: `### ✅ Report approved\nYour report ${title} was reviewed and filed as ${link}. You'll hear from me when it's fixed.`,
        channel: `📮 New bug report from ${by}: ${title} → ${link}`,
        color: colors.success,
      };
    case 'rejected':
      return {
        dm: `### Report not accepted\nYour report ${title} wasn't filed this time.${report.review_note ? `\n> ${truncate(report.review_note, 500)}` : ''}`,
        channel: null,
        color: colors.danger,
      };
    case 'fixed':
      return {
        dm: `### 🎉 Your bug was fixed!\n${link} — ${title} was closed as completed. Thanks for reporting it!`,
        channel: `🎉 Fixed: ${link} ${title} — reported by ${by}`,
        color: colors.success,
      };
    case 'closed':
      return {
        dm: `### Report closed\n${link} — ${title} was closed without a fix (e.g. not planned or duplicate).`,
        channel: `🔒 Closed: ${link} ${title}`,
        color: colors.muted,
      };
    case 'reopened':
      return {
        dm: `### Report reopened\n${link} — ${title} was reopened.`,
        channel: `🔁 Reopened: ${link} ${title}`,
        color: colors.warning,
      };
  }
}

/** Posts to the updates channel and/or DMs the reporter, per guild settings. */
export async function announce(env: Bindings, guild: GuildRow | null, report: ReportRow, event: ReportEvent) {
  const copy = eventCopy(report, event);
  const tasks: Promise<unknown>[] = [];

  if (copy.channel && guild?.updates_channel_id) {
    const ping = event === 'fixed' ? [report.reporter_id] : [];
    tasks.push(sendChannelMessage(env, guild.updates_channel_id, [notice(copy.channel, copy.color)], ping));
  }
  if (copy.dm && (guild?.dm_reporters ?? 1)) {
    tasks.push(sendDirectMessage(env, report.reporter_id, [notice(copy.dm, copy.color)]));
  }

  await Promise.allSettled(tasks);
}
