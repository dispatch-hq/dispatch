import type { APIAttachment } from 'discord-api-types/v10';
import {
  makeFileUpload,
  makeLabel,
  makeMessageCommand,
  makeModal,
  makeSlashCommand,
  makeStringSelect,
  makeTextInput,
  textInputStyle,
} from 'discord-hono';
import { createDraft, getDraft, getLinkedGuild, secondsSinceLastReport } from '../db';
import { clean, messageUrl, parseReportTypes, truncate } from '../lib/format';
import { card, EPHEMERAL_V2, notice, row, text, view } from '../lib/ui';
import { factory } from '../init';
import { rehostAttachments } from '../services/attachments';
import { receiptCard, submitReport } from '../services/reports';
import type { Bindings, LinkedGuild } from '../types';
import { deny, guarded, inGuild, messages } from './shared';

/* -------------------------------------------------------------------------- */
/*                                    Modal                                   */
/* -------------------------------------------------------------------------- */

const DESCRIPTION_MIN = 10;

/**
 * What the form needs to remember between opening and submitting, carried in
 * the modal's custom_id as `<type index>|<channelId>:<messageId>`. Either half
 * may be empty. A bare `channelId:messageId` is the format from before report
 * types existed, so forms already open during a deploy still submit.
 */
function encodeContext(context: { type?: number; source?: string }): string | undefined {
  // Without a type, keep the original format so servers not using types are unchanged.
  if (context.type === undefined) return context.source || undefined;
  return `${context.type}|${context.source ?? ''}`;
}

function decodeContext(value: string | undefined): { type: number | null; source: string } {
  const raw = value ?? '';
  if (!raw.includes('|')) return { type: null, source: raw };
  const [type = '', source = ''] = raw.split('|');
  return { type: type === '' ? null : Number(type), source };
}

type Prefill = { description?: string; source?: string; type?: { index: number; name: string } };

function reportModal(prefill: Prefill = {}) {
  const description = makeTextInput('description', undefined, textInputStyle.Paragraph)
    .placeholder('What went wrong? What did you expect to happen instead?')
    .min_length(DESCRIPTION_MIN)
    .max_length(4000)
    .required(true);

  // Discord rejects a modal whose prefilled value is shorter than min_length
  // ("application didn't respond"), so short messages are left for the reporter to expand on.
  const prefilled = prefill.description && prefill.description.length >= DESCRIPTION_MIN;

  const title = prefill.type ? truncate(`Report a bug · ${prefill.type.name}`, 45) : 'Report a bug';
  const modal = makeModal('report', title, [
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
      prefilled ? description.value(truncate(prefill.description!, 4000)) : description
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

  const context = encodeContext({ type: prefill.type?.index, source: prefill.source });
  return context ? modal.custom_value(context) : modal;
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
/*                                Type picker                                 */
/* -------------------------------------------------------------------------- */

/**
 * Servers that define report types ask for one first, because the form itself
 * is full (Discord allows five inputs). `draft` is the id of a parked message
 * when the report started from "Apps → Report bug", so the form can still be
 * pre-filled once a type is chosen.
 */
function typePicker(types: string[], draft?: number) {
  const select = makeStringSelect(
    'report-type',
    types.map((type, index) => [String(index), type] as const)
  ).placeholder('Choose a type');

  return view([
    card([
      text('### What kind of problem is it?\nPick the closest match. The form opens next.'),
      row(draft === undefined ? select : select.custom_value(String(draft))),
    ]),
  ]);
}

export const select_report_type = factory.component(makeStringSelect('report-type', [['0', 'type']]), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const check = await canReport(c.env, ctx.guildId, ctx.member.user.id);
  if ('error' in check) return deny(c, check.error);

  const index = Number(c.ref.values?.[0]);
  const name = parseReportTypes(check.guild.report_types)[index];
  if (!name) return deny(c, 'That option is no longer available. Run the command again.');

  const draftId = Number(c.ref.custom_value);
  const draft = draftId ? await getDraft(c.env.DB, draftId, ctx.guildId, ctx.member.user.id) : null;

  return c.resModal(
    reportModal({
      description: draft?.description ?? undefined,
      source: draft?.source ?? undefined,
      type: { index, name },
    })
  );
});

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

    const types = parseReportTypes(check.guild.report_types);
    if (types.length) return c.flags(...EPHEMERAL_V2).res(typePicker(types));
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
    const source = target ? `${target.channel_id}:${target.id}` : undefined;

    const types = parseReportTypes(check.guild.report_types);
    if (types.length) {
      const draft = await createDraft(c.env.DB, {
        guildId: ctx.guildId,
        userId: ctx.member.user.id,
        source: source ?? null,
        description: target?.content || null,
      });
      return c.flags(...EPHEMERAL_V2).res(typePicker(types, draft));
    }

    return c.resModal(reportModal({ description: target?.content || undefined, source }));
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

      const context = decodeContext(c.ref.custom_value);
      const [channelId, messageId] = context.source.split(':');
      // Only accept a type the server still offers, so a stale form can't invent labels.
      const reportType = context.type === null ? null : (parseReportTypes(check.guild.report_types)[context.type] ?? null);
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
        reportType,
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
