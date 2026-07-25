# Database Management & Migrations

This project uses **Cloudflare D1** (a serverless SQLite database) to store persistent data for the bot.

## 🗄️ How It Works

D1 operates differently depending on whether you are running locally or in production:

```text
Local Dev (npm run dev)            Production (Worker)
       ↓                                    ↓
.wrangler/state/v3/d1                Cloudflare Edge D1
(Local SQLite File)                  (Global Distributed DB)
       ↑                                    ↑
npm run dev:migrate                  npm run prod:migrate
```

* **Local Development:** `wrangler dev` creates and interacts with a local SQLite database file inside the `.wrangler/` directory. Your production database is never touched during local development.
* **Production:** The Worker communicates directly with your remote Cloudflare D1 instance via the `DB` binding configured in `wrangler.jsonc`.

The D1 binding is configured in `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dispatch-db",
      // Remote D1 ID (Required by Wrangler schema, but ignored during local dev)
      "database_id": "164ae147-457c-4ae2-8aba-d6d2743a284d"
    }
  ]
}
```

> **Note:** Do not remove the `database_id` field on local or beta branches. Wrangler requires it for configuration validation even when executing locally against SQLite.

---

## 🔄 Schema Migrations (Zero Data Loss)

To modify the database schema without wiping existing user data, use **incremental migrations**. D1 tracks which migration files have been applied using an internal system table, executing only new scripts.

### 1. Create a Migration Script

Generate a timestamped SQL file inside the `migrations/` directory:

```sh
npm run migrate:create -- <migration_name>
# Example: npm run migrate:create -- add_user_roles
```

This generates a file like `migrations/0001_add_user_roles.sql`.

### 2. Write Non-Destructive SQL

Open the generated migration file and write your schema updates using non-destructive SQL (`ALTER TABLE`, `CREATE TABLE IF NOT EXISTS`):

```sql
-- migrations/0001_add_user_roles.sql
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  theme TEXT DEFAULT 'dark'
);
```

### 3. Apply Migrations Locally

Apply pending migration scripts to your local SQLite database:

```sh
npm run dev:migrate
```

### 4. Apply Migrations to Production

When deploying schema changes to live production users:

```sh
npm run prod:migrate
```

---

## 🛠️ Database Scripts Summary

| Command | Description |
| --- | --- |
| `npm run migrate:create -- <name>` | Generates a new timestamped `.sql` migration file in `migrations/` |
| `npm run dev:migrate` | Applies unapplied migration files to the local SQLite database |
| `npm run prod:migrate` | Applies unapplied migration files to the production Cloudflare D1 database |

---

## 👀 Want to learn more?

Check out the official [Cloudflare D1 Migrations documentation](https://developers.cloudflare.com/d1/reference/migrations/).