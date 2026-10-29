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
    body: html`<span class="index ${kind}">${LABELS[kind]}</span>
      <h1 class="panel-title">${title}</h1>
      <p class="lede">${message}</p>
      <div class="cta">${action}</div>`,
  };
}

export type RepoChoice = { fullName: string; private: boolean; token: string };

export function repoPickerPage(opts: { login: string; repos: RepoChoice[]; installUrl: string }): Page {
  const list = opts.repos.length
    ? html`<div class="repos">
        ${opts.repos.map(
          (r) => html`<form method="post" action="/github/link">
            <input type="hidden" name="token" value="${r.token}" />
            <button class="repo" type="submit">
              <span class="repo-name">${r.fullName}</span>
              <span class="repo-meta">${r.private ? html`<span class="chip">Private</span>` : ''}<span aria-hidden="true">→</span></span>
            </button>
          </form>`
        )}
      </div>`
    : html`<p class="lede">
        Dispatch isn't installed on any repository you can push to yet. Install it first, then you'll be
        brought straight back here.
      </p>`;

  return {
    title: 'Choose a repository',
    body: html`<span class="index">Connect a repository</span>
      <h1 class="panel-title">Choose a <em>repository.</em></h1>
      <p class="lede">
        Signed in as <strong>@${opts.login}</strong>. Bug reports from your server will be filed as issues there.
      </p>
      ${list}
      <div class="cta">
        <a class="button ${opts.repos.length ? 'ghost' : ''}" href="${opts.installUrl}">
          ${opts.repos.length ? 'Install on another repository' : 'Install the GitHub App'}
        </a>
      </div>
      <p class="command-note">Only repositories where the app is installed and you have write access are shown.</p>`,
  };
}
