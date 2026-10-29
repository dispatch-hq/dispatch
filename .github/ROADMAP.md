# Dispatch Roadmap

> Dispatch turns Discord messages into structured, actionable bug reports and issues on platforms such as GitHub, GitLab, Bitbucket, and more.

✅ done · 🟡 partial · ⬜ not started

---

## 🚀 MVP

The goal of the MVP is to make the core workflow reliable:

> **Discord message → structured bug report → issue created on an external platform**

### Core Workflow

| Feature                                      | Status | Notes |
| -------------------------------------------- | ------ | ----- |
| Receive bug reports from Discord             | ✅      | `/report` and the *Report bug* message command |
| Convert messages into structured bug reports | ✅      | Title, description, steps, environment, attachments |
| Create issues on GitHub                      | ✅      | GitHub App with per-repo installation tokens |
| Link the created issue back to Discord       | ✅      | Receipt with a *View issue* button; triage card updates |
| Handle issue creation failures gracefully    | ✅      | Clear errors; triage reports return to the queue |
| Prevent duplicate or accidental submissions  | 🟡      | Per-member cooldown and atomic triage claims. No duplicate detection yet |
| Configure repositories per Discord server    | ✅      | `/dispatch setup` |
| Basic permission and access control          | ✅      | Manage Server for admin commands, staff role for triage, OAuth-verified repo access |
| Securely store required configuration        | ✅      | Secrets in Workers secrets; no user tokens stored |

**Core MVP: `95%`**

---

## 🧩 Bug Report Quality

| Feature                               | Status | Notes |
| ------------------------------------- | ------ | ----- |
| Structured bug report format          | ✅      | |
| Required fields for reports           | ✅      | Title and description |
| Reproduction steps                    | ✅      | |
| Environment and version information   | ✅      | |
| Attachments and screenshots           | ✅      | Rehosted to R2 so links don't expire. No cleanup or per-server limits yet (see *Next up*) |
| Report review / approval workflow     | ✅      | Optional triage channel |
| Report types / label picker           | ✅      | Optional per-server list; the pick becomes an issue label |
| Discussion thread per triage report   | ✅      | Started on each queued card; needs *Create Public Threads* |
| See your open reports from anywhere   | ✅      | `/issues` with paging. Works in DMs and via user install |
| Report status synchronisation         | ✅      | Closed / reopened via webhooks |
| Update Discord when an issue is fixed | ✅      | Reporter DM + optional updates channel |

---

## 🏆 Community Rewards

| Feature                                             | Status | Notes |
| --------------------------------------------------- | ------ | ----- |
| Track accepted bug reports                          | ✅      | |
| Track fixed bug reports                             | ✅      | Closed as *completed* |
| Configurable reward thresholds                      | ✅      | `/dispatch rewards add` |
| Automatically assign Discord roles                  | ✅      | Revoked if the issue is reopened |
| Example: 5 accepted and fixed reports → reward role | ✅      | |
| Configurable milestones and roles                   | ✅      | Multiple tiers per server |

---

## 🔌 Repository Integrations

| Platform                   | Status |
| -------------------------- | ------ |
| GitHub                     | ✅      |
| GitLab                     | ⬜      |
| Bitbucket                  | ⬜      |
| Other repository platforms | ⬜      |

The core talks to code hosts only through `IssueProvider` (`src/providers/types.ts`), and every link and report records its provider. See the README for what a new provider needs.

---

## 🌐 Website

| Feature                                              | Status | Notes |
| ---------------------------------------------------- | ------ | ----- |
| Landing site                                         | ✅      | Astro, served by the Worker as static assets (`site/`) |
| Link previews (Open Graph / Twitter, banner image)   | ✅      | |
| GitHub sign-in pages share the site's design        | ✅      | Rendered into a hidden `/shell/` frame, with repository search |
| Privacy policy and terms                             | ⬜      | Needed for Discord app verification at scale |

---

## 🛠️ Discord Commands

| Area                  | Progress |
| --------------------- | -------: |
| Configuration         |   `100%` |
| Repository management |   `100%` |
| Bug report submission |   `100%` |
| Report review         |   `100%` |
| Issue management      |    `50%` |
| User rewards          |   `100%` |
| Administration        |    `75%` |

---

## 🧱 Next up

* Duplicate detection: search open issues for similar titles. Start by listing likely duplicates on the triage card and issue
* Attachment storage: per-server and global size budgets, and purging files for rejected reports and for issues that stay closed (reopening resets the clock)
* Per-server report templates (custom fields, e.g. "Game version")
* Let reporters add follow-up comments or screenshots to their issue from Discord
* GitLab provider
* Public contributor leaderboard page

## 🧱 Future Improvements

* AI-assisted bug report structuring and duplicate detection
* Automatic categorisation and labelling
* Organisation-wide configuration
* Self-hosting improvements
* Additional project management integrations (Linear, Jira)
