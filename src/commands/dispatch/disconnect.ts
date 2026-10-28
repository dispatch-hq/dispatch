import { buttonStyle, makeButton, makeSubCommand } from 'discord-hono';
import { getLinkedGuild, unlinkRepository } from '../../db';
import { canManageGuild } from '../../lib/permissions';
import { card, divider, EPHEMERAL_V2, notice, row, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { deny, inGuild, messages, reply } from '../shared';

export const sub_disconnect = factory.subCommand(
  makeSubCommand('disconnect', 'Unlink the connected repository'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const guild = await getLinkedGuild(c.env.DB, ctx.guildId);
    if (!guild) return reply(c, 'No repository is connected.');

    return c.flags(...EPHEMERAL_V2).res(
      view([
        card([
          text(`## Disconnect ${guild.repo_full_name}?`),
          text("Members won't be able to file new reports until a repository is connected again. Existing issues, settings and reward roles are kept."),
          divider(),
          row(
            makeButton('disconnect-confirm', 'Disconnect', buttonStyle.Danger),
            makeButton('disconnect-cancel', 'Cancel', buttonStyle.Secondary)
          ),
        ]),
      ])
    );
  }
);

export const button_disconnect_confirm = factory.component(
  makeButton('disconnect-confirm', 'Disconnect', buttonStyle.Danger),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);
    if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

    await unlinkRepository(c.env.DB, ctx.guildId);
    return c
      .flags(...EPHEMERAL_V2)
      .update()
      .res(view([notice('Repository disconnected. Run `/dispatch setup` to connect another one.')]));
  }
);

export const button_disconnect_cancel = factory.component(
  makeButton('disconnect-cancel', 'Cancel', buttonStyle.Secondary),
  (c) => c.flags(...EPHEMERAL_V2).update().res(view([notice('Nothing changed.')]))
);
