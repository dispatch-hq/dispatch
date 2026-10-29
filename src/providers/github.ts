import { createAppJwt, importRsaPrivateKey } from '../lib/crypto';
import type { Bindings, LinkedGuild } from '../types';
import { ProviderError, type IssueProvider } from './types';

const API = 'https://api.github.com';
const USER_AGENT = 'dispatch-discord-bot';

/* -------------------------------------------------------------------------- */
/*                                 Low level                                  */
/* -------------------------------------------------------------------------- */

async function request<T>(
  path: string,
  auth: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: auth,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new ProviderError(`GitHub ${init.method ?? 'GET'} ${path} failed`, res.status, message);
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/* -------------------------------------------------------------------------- */
/*                          App installation tokens                           */
/* -------------------------------------------------------------------------- */

let cachedKey: { pem: string; key: CryptoKey } | undefined;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function appJwt(env: Bindings): Promise<string> {
  if (cachedKey?.pem !== env.GITHUB_PRIVATE_KEY) {
    cachedKey = { pem: env.GITHUB_PRIVATE_KEY, key: await importRsaPrivateKey(env.GITHUB_PRIVATE_KEY) };
  }
  return createAppJwt(env.GITHUB_APP_ID, cachedKey.key);
}

/**
 * Installation access token scoped to a single repository. Tokens live for an
 * hour; they're cached per isolate and refreshed five minutes before expiry.
 */
async function installationToken(env: Bindings, installationId: number, repoId: number) {
  const cacheKey = `${installationId}:${repoId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;

  const data = await request<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    `Bearer ${await appJwt(env)}`,
    { method: 'POST', body: { repository_ids: [repoId] } }
  );

  tokenCache.set(cacheKey, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/* -------------------------------------------------------------------------- */
/*                                   Issues                                   */
/* -------------------------------------------------------------------------- */

export const github: IssueProvider = {
  id: 'github',
  name: 'GitHub',

  repoUrl(fullName) {
    return `https://github.com/${fullName}`;
  },

  async createIssue(env, guild: LinkedGuild, input) {
    const token = await installationToken(env, guild.installation_id, guild.repo_id);
    const issue = await request<{ number: number; html_url: string }>(
      `/repos/${guild.repo_full_name}/issues`,
      `Bearer ${token}`,
      { method: 'POST', body: input }
    );
    return { number: issue.number, url: issue.html_url };
  },
};

/* -------------------------------------------------------------------------- */
/*                        Linking (OAuth user identity)                       */
/* -------------------------------------------------------------------------- */

export function githubAuthorizeUrl(env: Bindings, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${env.PUBLIC_URL}/github/callback`);
  url.searchParams.set('state', state);
  return url.toString();
}

export function githubInstallUrl(env: Bindings, state: string): string {
  const url = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeOAuthCode(env: Bindings, code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.PUBLIC_URL}/github/callback`,
    }),
  });

  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    throw new ProviderError('GitHub OAuth exchange failed', res.status, data.error_description);
  }
  return data.access_token;
}

export type WritableRepo = {
  installationId: number;
  repoId: number;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
};

export type GitHubUser = { login: string; avatar_url: string };

/**
 * Repositories where (a) the Dispatch app is installed and (b) the signed-in
 * user can push. This is what proves an admin is allowed to link a repo.
 */
export async function listWritableRepos(
  userToken: string
): Promise<{ user: GitHubUser; repos: WritableRepo[] }> {
  const auth = `Bearer ${userToken}`;
  const [user, installs] = await Promise.all([
    request<GitHubUser>('/user', auth),
    request<{ installations: { id: number }[] }>('/user/installations?per_page=100', auth),
  ]);

  type RepoPage = {
    repositories: {
      id: number;
      full_name: string;
      private: boolean;
      description?: string | null;
      language?: string | null;
      permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
    }[];
  };

  // Bounded to stay well inside the Workers subrequest limit.
  const pages = await Promise.all(
    installs.installations.slice(0, 10).map(async (install) => {
      const page = await request<RepoPage>(
        `/user/installations/${install.id}/repositories?per_page=100`,
        auth
      );
      return page.repositories
        .filter((r) => r.permissions?.admin || r.permissions?.maintain || r.permissions?.push)
        .map<WritableRepo>((r) => ({
          installationId: install.id,
          repoId: r.id,
          fullName: r.full_name,
          private: r.private,
          description: r.description ?? null,
          language: r.language ?? null,
        }));
    })
  );

  const repos = pages.flat().sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { user, repos };
}
