# Database & Migrations

Dispatch stores its state in **Cloudflare D1** (serverless SQLite), bound as `DB`. All queries live in [`src/db.ts`](../src/db.ts).

## 🗄️ Schema

| Table | One row per | Notes |
| --- | --- | --- |
| `guilds` | Discord server | Linked repository (`provider`, `installation_id`, `repo_id`, `repo_full_name`) plus settings (triage/updates channels, staff role, labels, cooldown, reporter DMs). Repository columns are `NULL` when nothing is linked; settings survive unlinking. |
| `reports` | Bug report | Submitted content, rehosted attachments (JSON), status, and the issue it became. Indexed by `(provider, repo_id, issue_number)` for webhook lookups. |
| `reward_tiers` | Reward role | `threshold` fixed reports → `role_id`. |

Report status lifecycle:

```text
            ┌──▶ rejected
pending ────┤
(triage)    └──▶ open ──▶ fixed   (closed as completed — counts toward rewards)
                   ▲  └──▶ closed  (not planned / duplicate)
                   └────── reopened
```

Without a triage channel, reports skip `pending` and start at `open`.

Repositories are tracked by **id**, not name, so renames and transfers (kept in sync through the `repository` webhook) don't break anything.

> `guild_configs` from migration 0001 is no longer used. v1 links were never verified against a GitHub App installation, so servers need to run `/dispatch setup` again. The table can be dropped in a later migration.

## 🔄 Migrations

Migrations live in `migrations/` and apply in order. D1 records which ones have run.

```sh
npx wrangler d1 migrations create dispatch-db <name>   # new numbered .sql file
npm run dev:migrate                                    # local SQLite (.wrangler/)
npm run beta:migrate                                   # beta D1
npm run prod:migrate                                   # production D1
```

Write non-destructive SQL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`). The test suite applies every migration to an in-memory database, so `npm test` catches broken SQL before it ships.

## 👀 Learn more

[Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
