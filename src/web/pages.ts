import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const styles = raw(`
  :root {
    --bg: #f6f7f9; --card: #ffffff; --text: #1f2328; --muted: #59636e;
    --border: #d1d9e0; --brand: #5865f2; --brand-text: #ffffff; --danger: #d1242f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #9198a1;
      --border: #30363d; --brand: #6d78f7; --danger: #f85149;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  main {
    width: 100%; max-width: 480px; background: var(--card);
    border: 1px solid var(--border); border-radius: 12px; padding: 28px;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--muted); font-size: 13px; margin-bottom: 16px; }
  .brand svg { width: 18px; height: 18px; color: var(--brand); }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: var(--muted); }
  p strong { color: var(--text); }
  .repos { display: grid; gap: 8px; margin: 20px 0; }
  .repos form { margin: 0; }
  .repo {
    width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border);
    background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer;
  }
  .repo:hover, .repo:focus-visible { border-color: var(--brand); outline: none; }
  .repo span { overflow-wrap: anywhere; }
  .tag { font-size: 12px; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; flex-shrink: 0; }
  .button {
    display: inline-block; padding: 10px 16px; border-radius: 8px; text-decoration: none;
    background: var(--brand); color: var(--brand-text); font-weight: 600;
  }
  .secondary { color: var(--brand); text-decoration: none; font-weight: 500; }
  .error h1 { color: var(--danger); }
  footer { margin-top: 20px; font-size: 13px; color: var(--muted); }
`);

const logo = raw(
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`
);

function layout(title: string, body: Html, className = ''): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title} · Dispatch</title>
        <style>
          ${styles}
        </style>
      </head>
      <body>
        <main class="${className}">
          <div class="brand">${logo} Dispatch</div>
          ${body}
        </main>
      </body>
    </html>`;
}

export function messagePage(title: string, message: string, error = false): Html {
  return layout(title, html`<h1>${title}</h1><p>${message}</p>`, error ? 'error' : '');
}

export function landingPage(inviteUrl: string): Html {
  return layout(
    'Bug reports from Discord',
    html`<h1>Bug reports from Discord, straight to GitHub</h1>
      <p>
        Members report bugs with <strong>/report</strong> — Dispatch files a GitHub issue, keeps them posted
        as it's triaged and fixed, and rewards your best reporters with roles.
      </p>
      <a class="button" href="${inviteUrl}">Add to Discord</a>`
  );
}

export type RepoChoice = { fullName: string; private: boolean; token: string };

export function repoPickerPage(opts: { login: string; repos: RepoChoice[]; installUrl: string }): Html {
  const list = opts.repos.length
    ? html`<div class="repos">
        ${opts.repos.map(
          (r) => html`<form method="post" action="/github/link">
            <input type="hidden" name="token" value="${r.token}" />
            <button class="repo" type="submit">
              <span>${r.fullName}</span>${r.private ? html`<span class="tag">private</span>` : ''}
            </button>
          </form>`
        )}
      </div>`
    : html`<p>
        Dispatch isn't installed on any repository you can push to yet. Install it first, then you'll be
        brought straight back here.
      </p>`;

  return layout(
    'Choose a repository',
    html`<h1>Choose a repository</h1>
      <p>Signed in as <strong>@${opts.login}</strong>. Bug reports from your server will be filed as issues here.</p>
      ${list}
      <a class="${opts.repos.length ? 'secondary' : 'button'}" href="${opts.installUrl}">
        ${opts.repos.length ? 'Install on another repository →' : 'Install the GitHub App'}
      </a>
      <footer>Only repositories where the app is installed and you have write access are shown.</footer>`
  );
}
