-- Migration number: 0008
--
-- What the private /admin/activity page shows: who ran which command, and where.
-- Only the command's name is kept, never the values typed into it. Rows older
-- than 30 days are removed by the hourly sync (see services/activity.ts).

CREATE TABLE IF NOT EXISTS command_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  at                INTEGER NOT NULL, -- Epoch ms
  kind              TEXT NOT NULL,    -- 'slash', 'user' or 'message'
  command           TEXT NOT NULL,    -- e.g. 'dispatch setup'
  guild_id          TEXT,             -- Null in DMs
  channel_id        TEXT,
  user_id           TEXT NOT NULL,
  user_name         TEXT,
  user_global_name  TEXT,
  user_avatar       TEXT,
  locale            TEXT
);

CREATE INDEX IF NOT EXISTS command_log_at ON command_log (at);
CREATE INDEX IF NOT EXISTS command_log_guild ON command_log (guild_id, id);
CREATE INDEX IF NOT EXISTS command_log_user ON command_log (user_id, id);
