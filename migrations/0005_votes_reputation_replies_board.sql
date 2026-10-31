-- Migration number: 0005
--
-- Upvotes, reporter reputation, canned triage replies and the status board.
-- Everything here is additive and defaults to off, so it is safe to apply before
-- deploying the code that uses it.

-- `votes` is a count kept in step with report_votes, so cards can draw it without a join.
ALTER TABLE reports ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;
-- The updates-channel post for a report, edited as its votes and status change.
ALTER TABLE reports ADD COLUMN announce_channel_id TEXT;
ALTER TABLE reports ADD COLUMN announce_message_id TEXT;
-- Staff's open question to the reporter. The report stays `pending` while it's set.
ALTER TABLE reports ADD COLUMN info_request TEXT;
ALTER TABLE reports ADD COLUMN info_requested_by TEXT;

-- Accepted reports that let a member skip triage. 0 turns fast-tracking off.
ALTER TABLE guilds ADD COLUMN trust_min_reports INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN board_channel_id TEXT;
ALTER TABLE guilds ADD COLUMN board_message_id TEXT;
ALTER TABLE guilds ADD COLUMN board_version TEXT;

CREATE TABLE IF NOT EXISTS report_votes (
  report_id   INTEGER NOT NULL,
  user_id     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE IF NOT EXISTS canned_replies (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id  TEXT NOT NULL,
  label     TEXT NOT NULL COLLATE NOCASE,
  body      TEXT NOT NULL,
  UNIQUE (guild_id, label)
);

CREATE TABLE IF NOT EXISTS muted_reporters (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  muted_by    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_guild_status ON reports (guild_id, status);
