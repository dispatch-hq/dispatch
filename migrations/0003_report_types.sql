-- Migration number: 0003
--
-- Report types: an optional per-server list ("Crash, UI, Performance") that
-- members pick from before the report form opens. The chosen type is added to
-- the issue as a label. Servers with an empty list behave exactly as before.
--
-- Additive only, so apply this BEFORE deploying code that uses it.

ALTER TABLE guilds ADD COLUMN report_types TEXT NOT NULL DEFAULT '';  -- comma separated

ALTER TABLE reports ADD COLUMN report_type TEXT;                      -- the chosen type, if any

-- Holds the text of a message between "Apps -> Report bug" and the type being
-- picked, so the form can still be pre-filled. Rows are short-lived: they are
-- ignored after a day and swept whenever a new one is written.
CREATE TABLE IF NOT EXISTS report_drafts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  source      TEXT,              -- 'channelId:messageId' of the reported message
  description TEXT,              -- that message's text
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
