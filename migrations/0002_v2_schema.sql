-- Migration number: 0002
--
-- v2 schema: verified repository links, bug reports, and reward tiers.
--
-- `guild_configs` (0001) is superseded by `guilds`. Its rows are not migrated:
-- v1 links were never verified against a GitHub App installation, so admins
-- need to reconnect with `/dispatch setup`. The old table is left in place and
-- can be dropped once v2 is live.

CREATE TABLE IF NOT EXISTS guilds (
  guild_id            TEXT PRIMARY KEY,

  -- Linked repository. NULL until an admin completes `/dispatch setup`.
  provider            TEXT,              -- 'github' (future: 'gitlab', 'bitbucket')
  installation_id     INTEGER,           -- provider installation that grants access
  repo_id             INTEGER,           -- stable provider repo id (survives renames)
  repo_full_name      TEXT,              -- 'owner/name', kept fresh via webhooks
  linked_by           TEXT,              -- Discord user id
  linked_at           TEXT,

  -- Settings
  triage_channel_id   TEXT,              -- set = reports wait for staff approval
  updates_channel_id  TEXT,              -- set = issue status updates are posted here
  staff_role_id       TEXT,              -- may triage reports (in addition to Manage Server)
  dm_reporters        INTEGER NOT NULL DEFAULT 1,
  labels              TEXT    NOT NULL DEFAULT 'bug',  -- comma separated
  cooldown_seconds    INTEGER NOT NULL DEFAULT 60,

  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guilds_repo ON guilds (provider, repo_id);
CREATE INDEX IF NOT EXISTS idx_guilds_installation ON guilds (provider, installation_id);

CREATE TABLE IF NOT EXISTS reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id            TEXT NOT NULL,
  reporter_id         TEXT NOT NULL,
  reporter_name       TEXT NOT NULL,

  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  steps               TEXT,
  environment         TEXT,
  source_url          TEXT,              -- Discord message the report was created from
  attachments         TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ name, url, content_type }]

  -- pending  : waiting in the triage queue
  -- rejected : declined by staff, never reached the repository
  -- open     : issue exists and is open
  -- fixed    : issue closed as completed (counts toward rewards)
  -- closed   : issue closed for any other reason
  status              TEXT NOT NULL DEFAULT 'pending',

  provider            TEXT,
  repo_id             INTEGER,
  repo_full_name      TEXT,
  issue_number        INTEGER,
  issue_url           TEXT,

  triage_channel_id   TEXT,
  triage_message_id   TEXT,
  reviewed_by         TEXT,
  review_note         TEXT,

  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_issue ON reports (provider, repo_id, issue_number);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (guild_id, reporter_id, status);

CREATE TABLE IF NOT EXISTS reward_tiers (
  guild_id            TEXT    NOT NULL,
  role_id             TEXT    NOT NULL,
  threshold           INTEGER NOT NULL,  -- fixed reports required
  PRIMARY KEY (guild_id, role_id)
);
