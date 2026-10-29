-- Migration number: 0004
--
-- Multiple repositories per server (a Premium feature). A server's repository
-- links move out of the single set of columns on `guilds` into `guild_repos`,
-- one row per linked repository. Servers without Premium keep exactly one row,
-- so they behave as before.
--
-- Existing links are copied across. The old columns on `guilds` are left in
-- place but no longer read, so this is safe to apply BEFORE deploying the code
-- that uses it (a link made with the old code in the gap between migrating and
-- deploying would need `/dispatch setup` again, so deploy straight after).

CREATE TABLE IF NOT EXISTS guild_repos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,  -- short, stable handle used in Discord custom_ids
  guild_id         TEXT    NOT NULL,
  provider         TEXT    NOT NULL,                   -- 'github'
  installation_id  INTEGER NOT NULL,
  repo_id          INTEGER NOT NULL,                   -- stable provider repo id (survives renames)
  repo_full_name   TEXT    NOT NULL,                   -- 'owner/name', kept fresh via webhooks
  linked_by        TEXT,
  linked_at        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, provider, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_repos_repo ON guild_repos (provider, repo_id);
CREATE INDEX IF NOT EXISTS idx_guild_repos_installation ON guild_repos (provider, installation_id);

INSERT OR IGNORE INTO guild_repos (guild_id, provider, installation_id, repo_id, repo_full_name, linked_by, linked_at)
SELECT guild_id, provider, installation_id, repo_id, repo_full_name, linked_by, COALESCE(linked_at, CURRENT_TIMESTAMP)
FROM guilds
WHERE provider IS NOT NULL AND installation_id IS NOT NULL AND repo_id IS NOT NULL AND repo_full_name IS NOT NULL;
