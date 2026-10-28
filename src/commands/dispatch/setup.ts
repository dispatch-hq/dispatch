import { makeLinkButton, makeSubCommand } from 'discord-hono';
import { getGuild, isLinked } from '../../db';
import { signToken } from '../../lib/crypto';
import { card, divider, EPHEMERAL_V2, section, text, view } from '../../lib/ui';
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


    return c.flags(...EPHEMERAL_V2).res(
      view([
        card([
          text('## Connect a repository'),
          isLinked(guild)
            ? section(
                `Linked to **${guild.repo_full_name}**. Connecting another repository replaces it.`,
                makeLinkButton(getProvider(guild.provider).repoUrl(guild.repo_full_name), 'Open')
              )
            : text('Members will be able to file bug reports with `/report`, or by right-clicking a message → **Apps → Report bug**.'),
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
      ])
    );
  }
);
