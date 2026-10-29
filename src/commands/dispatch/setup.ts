import { makeLinkButton, makeSubCommand } from 'discord-hono';
import { getGuildRepos, MAX_REPOS_PER_GUILD } from '../../db';
import { signToken } from '../../lib/crypto';
import { escapeMarkdown } from '../../lib/format';
import { card, divider, EPHEMERAL_V2, row, section, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { getProvider } from '../../providers';
import { githubAuthorizeUrl, githubInstallUrl } from '../../providers/github';
import { hasPremium, PREMIUM_NAME, premiumButton } from '../../services/premium';
import type { Bindings, GuildRepo } from '../../types';
import { deny, inGuild, messages } from '../shared';

export type LinkState = {
  /** Discord guild id */
  g: string;
  /** Discord user id of the admin who started the flow */
  u: string;
  /** The server had Premium when the flow started, so a new repository is added rather than replacing the old one */
  p?: boolean;
};

export const LINK_TTL_SECONDS = 15 * 60;

/**
 * Linked repositories as one text block, one line each, linking to the repository. A single text
 * display keeps the message well inside Discord's 40-component limit however many are connected.
 * Past the first, only Dispatch Pro servers can use them.
 */
export function repoLines(repos: GuildRepo[], premium: boolean) {
  const lines = repos.map((repo, index) => {
    const link = `[${escapeMarkdown(repo.repo_full_name)}](${getProvider(repo.provider).repoUrl(repo.repo_full_name)})`;
    return !premium && index > 0 ? `${link} · *paused, needs ${PREMIUM_NAME}*` : link;
  });
  return [text(lines.join('\n'))];
}

/** What a free server is missing, with the button to get it. */
export function upsell(env: Bindings, copy: string) {
  const button = premiumButton(env);
  return button ? [text(copy), row(button)] : [text(`${copy}\n-# Subscribe to ${PREMIUM_NAME} from the app's profile.`)];
}

function summary(env: Bindings, repos: GuildRepo[], premium: boolean) {
  if (!repos.length) {
    return [text('Members will be able to file bug reports with `/report`, or by right-clicking a message → **Apps → Report bug**.')];
  }

  const list = repoLines(repos, premium);
  if (premium) {
    const full = repos.length >= MAX_REPOS_PER_GUILD;
    return [
      text(
        `**${PREMIUM_NAME}** · ${repos.length} of ${MAX_REPOS_PER_GUILD} repositories connected. ` +
          (full ? 'Disconnect one to make room for another.' : 'Connecting a repository adds it; members pick which one to report to.')
      ),
      ...list,
    ];
  }

  return [
    text(
      repos.length === 1
        ? 'Connecting another repository replaces this one.'
        : `Connecting a repository replaces all ${repos.length} of these.`
    ),
    ...list,
    ...upsell(env, `${PREMIUM_NAME} connects up to ${MAX_REPOS_PER_GUILD} repositories to one server, and lets members choose which one a bug is for.`),
  ];
}

export const sub_setup = factory.subCommand(
  makeSubCommand('setup', 'Connect GitHub repositories to this server'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const premium = hasPremium(c.env, c.interaction, ctx.guildId);
    const [repos, state] = await Promise.all([
      getGuildRepos(c.env.DB, ctx.guildId),
      signToken<LinkState>(c.env.STATE_SECRET, { g: ctx.guildId, u: ctx.member.user.id, p: premium }, LINK_TTL_SECONDS),
    ]);
    const full = premium && repos.length >= MAX_REPOS_PER_GUILD;

    return c.flags(...EPHEMERAL_V2).res(
      view([
        card([
          text(premium ? '## Connect repositories' : '## Connect a repository'),
          ...summary(c.env, repos, premium),
          ...(full
            ? []
            : [
                divider(),
                section(
                  '**1. Install** the Dispatch GitHub App on the repository. Skip this if it is already installed.',
                  makeLinkButton(githubInstallUrl(c.env, state), 'Install')
                ),
                section(
                  '**2. Sign in** so Dispatch can confirm you have write access, then pick the repository.',
                  makeLinkButton(githubAuthorizeUrl(c.env, state), 'Sign in')
                ),
                divider(),
                text('-# These links are tied to you and this server, and expire in 15 minutes.'),
              ]),
        ]),
      ])
    );
  }
);
