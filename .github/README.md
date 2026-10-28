# Dispatch

**Bug reports from Discord, straight to GitHub.**

Dispatch gives developers visibility into what their community is running into. Members report bugs from Discord through a short form, and Dispatch files a well-structured GitHub issue for them. Reporters never have to touch GitHub. They also hear back when the bug is fixed, and the best reporters earn roles.

It's a serverless Discord app: no gateway connection, no always-on process. It runs on Cloudflare Workers with [discord-hono](https://discord-hono.luis.fun), D1 and R2, so it's cheap (usually free) to host.

## ✨ Features

| | |
| --- | --- |
| 🐛 **`/report`** | A modal with title, description, steps to reproduce, environment and up to 3 screenshots/logs. Creates a GitHub issue. |
| 🖱️ **Report from a message** | Right-click any message → **Apps → Report bug**. The form is pre-filled and links back to the message. |
| 🛡️ **Triage queue** (optional) | Reports land in a staff channel first. **Approve** files the issue; **Reject** sends the reporter a reason. |
| 📣 **Status updates** | Reporters get a DM when their report is approved, fixed, closed, reopened or answered by a maintainer. An optional updates channel announces new issues and fixes. |
| 🏆 **Reward roles** | `/dispatch rewards add @Bug Hunter 5` grants a role after 5 fixed reports. Reopening an issue takes the credit back. |
| 📊 **`/stats` & `/leaderboard`** | Personal progress toward the next reward, plus the server's top reporters. |
| 🔐 **Verified linking** | Admins link a repo by signing in with GitHub. Dispatch checks they can push to it, so no server can point spam at someone else's repository. |
| 🖼️ **Durable attachments** | Uploads are copied to R2, so screenshots in issues don't break when Discord's CDN links expire. |

## 🧭 How it works

```text
Discord ──(signed HTTP interaction)──▶ Worker ──▶ GitHub App ──▶ Issue
                                         │  ▲
                                   D1 / R2│  │ webhooks (closed, reopened, comments)
                                         ▼  │
                         Discord REST (DMs, triage cards, roles)
```

* **Discord → Worker:** slash commands, buttons and modals arrive as HTTP `POST`s at `/interactions`, handled by discord-hono.
* **Worker → GitHub:** a GitHub App. Each request uses a short-lived installation token scoped to the single linked repository.
* **GitHub → Worker:** App webhooks at `/github/webhook` keep report status in sync, grant reward roles and relay maintainer comments.

A report counts as **fixed** when its issue is closed as *completed*. Issues closed as *not planned* or *duplicate* don't count.

## 🚀 Getting started

See **[docs/deployment.md](../docs/deployment.md)** for the full setup: the Discord app, the GitHub App, Cloudflare resources and secrets. In short:

```sh
npm install
npm run check          # typecheck + tests
npm run prod:migrate   # apply D1 migrations
npm run prod:deploy
npm run prod:register  # register slash commands
```

Then, in your Discord server:

1. `/dispatch setup` → install the GitHub App → sign in → pick the repository.
2. `/dispatch settings` (optional) → choose a triage channel, updates channel, staff role, labels and cooldown.
3. `/dispatch rewards add` (optional) → reward great reporters.

## 🧞 Commands

| Command | Who | What |
| --- | --- | --- |
| `/report` | Everyone | Open the bug report form |
| *Apps → Report bug* | Everyone | Report a bug from an existing message |
| `/stats [member]` | Everyone | Report counts and reward progress |
| `/leaderboard` | Everyone | Top reporters by fixed bugs |
| `/dispatch setup` | Manage Server | Connect (or change) the GitHub repository |
| `/dispatch settings` | Manage Server | Triage queue, updates channel, staff role, labels, cooldown, reporter DMs |
| `/dispatch disconnect` | Manage Server | Unlink the repository |
| `/dispatch rewards add / remove / list` | Manage Server | Configure reward roles |

`/dispatch` is hidden from members without **Manage Server** by default. Admins can change this under *Server Settings → Integrations*.

## 🗂️ Project structure

```text
src/
├── index.ts               # Worker entry: Hono routes (/interactions, /github/*, /files/*)
├── init.ts                # discord-hono factory
├── register.ts            # Slash command registration script
├── types.ts               # Bindings + row types
├── db.ts                  # All D1 queries
├── commands/              # Discord handlers (commands, buttons, selects, modals)
│   ├── report.ts          #   /report, "Report bug" message command, report modal
│   ├── triage.ts          #   Approve / reject buttons
│   ├── stats.ts           #   /stats, /leaderboard
│   └── dispatch/          #   /dispatch setup | settings | disconnect | rewards
├── services/              # Business logic shared by commands and webhooks
│   ├── reports.ts         #   Submit → triage or publish, cards, notifications
│   ├── rewards.ts         #   Role sync for reward tiers
│   ├── github-events.ts   #   GitHub webhook handling
│   ├── attachments.ts     #   Rehost uploads to R2
│   └── discord.ts         #   Discord REST helpers (DMs, channel posts, roles)
├── providers/             # Code-host integrations behind one interface
│   ├── types.ts           #   IssueProvider — implement this for GitLab, Bitbucket…
│   └── github.ts          #   GitHub App auth, issues, OAuth repo verification
├── web/                   # Non-Discord HTTP routes and pages
└── lib/                   # crypto (JWT, HMAC tokens), formatting, permissions, UI kit
migrations/                # D1 schema (applied in order)
test/                      # Vitest: unit tests + end-to-end flows against the real app
```

## 🧪 Testing

```sh
npm test
```

`test/flows.test.ts` drives the real Worker end to end: signed Discord interactions in, D1 backed by `node:sqlite` with the real migrations, and recorded GitHub/Discord HTTP calls out. It covers linking, reporting, triage, webhooks and rewards. No accounts or network access are needed.

## 🔌 Other code hosts

GitHub is the only provider today, but the core never talks to GitHub directly. It goes through `IssueProvider` (`src/providers/types.ts`), and every link and report records its `provider`. Adding GitLab or Bitbucket means:

1. Implement `IssueProvider` (create an issue, build repo URLs).
2. Add a linking flow (OAuth + "can this user write to this project?") under `src/web/`.
3. Map that host's webhooks onto the same report statuses in a `services/<host>-events.ts`.

## 📚 More

* [Deployment](../docs/deployment.md)
* [Database & migrations](../docs/database.md)
* [Roadmap](./ROADMAP.md)
* [Contributing](./CONTRIBUTING.md)
