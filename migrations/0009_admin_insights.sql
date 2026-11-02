-- Migration number: 0009
--
-- What the private /admin/overview and /admin/failures pages add: things that
-- went wrong, and what the hourly sync reads about each server. Failures older
-- than 30 days are removed by that sync.

CREATE TABLE IF NOT EXISTS failure_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL, -- Epoch ms
  source    TEXT NOT NULL,    -- 'command', 'discord', 'github', 'attachments' or 'webhook'
  action    TEXT NOT NULL,    -- What was being attempted
  message   TEXT,             -- Never includes what members wrote
  status    INTEGER,          -- HTTP status, when there was one
  guild_id  TEXT              -- Null when it can't be tied to a server
);

CREATE INDEX IF NOT EXISTS failure_log_at ON failure_log (at);
CREATE INDEX IF NOT EXISTS failure_log_guild ON failure_log (guild_id, id);

ALTER TABLE admin_servers ADD COLUMN permissions TEXT;                -- The bot's server-wide permissions, as Discord's bitfield
ALTER TABLE admin_servers ADD COLUMN pro INTEGER NOT NULL DEFAULT 0;  -- Has an active Dispatch Pro subscription
ALTER TABLE admin_servers ADD COLUMN pro_ends INTEGER;                -- Epoch ms, if the subscription has an end date
