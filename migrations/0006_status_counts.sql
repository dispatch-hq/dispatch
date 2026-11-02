-- Migration number: 0006
--
-- The server and member counts behind /api/status. Discord allows one guild list
-- call per second per bot, so every isolate shares this single row.

CREATE TABLE IF NOT EXISTS status_counts (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  servers     INTEGER,
  members     INTEGER,
  ms          INTEGER,
  read_at     INTEGER,                    -- Epoch ms of the last complete read
  discord_ok  INTEGER NOT NULL DEFAULT 1, -- Result of the last refresh attempt
  claimed_at  INTEGER NOT NULL            -- Epoch ms of the last refresh attempt
);
