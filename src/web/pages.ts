import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { Bindings } from '../types';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** A page the Worker renders per request: a title and the content for the site's shell. */
export type Page = { title: string; body: Html };

/* -------------------------------------------------------------------------- */
/*                                    Shell                                   */
/* -------------------------------------------------------------------------- */

const TITLE_SLOT = '%%DISPATCH_TITLE%%';
const CONTENT_SLOT = '%%DISPATCH_CONTENT%%';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bare-bones page used if the site's shell can't be loaded (e.g. before the first site build). */
function plainPage(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Dispatch</title></head><body style="margin:0;padding:48px 20px;background:#151618;color:#eeeef2;font:16px/1.6 system-ui,sans-serif"><main style="max-width:640px;margin:0 auto">${content}</main></body></html>`;
}

/**
 * Renders a page inside the static site's frame (`site/src/pages/shell.astro`),
 * so it shares the site's navigation, footer and styles. Falls back to a plain
 * page rather than failing the sign-in flow.
 */
export async function renderPage(env: Bindings, requestUrl: string, page: Page): Promise<string> {
  const content = (await page.body).toString();

  try {
    const res = await env.ASSETS.fetch(new URL('/shell/', requestUrl));
    const shell = res.ok ? await res.text() : '';
    if (shell.includes(CONTENT_SLOT)) {
      // Replacer functions, so `$` in user-visible text is never treated as a pattern.
      return shell.replace(TITLE_SLOT, () => escapeHtml(page.title)).replace(CONTENT_SLOT, () => content);
    }
  } catch (error) {
    console.error('shell unavailable', error);
  }
  return plainPage(page.title, content);
}

/* -------------------------------------------------------------------------- */
/*                                    Pages                                   */
/* -------------------------------------------------------------------------- */

type Kind = 'info' | 'error' | 'success';

const LABELS: Record<Kind, string> = {
  info: 'Dispatch',
  error: 'Something went wrong',
  success: 'All set',
};

export function messagePage(title: string, message: string, kind: Kind = 'info'): Page {
  const action =
    kind === 'success'
      ? html`<a class="button large" href="https://discord.com/app">Open Discord <span aria-hidden="true">→</span></a>`
      : html`<a class="button large ghost" href="/">Back to home</a>`;

  return {
    title,
    body: html`<div class="panel">
      <span class="index ${kind}">${LABELS[kind]}</span>
      <h1 class="panel-title">${title}</h1>
      <p class="lede">${message}</p>
      <div class="cta">${action}</div>
    </div>`,
  };
}

export type RepoChoice = {
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  token: string;
};

const searchIcon = raw(
  `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>`
);

function repoCard(repo: RepoChoice): Html {
  // The whole card is the submit button. Search (see site/src/pages/shell.astro)
  // matches against `data-search`.
  const search = `${repo.fullName} ${repo.description ?? ''} ${repo.language ?? ''}`.toLowerCase();
  return html`<form class="repo-form" method="post" action="/github/link" data-repo data-search="${search}">
    <input type="hidden" name="token" value="${repo.token}" />
    <button class="repo-card" type="submit">
      <span class="repo-head">
        <span class="repo-name">${repo.fullName}</span>
        ${repo.private ? html`<span class="chip">Private</span>` : ''}
      </span>
      <span class="repo-desc ${repo.description ? '' : 'none'}">${repo.description ?? 'No description'}</span>
      <span class="repo-foot">
        <span class="repo-lang">${repo.language ?? ''}</span>
        <span class="repo-go">Connect <span aria-hidden="true">→</span></span>
      </span>
    </button>
  </form>`;
}

export function repoPickerPage(opts: { login: string; repos: RepoChoice[]; installUrl: string }): Page {
  const total = opts.repos.length;

  const head = html`<div class="picker-head">
    <span class="index">Connect a repository</span>
    <h1 class="panel-title">Choose a <em>repository.</em></h1>
    <p class="lede">
      Signed in as <strong>@${opts.login}</strong>. Bug reports from your server will be filed as issues in the
      repository you pick.
    </p>
  </div>`;

  const body = total
    ? html`<div class="repo-tools">
          <label class="search">
            ${searchIcon}
            <input type="search" placeholder="Search repositories…" aria-label="Search repositories" autocomplete="off" data-repo-search />
          </label>
          <span class="repo-count" data-repo-count data-total="${total}">${total} ${total === 1 ? 'repository' : 'repositories'}</span>
        </div>
        <div class="repo-grid">${opts.repos.map(repoCard)}</div>
        <p class="repo-empty" data-repo-empty hidden>No repositories match your search.</p>`
    : html`<div class="panel">
        <p class="lede">
          Dispatch isn't installed on any repository you can push to yet. Install it first, then you'll be
          brought straight back here.
        </p>
      </div>`;

  return {
    title: 'Choose a repository',
    body: html`<div class="picker">
      ${head} ${body}
      <div class="picker-foot">
        <a class="button ${total ? 'ghost' : ''}" href="${opts.installUrl}">
          ${total ? 'Install on another repository' : 'Install the GitHub App'}
        </a>
        <p class="command-note">Only repositories where the app is installed and you have write access are shown.</p>
      </div>
    </div>`,
  };
}
