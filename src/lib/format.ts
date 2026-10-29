import type { Attachment, ReportRow } from '../types';

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Trimmed string, or null when empty. */
export function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Stops Discord users from pinging arbitrary GitHub users / teams through an
 * issue body. A zero-width space after `@` breaks GitHub's mention parser
 * while rendering identically.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(/(^|[^\w`])@(?=[\w-])/g, '$1@​');
}

/** Escapes Discord markdown so user-provided names render literally. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}

export function isImage(attachment: Pick<Attachment, 'content_type'>): boolean {
  return attachment.content_type.startsWith('image/');
}

export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Labels from the comma-separated guild setting, deduplicated. */
export function parseLabels(value: string): string[] {
  return [...new Set(value.split(',').map((l) => l.trim()).filter(Boolean))].slice(0, 10);
}

export const MAX_REPORT_TYPES = 10;

/**
 * Report types from the comma-separated guild setting. Each one is a select
 * option and an issue label, so names are trimmed to GitHub's 50-character
 * label limit and deduplicated ignoring case.
 */
export function parseReportTypes(value: string): string[] {
  const types = new Map<string, string>();
  for (const raw of value.split(',')) {
    const name = raw.trim().slice(0, 50).trim();
    if (name && !types.has(name.toLowerCase())) types.set(name.toLowerCase(), name);
  }
  return [...types.values()].slice(0, MAX_REPORT_TYPES);
}

export function issueTitle(report: Pick<ReportRow, 'title'>): string {
  return truncate(neutralizeMentions(report.title), 256);
}

export function issueBody(
  report: Pick<ReportRow, 'id' | 'description' | 'steps' | 'environment' | 'source_url' | 'reporter_name'>,
  attachments: Attachment[],
  publicUrl: string
): string {
  const sections: string[] = [`### Description\n\n${neutralizeMentions(report.description)}`];

  if (report.steps) sections.push(`### Steps to reproduce\n\n${neutralizeMentions(report.steps)}`);
  if (report.environment) sections.push(`### Environment\n\n${neutralizeMentions(report.environment)}`);

  if (attachments.length) {
    const lines = attachments.map((a) =>
      isImage(a) ? `![${a.name}](${a.url})` : `- [${a.name}](${a.url})`
    );
    sections.push(`### Attachments\n\n${lines.join('\n')}`);
  }

  const footer = [
    `Reported from Discord by **${neutralizeMentions(report.reporter_name)}** via [Dispatch](${publicUrl})`,
    report.source_url ? `[Original message](${report.source_url})` : null,
    `Report #${report.id}`,
  ]
    .filter(Boolean)
    .join(' · ');

  sections.push(`---\n<sub>${footer}</sub>\n<!-- dispatch:report:${report.id} -->`);
  return truncate(sections.join('\n\n'), 65_000);
}
