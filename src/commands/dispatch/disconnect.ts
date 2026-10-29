import { buttonStyle, makeButton, makeStringSelect, makeSubCommand } from 'discord-hono';
import { getGuildRepo, getGuildRepos, unlinkRepository } from '../../db';
import { truncate } from '../../lib/format';
import { canManageGuild } from '../../lib/permissions';
import { card, divider, EPHEMERAL_V2, notice, row, text, view } from '../../lib/ui';
import { factory } from '../../init';
import type { GuildRepo } from '../../types';
import { deny, inGuild, messages, reply } from '../shared';

function confirmation(repo: GuildRepo, others: number) {
  return view([
    card([
      text(`## Disconnect ${repo.repo_full_name}?`),
      text(
        (others
          ? `Members won't be able to report to this repository any more; the other ${others === 1 ? 'one stays' : `${others} stay`} connected. `
          : "Members won't be able to file new reports until a repository is connected again. ") +
          'Existing issues, settings and reward roles are kept.'
      ),
      divider(),
      row(
        makeButton('disconnect-confirm', 'Disconnect', buttonStyle.Danger).custom_value(String(repo.id)),
        makeButton('disconnect-cancel', 'Cancel', buttonStyle.Secondary)
      ),
    ]),
  ]);
}

function picker(repos: GuildRepo[]) {
  return view([
    card([
      text('## Disconnect a repository\nWhich one should Dispatch stop filing reports in?'),
      row(
        makeStringSelect(
          'disconnect-pick',
          repos.map((repo) => [String(repo.id), truncate(repo.repo_full_name, 100)] as const)
        ).placeholder('Choose a repository')
      ),
    ]),
  ]);
}

export const sub_disconnect = factory.subCommand(
  makeSubCommand('disconnect', 'Unlink a connected repository'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const repos = await getGuildRepos(c.env.DB, ctx.guildId);
    if (!repos.length) return reply(c, 'No repository is connected.');

    return c.flags(...EPHEMERAL_V2).res(repos.length === 1 ? confirmation(repos[0]!, 0) : picker(repos));
  }
);

export const select_disconnect_pick = factory.component(makeStringSelect('disconnect-pick', [['0', 'repo']]), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);
  if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

  const repo = await getGuildRepo(c.env.DB, ctx.guildId, Number(c.ref.values?.[0]));
  if (!repo) return c.flags(...EPHEMERAL_V2).update().res(view([notice('That repository is already disconnected.')]));

  const count = (await getGuildRepos(c.env.DB, ctx.guildId)).length;
  return c.flags(...EPHEMERAL_V2).update().res(confirmation(repo, count - 1));
});

export const button_disconnect_confirm = factory.component(
  makeButton('disconnect-confirm', 'Disconnect', buttonStyle.Danger),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);
    if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

    // Buttons sent before servers could have several repositories carry no id.
    const id = Number(c.ref.custom_value);
    const repo = id ? await getGuildRepo(c.env.DB, ctx.guildId, id) : (await getGuildRepos(c.env.DB, ctx.guildId))[0];
    if (!repo || !(await unlinkRepository(c.env.DB, ctx.guildId, repo.id))) {
      return c.flags(...EPHEMERAL_V2).update().res(view([notice('That repository is already disconnected.')]));
    }

    const remaining = (await getGuildRepos(c.env.DB, ctx.guildId)).length;
    return c
      .flags(...EPHEMERAL_V2)
      .update()
      .res(
        view([
          notice(
            remaining
              ? `**${repo.repo_full_name}** disconnected. ${remaining} ${remaining === 1 ? 'repository is' : 'repositories are'} still connected.`
              : `**${repo.repo_full_name}** disconnected. Run \`/dispatch setup\` to connect another one.`
          ),
        ])
      );
  }
);

export const button_disconnect_cancel = factory.component(
  makeButton('disconnect-cancel', 'Cancel', buttonStyle.Secondary),
  (c) => c.flags(...EPHEMERAL_V2).update().res(view([notice('Nothing changed.')]))
);
