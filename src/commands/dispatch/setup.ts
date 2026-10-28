import { makeLinkButton, makeSubCommand } from 'discord-hono';
import { getGuild, isLinked } from '../../db';
import { signToken } from '../../lib/crypto';
import { card, colors, divider, EPHEMERAL_V2, row, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { getProvider } from '../../providers';
import { githubAuthorizeUrl, githubInstallUrl } from '../../providers/github';
import { deny, inGuild, messages } from '../shared';

export type LinkState = {
  /** Discord guild id */
  g: string;
  /** Discord user id of the admin who started the flow */
  u: string;
};

export const LINK_TTL_SECONDS = 15 * 60;

export const sub_setup = factory.subCommand(
  makeSubCommand('setup', 'Connect a GitHub repository to this server'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const [guild, state] = await Promise.all([
      getGuild(c.env.DB, ctx.guildId),
      signToken<LinkState>(c.env.STATE_SECRET, { g: ctx.guildId, u: ctx.member.user.id }, LINK_TTL_SECONDS),
    ]);

    const current = isLinked(guild)
      ? `Currently linked to **[${guild.repo_full_name}](${getProvider(guild.provider).repoUrl(guild.repo_full_name)})**. Connecting another repository replaces it.`
      : 'Members will be able to file bug reports with `/report`, or by right-clicking a message → **Apps → Report bug**.';

    return c.flags(...EPHEMERAL_V2).res(
      view([
        card([
          text(`## 🔗 Connect a repository\n${current}`),
          divider(),
          text(
            [
              '**1. Install the Dispatch GitHub App** on the repository you want issues filed in. Skip this if it is already installed.',
              '**2. Sign in with GitHub** so Dispatch can confirm you have write access, then pick the repository.',
            ].join('\n')
          ),
          row(
            makeLinkButton(githubInstallUrl(c.env, state), ['📦', 'Install GitHub App']),
            makeLinkButton(githubAuthorizeUrl(c.env, state), ['🔑', 'Sign in with GitHub'])
          ),
          text('-# These links are tied to you and this server, and expire in 15 minutes.'),
        ]),
      ])
    );
  }
);
