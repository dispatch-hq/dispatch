import { makeStringOption, makeSubCommand, makeSubCommandGroup } from 'discord-hono';
import { deleteCannedReply, getCannedReplies, MAX_CANNED_REPLIES, upsertCannedReply } from '../../db';
import { clean, escapeMarkdown, truncate } from '../../lib/format';
import { card, divider, EPHEMERAL_V2, notice, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { guarded, inGuild, messages } from '../shared';

const sub_add = factory.subCommand(
  makeSubCommand('add', 'Save a reply staff can send when rejecting or asking about a report').options([
    makeStringOption('name', 'Short name shown in the picker, e.g. Needs repro steps').required(true).max_length(80),
    makeStringOption('text', 'What the reporter is sent').required(true).max_length(500),
  ]),
  (c) =>
    c.flags(...EPHEMERAL_V2).resDefer(
      guarded(async (c) => {
        const ctx = inGuild(c.interaction);
        if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

        const name = clean(c.var.name);
        const body = clean(c.var.text);
        if (!name || !body) return c.followup(view([notice('Give the reply both a name and some text.')]));

        const saved = await upsertCannedReply(c.env.DB, ctx.guildId, name, body);
        await c.followup(
          view([
            notice(
              saved
                ? `Saved **${escapeMarkdown(name)}**. It's now offered when staff press **Reject** or **Request info**.`
                : `This server already has ${MAX_CANNED_REPLIES} saved replies. Remove one first.`
            ),
          ])
        );
      })
    )
);

const sub_remove = factory.subCommand(
  makeSubCommand('remove', 'Delete a saved reply').options([makeStringOption('name', 'Name of the reply').required(true).max_length(80)]),
  (c) =>
    c.flags(...EPHEMERAL_V2).resDefer(
      guarded(async (c) => {
        const ctx = inGuild(c.interaction);
        if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

        const name = c.var.name;
        const removed = await deleteCannedReply(c.env.DB, ctx.guildId, name);
        await c.followup(view([notice(removed ? `Removed **${escapeMarkdown(name)}**.` : `There's no saved reply called **${escapeMarkdown(name)}**.`)]));
      })
    )
);

const sub_list = factory.subCommand(makeSubCommand('list', 'Show saved replies'), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const replies = await getCannedReplies(c.env.DB, ctx.guildId);
      const body = replies.length
        ? replies.map((r) => `**${escapeMarkdown(r.label)}**\n-# ${truncate(r.body, 120)}`).join('\n')
        : 'No saved replies yet. Add one with `/dispatch replies add`.';
      await c.followup(view([card([text('## Saved replies'), divider(), text(body)])]));
    })
  )
);

const replySubs = [sub_add, sub_remove, sub_list];

export const group_replies = factory.subCommandGroup(
  makeSubCommandGroup('replies', 'Saved replies for rejecting or asking about reports').options(factory.getSubCommands(replySubs)),
  factory.subLoader(replySubs)
);
