import type {
  Attachment,
  GuildRow,
  LinkedGuild,
  Provider,
  ReportRow,
  ReportStatus,
  RewardTier,
} from './types';

/* -------------------------------------------------------------------------- */
/*                                   Guilds                                   */
/* -------------------------------------------------------------------------- */

export function getGuild(db: D1Database, guildId: string) {
  return db.prepare(`SELECT * FROM guilds WHERE guild_id = ?`).bind(guildId).first<GuildRow>();
}

export function isLinked(guild: GuildRow | null): guild is LinkedGuild {
  return !!guild?.provider && !!guild.installation_id && !!guild.repo_id && !!guild.repo_full_name;
}

export async function getLinkedGuild(db: D1Database, guildId: string) {
  const guild = await getGuild(db, guildId);
  return isLinked(guild) ? guild : null;
}

export function linkRepository(
  db: D1Database,
  link: {
    guildId: string;
    provider: Provider;
    installationId: number;
    repoId: number;
    fullName: string;
    linkedBy: string;
  }
) {
  return db
    .prepare(
      `INSERT INTO guilds (guild_id, provider, installation_id, repo_id, repo_full_name, linked_by, linked_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (guild_id) DO UPDATE SET
         provider = excluded.provider,
         installation_id = excluded.installation_id,
         repo_id = excluded.repo_id,
         repo_full_name = excluded.repo_full_name,
         linked_by = excluded.linked_by,
         linked_at = excluded.linked_at,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(link.guildId, link.provider, link.installationId, link.repoId, link.fullName, link.linkedBy)
    .run();
}

export function unlinkRepository(db: D1Database, guildId: string) {
  return db
    .prepare(
      `UPDATE guilds SET provider = NULL, installation_id = NULL, repo_id = NULL,
         repo_full_name = NULL, linked_by = NULL, linked_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE guild_id = ?`
    )
    .bind(guildId)
    .run();
}

export type GuildSettings = Partial<
  Pick<
    GuildRow,
    'triage_channel_id' | 'updates_channel_id' | 'staff_role_id' | 'dm_reporters' | 'labels' | 'cooldown_seconds'
  >
>;

export function updateSettings(db: D1Database, guildId: string, settings: GuildSettings) {
  const entries = Object.entries(settings).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return Promise.resolve();

  // Keys come from the typed GuildSettings above, never from user input.
  const columns = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  return db
    .prepare(
      `INSERT INTO guilds (guild_id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})
       ON CONFLICT (guild_id) DO UPDATE SET
         ${columns.map((c) => `${c} = excluded.${c}`).join(', ')},
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(guildId, ...values)
    .run();
}

/** Webhook: the app was uninstalled, or repos were removed from an installation. */
export function unlinkByInstallation(db: D1Database, provider: Provider, installationId: number, repoIds?: number[]) {
  const repoFilter = repoIds?.length ? `AND repo_id IN (${repoIds.map(() => '?').join(', ')})` : '';
  return db
    .prepare(
      `UPDATE guilds SET provider = NULL, installation_id = NULL, repo_id = NULL,
         repo_full_name = NULL, linked_by = NULL, linked_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE provider = ? AND installation_id = ? ${repoFilter}`
    )
    .bind(provider, installationId, ...(repoIds ?? []))
    .run();
}

export function renameRepository(db: D1Database, provider: Provider, repoId: number, fullName: string) {
  return db.batch([
    db
      .prepare(`UPDATE guilds SET repo_full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE provider = ? AND repo_id = ?`)
      .bind(fullName, provider, repoId),
    db
      .prepare(`UPDATE reports SET repo_full_name = ? WHERE provider = ? AND repo_id = ?`)
      .bind(fullName, provider, repoId),
  ]);
}

/* -------------------------------------------------------------------------- */
/*                                  Reports                                   */
/* -------------------------------------------------------------------------- */

export function parseAttachments(report: Pick<ReportRow, 'attachments'>): Attachment[] {
  try {
    return JSON.parse(report.attachments) as Attachment[];
  } catch {
    return [];
  }
}

export type NewReport = {
  guildId: string;
  reporterId: string;
  reporterName: string;
  title: string;
  description: string;
  steps: string | null;
  environment: string | null;
  sourceUrl: string | null;
  attachments: Attachment[];
};

export async function createReport(db: D1Database, report: NewReport): Promise<ReportRow> {
  const row = await db
    .prepare(
      `INSERT INTO reports (guild_id, reporter_id, reporter_name, title, description, steps, environment, source_url, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .bind(
      report.guildId,
      report.reporterId,
      report.reporterName,
      report.title,
      report.description,
      report.steps,
      report.environment,
      report.sourceUrl,
      JSON.stringify(report.attachments)
    )
    .first<ReportRow>();
  if (!row) throw new Error('Failed to insert report');
  return row;
}

export function deleteReport(db: D1Database, id: number) {
  return db.prepare(`DELETE FROM reports WHERE id = ?`).bind(id).run();
}

export function getReport(db: D1Database, id: number) {
  return db.prepare(`SELECT * FROM reports WHERE id = ?`).bind(id).first<ReportRow>();
}

export function findReportsByIssue(db: D1Database, provider: Provider, repoId: number, issueNumber: number) {
  return db
    .prepare(`SELECT * FROM reports WHERE provider = ? AND repo_id = ? AND issue_number = ?`)
    .bind(provider, repoId, issueNumber)
    .all<ReportRow>()
    .then((r) => r.results);
}

/** Seconds since the reporter's most recent report in this guild, or null. */
export async function secondsSinceLastReport(db: D1Database, guildId: string, reporterId: string) {
  const row = await db
    .prepare(
      `SELECT CAST(strftime('%s', 'now') - strftime('%s', MAX(created_at)) AS INTEGER) AS age
       FROM reports WHERE guild_id = ? AND reporter_id = ?`
    )
    .bind(guildId, reporterId)
    .first<{ age: number | null }>();
  return row?.age ?? null;
}

export function setTriageMessage(db: D1Database, id: number, channelId: string, messageId: string) {
  return db
    .prepare(
      `UPDATE reports SET triage_channel_id = ?, triage_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .bind(channelId, messageId, id)
    .run();
}

/**
 * Atomically moves a report out of `pending`. Returns false if someone else
 * already handled it (double-clicks, two moderators at once).
 */
export async function claimPendingReport(
  db: D1Database,
  id: number,
  status: 'open' | 'rejected',
  reviewer: string,
  note: string | null = null
) {
  const result = await db
    .prepare(
      `UPDATE reports SET status = ?, reviewed_by = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    )
    .bind(status, reviewer, note, id)
    .run();
  return result.meta.changes > 0;
}

/** Puts a claimed report back in the queue after a failed publish. */
export function releaseReport(db: D1Database, id: number) {
  return db
    .prepare(`UPDATE reports SET status = 'pending', reviewed_by = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(id)
    .run();
}

export function markPublished(
  db: D1Database,
  id: number,
  issue: { provider: Provider; repoId: number; fullName: string; number: number; url: string }
) {
  return db
    .prepare(
      `UPDATE reports SET status = 'open', provider = ?, repo_id = ?, repo_full_name = ?,
         issue_number = ?, issue_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(issue.provider, issue.repoId, issue.fullName, issue.number, issue.url, id)
    .run();
}

export function setReportStatus(db: D1Database, id: number, status: ReportStatus) {
  return db
    .prepare(`UPDATE reports SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(status, id)
    .run();
}

export type ReporterStats = {
  total: number;
  pending: number;
  open: number;
  fixed: number;
  rejected: number;
};

export async function getReporterStats(db: D1Database, guildId: string, reporterId: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(status = 'pending'), 0) AS pending,
         COALESCE(SUM(status = 'open'), 0) AS open,
         COALESCE(SUM(status = 'fixed'), 0) AS fixed,
         COALESCE(SUM(status = 'rejected'), 0) AS rejected
       FROM reports WHERE guild_id = ? AND reporter_id = ?`
    )
    .bind(guildId, reporterId)
    .first<ReporterStats>();
  return row ?? { total: 0, pending: 0, open: 0, fixed: 0, rejected: 0 };
}

export function getRecentReports(db: D1Database, guildId: string, reporterId: string, limit = 5) {
  return db
    .prepare(
      `SELECT * FROM reports WHERE guild_id = ? AND reporter_id = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(guildId, reporterId, limit)
    .all<ReportRow>()
    .then((r) => r.results);
}

export function getLeaderboard(db: D1Database, guildId: string, limit = 10) {
  return db
    .prepare(
      `SELECT reporter_id, COUNT(*) AS fixed FROM reports
       WHERE guild_id = ? AND status = 'fixed'
       GROUP BY reporter_id ORDER BY fixed DESC, MIN(updated_at) ASC LIMIT ?`
    )
    .bind(guildId, limit)
    .all<{ reporter_id: string; fixed: number }>()
    .then((r) => r.results);
}

/** Reporters with at least `threshold` fixed reports — used when a new tier is added. */
export function getQualifiedReporters(db: D1Database, guildId: string, threshold: number, limit: number) {
  return db
    .prepare(
      `SELECT reporter_id FROM reports WHERE guild_id = ? AND status = 'fixed'
       GROUP BY reporter_id HAVING COUNT(*) >= ? LIMIT ?`
    )
    .bind(guildId, threshold, limit)
    .all<{ reporter_id: string }>()
    .then((r) => r.results.map((row) => row.reporter_id));
}

/* -------------------------------------------------------------------------- */
/*                                  Rewards                                   */
/* -------------------------------------------------------------------------- */

export function getRewardTiers(db: D1Database, guildId: string) {
  return db
    .prepare(`SELECT * FROM reward_tiers WHERE guild_id = ? ORDER BY threshold ASC`)
    .bind(guildId)
    .all<RewardTier>()
    .then((r) => r.results);
}

export function upsertRewardTier(db: D1Database, tier: RewardTier) {
  return db
    .prepare(
      `INSERT INTO reward_tiers (guild_id, role_id, threshold) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, role_id) DO UPDATE SET threshold = excluded.threshold`
    )
    .bind(tier.guild_id, tier.role_id, tier.threshold)
    .run();
}

export async function deleteRewardTier(db: D1Database, guildId: string, roleId: string) {
  const result = await db
    .prepare(`DELETE FROM reward_tiers WHERE guild_id = ? AND role_id = ?`)
    .bind(guildId, roleId)
    .run();
  return result.meta.changes > 0;
}
