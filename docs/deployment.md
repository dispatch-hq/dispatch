# Deployment

Dispatch is a single Cloudflare Worker. Discord and GitHub both reach it over HTTPS:

| Route | Called by | Purpose |
| --- | --- | --- |
| `POST /interactions` | Discord | Slash commands, buttons, selects, modals (`POST /` also works) |
| `GET /github/callback` | GitHub | OAuth / installation redirect while linking a repository |
| `POST /github/link` | Admin's browser | Confirms the chosen repository |
| `POST /github/webhook` | GitHub | Issue closed / reopened / commented, app uninstalled, repo renamed |
| `GET /files/reports/*` | Anyone with the link | Attachments rehosted from Discord |
| `GET /` | Anyone | Landing site (static assets from `site/`) |
| `GET /invite` | Anyone | Redirects to Discord's *Add to Discord* authorize page for this environment |
| `GET /shell/` | The Worker | Hidden site frame that the GitHub sign-in pages are rendered into |

Below, `PUBLIC_URL` is the Worker's public origin, e.g. `https://dispatch.example.workers.dev`. Repeat each step for the **beta** environment (`--env beta`) if you use one.

## 1. Cloudflare resources

```sh
# D1 (already referenced in wrangler.jsonc)
npx wrangler d1 create dispatch-db

# R2 bucket for attachments
npx wrangler r2 bucket create dispatch-files

# Apply the schema
npm run prod:migrate
```

Set `PUBLIC_URL` under `vars` in `wrangler.jsonc`.

## 2. Discord application

In the [Developer Portal](https://discord.com/developers/applications):

1. Copy the **Application ID** and **Public Key** into `wrangler.jsonc` (`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`).
2. **Bot → Reset Token** and store it as the `DISCORD_TOKEN` secret (step 4). No privileged intents are needed.
3. After the first deploy, set **Interactions Endpoint URL** to `PUBLIC_URL/interactions`.
4. Invite the bot with the *Add to Discord* button on `PUBLIC_URL`. It asks for *View Channel*, *Send Messages*, *Embed Links*, *Manage Roles* and *Create Public Threads* (for the discussion thread on each triage report; without it, reports are still queued, just without a thread). Servers that added the bot earlier can grant *Create Public Threads* on the triage channel, or re-invite it.

> For reward roles, Dispatch's own role must sit **above** every reward role in *Server Settings → Roles*. Otherwise Discord refuses the assignment, and `/dispatch rewards add` tells you so.

## 3. GitHub App

Create one at **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**. Use an organization's settings if the org should own it.

| Setting | Value |
| --- | --- |
| Homepage URL | `PUBLIC_URL` |
| Callback URL | `PUBLIC_URL/github/callback` |
| Request user authorization (OAuth) during installation | ✅ Enabled — admins land straight on the repo picker after installing |
| Webhook → Active | ✅ |
| Webhook URL | `PUBLIC_URL/github/webhook` |
| Webhook secret | a long random string → `GITHUB_WEBHOOK_SECRET` |
| Repository permissions | **Issues: Read and write** · Metadata: Read-only |
| Subscribe to events | **Issues**, **Issue comment**, **Repository** |
| Where can this app be installed? | Any account |

After creating it:

* Copy the **App ID**, **Client ID** and the app's **slug** (the last part of its public URL, `github.com/apps/<slug>`) into `wrangler.jsonc` (`GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_APP_SLUG`).
* **Generate a new client secret** → `GITHUB_CLIENT_SECRET`.
* **Generate a private key** (downloads a `.pem`) → `GITHUB_PRIVATE_KEY`. Both PKCS#1 and PKCS#8 keys work.

## 4. Secrets

```sh
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_WEBHOOK_SECRET
npx wrangler secret put STATE_SECRET            # any long random string
npx wrangler secret put GITHUB_PRIVATE_KEY < dispatch.private-key.pem
```

`STATE_SECRET` signs the short-lived links used while connecting a repository. Rotating it only invalidates links currently in flight.

## 5. Deploy and register commands

```sh
npm run check           # typecheck + tests
npm run prod:deploy
npm run prod:register   # reads DISCORD_APPLICATION_ID / DISCORD_TOKEN from .env
```

`wrangler deploy` and `wrangler dev` also build the landing page (`site/`, an [Astro](https://astro.build) project) via the `build.command` in `wrangler.jsonc`, and upload it with the Worker as static assets. That is what makes Git-triggered builds (Cloudflare Workers Builds) work from a fresh clone, where `site/dist` doesn't exist; no dashboard build command is needed. Edit the page in `site/src/pages/index.astro` and its styles in `site/src/styles/global.css`; preview with `npm run site:dev`. The site's *Add to Discord* buttons link to `/invite`, which the Worker redirects to the correct Discord invite for that environment.

Re-run `prod:register` whenever command definitions change. While developing, set `DISCORD_GUILD_ID` in `.dev.vars` and run `npm run beta:register` to register to one server instantly.

## Local development

```sh
cp .dev.vars.example .dev.vars   # fill in your beta app's credentials
npm run dev:migrate
npm run dev
```

Discord and GitHub need a public URL to reach `wrangler dev`. Use a tunnel such as `cloudflared tunnel --url http://localhost:8787`, and point your beta app's endpoints and `PUBLIC_URL` at it.

Most behaviour can be exercised without any of that: `npm test` runs the full flows in-process.

## Troubleshooting

Stream the Worker's logs while you test. Discord REST failures are logged as warnings rather than shown to users.

```sh
npx wrangler tail --env beta --format pretty
```

| Symptom | Cause |
| --- | --- |
| Triage cards have no discussion thread | The bot lacks *Create Public Threads* in the triage channel. Grant it there; new reports will get threads (existing cards won't be back-filled). |
| "I can't post in #channel" in `/dispatch settings` (`403 Missing Access`) | The bot can't see that channel, typically a private category. Give it *View Channel* and *Send Messages* there. |
| Reporters never get DMs (`50278` / `50007` in the logs) | The member has DMs from server members turned off (*Server menu → Privacy Settings*). Dispatch skips the DM; updates-channel posts still work. |
| Old commands (e.g. `/repository …`) still show up | Global commands left over from an earlier version. Run `npm run beta:register -- --clear-global` (needs `DISCORD_GUILD_ID`). |
| A member picks another bot's `/leaderboard` or `/stats` | Command names aren't unique across bots. Discord shows the app name next to each command in the picker. |
| Status doesn't change when an issue is closed | Check the GitHub App's *Advanced → Recent Deliveries*. A `401` there means `GITHUB_WEBHOOK_SECRET` doesn't match. |

## Limits worth knowing

* **Attachments:** up to 3 per report, 10 MB each. Allowed types are images, mp4/webm/mov, txt/log/json. Anything else is skipped and the reporter is told.
* **Reward backfill:** adding a tier immediately grants it to up to 20 members who already qualify. That keeps it under the Workers free-plan subrequest limit. Everyone else gets it the next time one of their reports is fixed.
* **Privacy:** issues include the reporter's Discord username and, for message reports, a link to the message. Rehosted attachments are public to anyone with the link.
