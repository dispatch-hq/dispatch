-- Migration number: 0007
--
-- What the private /admin/servers page shows. `guilds` only has servers that
-- configured the bot, so every server it's in gets a row here, kept up to date
-- by the hourly sync (see services/admin-servers.ts).

CREATE TABLE IF NOT EXISTS admin_servers (
  guild_id      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  icon          TEXT,
  member_count  INTEGER,
  online_count  INTEGER,
  owner_id      TEXT,
  owner         TEXT,             -- Discord's user object, as JSON
  details       TEXT,             -- Discord's guild object, as JSON
  first_seen    INTEGER NOT NULL, -- Epoch ms
  last_seen     INTEGER NOT NULL, -- Epoch ms of the last server list it appeared in
  left_at       INTEGER,          -- Epoch ms; cleared if the bot is added back
  refreshed_at  INTEGER           -- Epoch ms `details` was read; null until then
);
