import { makeLinkButton } from 'discord-hono';
import {
  findReportsByIssue,
  getGuild,
  renameRepository,
  setReportStatus,
  unlinkByInstallation,
} from '../db';
import { escapeMarkdown, truncate } from '../lib/format';
import { card, divider, row, text } from '../lib/ui';
import type { Bindings, ReportRow, ReportStatus } from '../types';
import { sendDirectMessage } from './discord';
import { announce, issueRef } from './reports';
import { announceRewards, syncRewards } from './rewards';

/** Only the fields Dispatch reads from GitHub webhook payloads. */
type Repository = { id: number; full_name: string };

type IssuesEvent = {
  action: string;
  issue: { number: number; state_reason?: string | null };
  repository: Repository;
};

type IssueCommentEvent = {
  action: string;
  issue: { number: number; pull_request?: unknown };
  comment: {
    body: string;
    html_url: string;
    author_association: string;
    user: { login: string; type: string };
  };
  repository: Repository;
};

type InstallationEvent = { action: string; installation: { id: number } };

type InstallationRepositoriesEvent = InstallationEvent & {
  repositories_removed?: { id: number }[];
};

type RepositoryEvent = { action: string; repository: Repository };

const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export async function handleGitHubEvent(env: Bindings, event: string, payload: unknown): Promise<void> {
  switch (event) {
    case 'issues':
      return onIssue(env, payload as IssuesEvent);
    case 'issue_comment':
      return onIssueComment(env, payload as IssueCommentEvent);
    case 'installation': {
      const { action, installation } = payload as InstallationEvent;
      if (action === 'deleted' || action === 'suspend') {
        await unlinkByInstallation(env.DB, 'github', installation.id);
      }
      return;
    }
    case 'installation_repositories': {
      const { action, installation, repositories_removed } = payload as InstallationRepositoriesEvent;
      if (action === 'removed' && repositories_removed?.length) {
        await unlinkByInstallation(env.DB, 'github', installation.id, repositories_removed.map((r) => r.id));
      }
      return;
    }
    case 'repository': {
      const { action, repository } = payload as RepositoryEvent;
      if (action === 'renamed' || action === 'transferred') {
        await renameRepository(env.DB, 'github', repository.id, repository.full_name);
      }
      return;
    }
  }
}

function nextStatus(event: IssuesEvent): ReportStatus | null {
  if (event.action === 'reopened') return 'open';
  if (event.action === 'closed') return event.issue.state_reason === 'completed' ? 'fixed' : 'closed';
  return null;
}

async function onIssue(env: Bindings, event: IssuesEvent) {
  const status = nextStatus(event);
  if (!status) return;

  const reports = await findReportsByIssue(env.DB, 'github', event.repository.id, event.issue.number);
  for (const report of reports) {
    if (report.status === status) continue;

    await setReportStatus(env.DB, report.id, status);
    const updated: ReportRow = { ...report, status, repo_full_name: event.repository.full_name };
    const guild = await getGuild(env.DB, report.guild_id);

    await announce(env, guild, updated, status === 'open' ? 'reopened' : status === 'fixed' ? 'fixed' : 'closed');

    // Credit changes whenever a report enters or leaves `fixed`.
    if (status === 'fixed' || report.status === 'fixed') {
      const sync = await syncRewards(env, report.guild_id, report.reporter_id);
      if (guild) await announceRewards(env, guild, report.reporter_id, sync);
    }
  }
}

async function onIssueComment(env: Bindings, event: IssueCommentEvent) {
  const { comment } = event;
  if (event.action !== 'created' || event.issue.pull_request) return;
  if (comment.user.type === 'Bot' || !MAINTAINERS.has(comment.author_association)) return;

  const reports = await findReportsByIssue(env.DB, 'github', event.repository.id, event.issue.number);
  for (const report of reports) {
    const guild = await getGuild(env.DB, report.guild_id);
    if (guild && !guild.dm_reporters) continue;

    const excerpt = truncate(comment.body.trim(), 600)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');

    await sendDirectMessage(env, report.reporter_id, [
      card([
        text(
          `### New reply on ${issueRef({ ...report, repo_full_name: event.repository.full_name })}\n` +
            `**${escapeMarkdown(comment.user.login)}** commented on your report **${escapeMarkdown(truncate(report.title, 100))}**`
        ),
        divider(),
        text(excerpt),
        row(makeLinkButton(comment.html_url, 'View on GitHub')),
      ]),
    ]);
  }
}
