import type { APIAttachment } from 'discord-api-types/v10';
import {
  makeFileUpload,
  makeLabel,
  makeMessageCommand,
  makeModal,
  makeSlashCommand,
  makeTextInput,
  textInputStyle,
} from 'discord-hono';
import { getLinkedGuild, secondsSinceLastReport } from '../db';
import { clean, messageUrl, truncate } from '../lib/format';
import { EPHEMERAL_V2, notice, view } from '../lib/ui';
import { factory } from '../init';
import { rehostAttachments } from '../services/attachments';
import { receiptCard, submitReport } from '../services/reports';
import type { Bindings, LinkedGuild } from '../types';
import { deny, guarded, inGuild, messages } from './shared';

/* -------------------------------------------------------------------------- */
/*                                    Modal                                   */
/* -------------------------------------------------------------------------- */

function reportModal(prefill: { description?: string; source?: string } = {}) {
  const description = makeTextInput('description', undefined, textInputStyle.Paragraph)
    .placeholder('What went wrong? What did you expect to happen instead?')
    .min_length(10)
    .max_length(4000)
    .required(true);

  const modal = makeModal('report', 'Report a bug', [
    makeLabel(
      'Title',
      makeTextInput('title')
        .placeholder('Short summary, e.g. "Crash when opening settings"')
        .min_length(5)
        .max_length(120)
        .required(true)
    ),
    makeLabel(
      'What happened?',
      prefill.description ? description.value(truncate(prefill.description, 4000)) : description
    ),
    makeLabel(
      'Steps to reproduce',
      makeTextInput('steps', undefined, textInputStyle.Paragraph)
        .placeholder('1. Go to …\n2. Click …\n3. See the error')
        .max_length(2000)
        .required(false)
    ),
    makeLabel(
      'Version / environment',
      makeTextInput('environment')
        .placeholder('e.g. v2.3.1 · Windows 11 · Chrome 141')
        .max_length(200)
        .required(false)
    ),
    makeLabel('Screenshots or logs', makeFileUpload('files').min_values(0).max_values(3).required(false)).description(
      'Images, short videos, .txt or .log files — up to 3, 10 MB each'
    ),
  ]);

  return prefill.source ? modal.custom_value(prefill.source) : modal;
}

/* -------------------------------------------------------------------------- */
/*                                  Pre-check                                 */
/* -------------------------------------------------------------------------- */

type Check = { guild: LinkedGuild } | { error: string };

async function canReport(env: Bindings, guildId: string, userId: string): Promise<Check> {
  const guild = await getLinkedGuild(env.DB, guildId);
  if (!guild) return { error: messages.notLinked };

  const age = await secondsSinceLastReport(env.DB, guildId, userId);
  if (age !== null && age < guild.cooldown_seconds) {
    return { error: `You're reporting a little fast — try again in **${guild.cooldown_seconds - age}s**.` };
  }
  return { guild };
}

/* -------------------------------------------------------------------------- */
/*                                  Handlers                                  */
/* -------------------------------------------------------------------------- */

export const command_report = factory.command(
  makeSlashCommand('report', 'Report a bug to the developers').contexts([0]).integration_types([0]),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const check = await canReport(c.env, ctx.guildId, ctx.member.user.id);
    if ('error' in check) return deny(c, check.error);

    return c.resModal(reportModal());
  }
);

export const command_report_message = factory.command(
  makeMessageCommand('Report bug').contexts([0]).integration_types([0]),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const check = await canReport(c.env, ctx.guildId, ctx.member.user.id);
    if ('error' in check) return deny(c, check.error);

    const target = c.interaction.data.resolved.messages[c.interaction.data.target_id];
    return c.resModal(
      reportModal({
        description: target?.content || undefined,
        source: target ? `${target.channel_id}:${target.id}` : undefined,
      })
    );
  }
);

export const modal_report = factory.modal(reportModal(), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const check = await canReport(c.env, ctx.guildId, ctx.member.user.id);
      if ('error' in check) return c.followup(view([notice(check.error)]));

      const uploads = (c.var.files ?? [])
        .map((id) => c.ref.attachments?.[id])
        .filter((a): a is APIAttachment => !!a);
      const { attachments, skipped } = await rehostAttachments(c.env, ctx.guildId, uploads);

      const [channelId, messageId] = (c.ref.custom_value ?? '').split(':');
      const sourceUrl = channelId && messageId ? messageUrl(ctx.guildId, channelId, messageId) : null;

      const outcome = await submitReport(c.env, c.executionCtx, check.guild, {
        guildId: ctx.guildId,
        reporterId: ctx.member.user.id,
        reporterName: ctx.member.user.username,
        title: clean(c.var.title) ?? 'Untitled report',
        description: clean(c.var.description) ?? '',
        steps: clean(c.var.steps),
        environment: clean(c.var.environment),
        sourceUrl,
        attachments,
      });

      if (outcome.kind === 'failed') {
        return c.followup(view([notice(`### Couldn't file your report\n${outcome.error}`)]));
      }
      return c.followup(
        view([receiptCard(outcome.report, outcome.kind, outcome.kind === 'published' ? outcome.issue : null, skipped)])
      );
    })
  )
);
