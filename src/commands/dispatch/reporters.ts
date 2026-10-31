import { makeSubCommand, makeSubCommandGroup, makeUserOption } from 'discord-hono';
import { getMutedReporters, muteReporter, unmuteReporter } from '../../db';
import { card, divider, EPHEMERAL_V2, notice, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { guarded, inGuild, messages } from '../shared';

const sub_mute = factory.subCommand(
  makeSubCommand('mute', 'Stop a member from filing reports or voting').options([
    makeUserOption('member', 'Who to mute').required(true),
  ]),
  (c) =>
    c.flags(...EPHEMERAL_V2).resDefer(
      guarded(async (c) => {
        const ctx = inGuild(c.interaction);
        if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

        await muteReporter(c.env.DB, ctx.guildId, c.var.member, ctx.member.user.id);
        await c.followup(view([notice(`<@${c.var.member}> can no longer file reports or vote here. Undo it with \`/dispatch reporters unmute\`.`)]));
      })
    )
);

const sub_unmute = factory.subCommand(
  makeSubCommand('unmute', 'Let a muted member report again').options([
    makeUserOption('member', 'Who to unmute').required(true),
  ]),
  (c) =>
    c.flags(...EPHEMERAL_V2).resDefer(
      guarded(async (c) => {
        const ctx = inGuild(c.interaction);
        if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

        const removed = await unmuteReporter(c.env.DB, ctx.guildId, c.var.member);
        await c.followup(view([notice(removed ? `<@${c.var.member}> can report again.` : `<@${c.var.member}> isn't muted.`)]));
      })
    )
);

const sub_muted = factory.subCommand(makeSubCommand('muted', 'List muted members'), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const muted = await getMutedReporters(c.env.DB, ctx.guildId);
      await c.followup(
        view([card([text('## Muted reporters'), divider(), text(muted.length ? muted.map((id) => `<@${id}>`).join('\n') : 'Nobody is muted.')])])
      );
    })
  )
);

const reporterSubs = [sub_mute, sub_unmute, sub_muted];

export const group_reporters = factory.subCommandGroup(
  makeSubCommandGroup('reporters', 'Manage who can file reports').options(factory.getSubCommands(reporterSubs)),
  factory.subLoader(reporterSubs)
);
