# Database & Migrations

Dispatch stores its state in **Cloudflare D1** (serverless SQLite), bound as `DB`. All queries live in [`src/db.ts`](../src/db.ts).

## 🗄️ Schema

| Table | One row per | Notes |
| --- | --- | --- |
| `guilds` | Discord server | Settings (triage/updates channels, staff role, labels, report types, cooldown, reporter DMs). Survive unlinking. The `provider`/`installation_id`/`repo_*` columns from migration 0002 are no longer read; links live in `guild_repos`. |
| `guild_repos` | Linked repository | One row per repository connected to a server (`provider`, `installation_id`, `repo_id`, `repo_full_name`). The oldest row is the server's primary repository. Servers without Premium keep exactly one; Premium servers can connect up to 10. |
| `reports` | Bug report | Submitted content, rehosted attachments (JSON), status, the repository it targets (set when submitted, so queued reports know where to go), and the issue it became. Indexed by `(provider, repo_id, issue_number)` for webhook lookups. |
| `report_drafts` | Pending "Report bug" | The text of a message parked while the reporter picks a report type, so the form can still be pre-filled. Ignored after a day and swept on the next write. |
| `reward_tiers` | Reward role | `threshold` fixed reports → `role_id`. |
| `report_votes` | Upvote | One row per member per report. `reports.votes` is the count, recomputed on every change so cards can draw it without a join. |
| `canned_replies` | Saved reply | A staff reply offered on *Reject* and *Request info*. Names are unique per server, ignoring case. |
| `muted_reporters` | Muted member | Can't report or vote in that server. |

Report status lifecycle:

```text
            ┌──▶ rejected
pending ────┤
(triage)    └──▶ open ──▶ fixed   (closed as completed — counts toward rewards)
                   ▲  └──▶ closed  (not planned / duplicate)
                   └────── reopened
```

Without a triage channel, reports skip `pending` and start at `open`, as do reports from a fast-tracked member. While staff wait on the reporter a report stays `pending`, with its question in `info_request`.

Repositories are tracked by **id**, not name, so renames and transfers (kept in sync through the `repository` webhook) don't break anything.

> Premium (multiple repositories) is checked from the Discord entitlements that arrive with every interaction, so nothing about subscriptions is stored. Without Premium only the primary repository is usable; extra ones are kept but paused.

> `guild_configs` from migration 0001 is no longer used. v1 links were never verified against a GitHub App installation, so servers need to run `/dispatch setup` again. The table can be dropped in a later migration.

## 🔄 Migrations

Migrations live in `migrations/` and apply in order. D1 records which ones have run.

```sh
npx wrangler d1 migrations create dispatch-db <name>   # new numbered .sql file
npm run dev:migrate                                    # local SQLite (.wrangler/)
npm run beta:migrate                                   # beta D1
npm run prod:migrate                                   # production D1
```

**Migrate before you deploy.** Cloudflare builds and deploys on every push, but it does not run migrations. Code that reads a new column fails until the migration has run, so apply `beta:migrate` / `prod:migrate` first. Additive migrations (new columns and tables with defaults) are safe to run ahead of the code.

Write non-destructive SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`). The test suite applies every migration to an in-memory database, so `npm test` catches broken SQL before it ships.

## 👀 Learn more

[Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
