import { buttonStyle, makeButton, makeLinkButton, makeSlashCommand } from 'discord-hono';
import { getActiveIssues } from '../db';
import { escapeMarkdown, truncate } from '../lib/format';
import { card, divider, EPHEMERAL_V2, row, section, text, view } from '../lib/ui';
import { factory } from '../init';
import { issueRef } from '../services/reports';
import type { ReportRow } from '../types';

const PAGE_SIZE = 5;

/** Slash commands and buttons arrive with `member` in servers and `user` everywhere else. */
function viewerId(interaction: { member?: { user: { id: string } }; user?: { id: string } }) {
  return interaction.member?.user.id ?? interaction.user?.id ?? null;
}

/** D1 stores UTC as `YYYY-MM-DD HH:MM:SS`. */
function unix(timestamp: string) {
  return Math.floor(Date.parse(`${timestamp.replace(' ', 'T')}Z`) / 1000);
}

async function issuesView(db: D1Database, userId: string, requested: number) {
  // Count first via a throwaway page so a stale page number (issues closed
  // since the message was sent) can be clamped before the real query.
  const probe = await getActiveIssues(db, userId, PAGE_SIZE, 0);
  const pages = Math.max(1, Math.ceil(probe.total / PAGE_SIZE));
  const page = Math.min(Math.max(0, requested), pages - 1);
  const { issues } = page === 0 ? probe : await getActiveIssues(db, userId, PAGE_SIZE, page * PAGE_SIZE);

  if (probe.total === 0) {
    return view([
      card([
        text('## Your active issues'),
        text('Nothing open right now. Found a bug? Use `/report` in any server running Dispatch.'),
      ]),
    ]);
  }

  const items = issues.map((issue: ReportRow) => {
    const body = `**${escapeMarkdown(truncate(issue.title, 80))}**\n-# ${issueRef(issue)} · filed <t:${unix(issue.created_at)}:R>`;
    return issue.issue_url ? section(body, makeLinkButton(issue.issue_url, 'View')) : text(body);
  });

  return view([
    card([
      text(`## Your active issues\n-# ${probe.total} open across servers using Dispatch`),
      divider(),
      ...items,
      pages > 1 && divider(),
      pages > 1 && text(`-# Page ${page + 1} of ${pages}`),
      pages > 1 &&
        row(
          makeButton('issues-page', 'Previous', buttonStyle.Secondary)
            .custom_value(`${userId}:${page - 1}`)
            .disabled(page === 0),
          makeButton('issues-page', 'Next', buttonStyle.Secondary)
            .custom_value(`${userId}:${page + 1}`)
            .disabled(page >= pages - 1)
        ),
    ]),
  ]);
}

export const command_issues = factory.command(
  makeSlashCommand('issues', 'Your open bug reports across every server using Dispatch')
    .contexts([0, 1, 2])
    .integration_types([0, 1]),
  async (c) => {
    const userId = viewerId(c.interaction);
    if (!userId) return c.flags(...EPHEMERAL_V2).res(view([card([text('Could not work out who you are.')])]));
    return c.flags(...EPHEMERAL_V2).res(await issuesView(c.env.DB, userId, 0));
  }
);

export const button_issues_page = factory.component(makeButton('issues-page', 'Page'), async (c) => {
  const [ownerId, page] = (c.ref.custom_value ?? '').split(':');
  const userId = viewerId(c.interaction);
  // The message is ephemeral, but never trust the id in a custom_id on its own.
  if (!userId || userId !== ownerId) {
    return c.flags(...EPHEMERAL_V2).res(view([card([text('Run `/issues` to see your own list.')])]));
  }
  return c.flags(...EPHEMERAL_V2).update().res(await issuesView(c.env.DB, userId, Number(page) || 0));
});
