import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { LinkState } from '../commands/dispatch/setup';
import { LINK_TTL_SECONDS } from '../commands/dispatch/setup';
import { linkRepository } from '../db';
import { signToken, verifyGitHubSignature, verifyToken } from '../lib/crypto';
import { notice } from '../lib/ui';
import { ProviderError } from '../providers';
import { exchangeOAuthCode, githubAuthorizeUrl, githubInstallUrl, listWritableRepos } from '../providers/github';
import { sendDirectMessage } from '../services/discord';
import { handleGitHubEvent } from '../services/github-events';
import type { AppEnv } from '../types';
import { messagePage, renderPage, repoPickerPage, type Page } from './pages';

/** A single repository the admin proved they can push to. */
type RepoGrant = LinkState & {
  /** installation id */
  i: number;
  /** repository id */
  r: number;
  /** repository full name */
  n: string;
};

const MAX_REPOS = 200;

export const githubRoutes = new Hono<AppEnv>();

const expired = () =>
  messagePage('Link expired', 'This link has expired or was already used. Run /dispatch setup in Discord to get a new one.', 'error');

/** These pages carry single-use tokens, so they must never be cached. */
async function respond(c: Context<AppEnv>, page: Page, status: ContentfulStatusCode = 200) {
  c.header('cache-control', 'no-store');
  return c.html(await renderPage(c.env, c.req.url, page), status);
}

/**
 * OAuth + install redirect target. GitHub sends `code` after sign-in, and
 * after installation when "Request user authorization during installation"
 * is enabled on the app.
 */
githubRoutes.get('/callback', async (c) => {
  const { code, state, setup_action } = c.req.query();
  const claims = await verifyToken<LinkState>(c.env.STATE_SECRET, state);
  if (!claims || !state) return respond(c, expired(), 400);

  if (setup_action === 'request') {
    return respond(
      c,
      messagePage(
        'Waiting for approval',
        'An organization owner needs to approve the Dispatch installation. Once they do, run /dispatch setup again.'
      )
    );
  }

  // Installed without user authorization — sign in to prove repo access.
  if (!code) return c.redirect(githubAuthorizeUrl(c.env, state));

  try {
    const userToken = await exchangeOAuthCode(c.env, code);
    const { user, repos } = await listWritableRepos(userToken);

    const choices = await Promise.all(
      repos.slice(0, MAX_REPOS).map(async (repo) => ({
        fullName: repo.fullName,
        private: repo.private,
        token: await signToken<RepoGrant>(
          c.env.STATE_SECRET,
          { g: claims.g, u: claims.u, i: repo.installationId, r: repo.repoId, n: repo.fullName },
          LINK_TTL_SECONDS
        ),
      }))
    );

    return respond(c, repoPickerPage({ login: user.login, repos: choices, installUrl: githubInstallUrl(c.env, state) }));
  } catch (error) {
    console.error('github callback failed', error);
    const detail =
      error instanceof ProviderError && error.status === 401
        ? 'GitHub rejected the sign-in. Please try again from Discord.'
        : 'Something went wrong talking to GitHub. Please try again from Discord.';
    return respond(c, messagePage('Sign-in failed', detail, 'error'), 502);
  }
});

githubRoutes.post('/link', async (c) => {
  const form = await c.req.parseBody();
  const grant = await verifyToken<RepoGrant>(c.env.STATE_SECRET, String(form.token ?? ''));
  if (!grant) return respond(c, expired(), 400);

  await linkRepository(c.env.DB, {
    guildId: grant.g,
    provider: 'github',
    installationId: grant.i,
    repoId: grant.r,
    fullName: grant.n,
    linkedBy: grant.u,
  });

  c.executionCtx.waitUntil(
    sendDirectMessage(c.env, grant.u, [
      notice(
        `### Repository connected\nBug reports from your server will now be filed in **[${grant.n}](https://github.com/${grant.n})**.\nNext: \`/dispatch settings\` to add a triage queue or updates channel, and \`/dispatch rewards add\` to reward great reporters.`
      ),
    ])
  );

  return respond(
    c,
    messagePage('Repository connected', `Bug reports will be filed in ${grant.n}. You can close this tab and head back to Discord.`, 'success')
  );
});

githubRoutes.post('/webhook', async (c) => {
  const body = await c.req.text();
  const valid = await verifyGitHubSignature(c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header('x-hub-signature-256') ?? null);
  if (!valid) return c.text('Invalid signature', 401);

  const event = c.req.header('x-github-event') ?? '';
  if (event === 'ping') return c.text('pong');

  c.executionCtx.waitUntil(
    handleGitHubEvent(c.env, event, JSON.parse(body)).catch((error) => console.error(`webhook ${event} failed`, error))
  );
  return c.body(null, 202);
});
