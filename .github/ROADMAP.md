# Dispatch Roadmap

> Dispatch turns Discord messages into structured, actionable bug reports and issues on platforms such as GitHub, GitLab, Bitbucket, and more.

---

## 🚀 MVP

The goal of the MVP is to make the core workflow reliable:

> **Discord message → structured bug report → issue created on an external platform**

### Core Workflow

| Feature                                      | Status |
| -------------------------------------------- | ------ |
| Receive bug reports from Discord             | ⬜      |
| Convert messages into structured bug reports | ⬜      |
| Create issues on GitHub                      | ⬜      |
| Link the created issue back to Discord       | ⬜      |
| Handle issue creation failures gracefully    | ⬜      |
| Prevent duplicate or accidental submissions  | ⬜      |
| Configure repositories per Discord server    | ⬜      |
| Basic permission and access control          | ⬜      |
| Securely store required configuration        | ⬜      |

### MVP Progress

**Core MVP: `0%`**

The MVP is complete when a user can submit a bug report through Discord and Dispatch can reliably create and reference the corresponding issue on GitHub.

---

## 🧩 Bug Report Quality

Improve the quality and usefulness of reports submitted through Dispatch.

| Feature                               | Status |
| ------------------------------------- | ------ |
| Structured bug report format          | ⬜      |
| Required fields for reports           | ⬜      |
| Reproduction steps                    | ⬜      |
| Environment and version information   | ⬜      |
| Attachments and screenshots           | ⬜      |
| Report review / approval workflow     | ⬜      |
| Report status synchronisation         | ⬜      |
| Update Discord when an issue is fixed | ⬜      |

---

## 🏆 Community Rewards

Reward users who consistently submit valuable bug reports.

| Feature                                             | Status |
| --------------------------------------------------- | ------ |
| Track accepted bug reports                          | ⬜      |
| Track fixed bug reports                             | ⬜      |
| Configurable reward thresholds                      | ⬜      |
| Automatically assign Discord roles                  | ⬜      |
| Example: 5 accepted and fixed reports → reward role | ⬜      |
| Configurable milestones and roles                   | ⬜      |

---

## 🔌 Repository Integrations

Expand beyond GitHub.

| Platform                   | Status |
| -------------------------- | ------ |
| GitHub                     | 🟡 MVP |
| GitLab                     | ⬜      |
| Bitbucket                  | ⬜      |
| Other repository platforms | ⬜      |

Dispatch should support multiple providers through a common integration system, allowing additional platforms to be added without redesigning the core bot.

---

## 🛠️ Discord Commands

Commands should be measured by how much of the core workflow they enable, rather than tracked as an enormous list of individual commands.

### Command Coverage

| Area                  | Progress |
| --------------------- | -------: |
| Configuration         |     `0%` |
| Repository management |     `0%` |
| Bug report submission |     `0%` |
| Report review         |     `0%` |
| Issue management      |     `0%` |
| User rewards          |     `0%` |
| Administration        |     `0%` |

**MVP command coverage: `0%`**

The MVP is complete when users and administrators can complete the entire bug-report workflow without manual intervention.

---

## 🧱 Future Improvements

Ideas that are not required for the initial release but may become valuable later.

* Automatic duplicate detection
* AI-assisted bug report structuring
* AI-assisted duplicate detection
* Automatic categorisation and labelling
* Custom report templates
* Per-server workflows
* Advanced issue synchronisation
* Public contributor leaderboards
* Advanced reward systems
* Organisation-wide configuration
* Self-hosting improvements
* Additional project management integrations

---

## 📊 Overall Progress

| Area                     | Progress |
| ------------------------ | -------: |
| Core MVP                 |     `0%` |
| Bug Report Quality       |     `0%` |
| Community Rewards        |     `0%` |
| Repository Integrations  |     `0%` |
| Discord Command Coverage |     `0%` |

> Progress should reflect completed user-facing capabilities rather than the number of internal tasks or commands implemented.
