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
import { createDraft, getDraft, getGuild, getGuildRepos, secondsSinceLastReport } from '../db';
import { clean, messageUrl, parseReportTypes, truncate } from '../lib/format';
import { card, EPHEMERAL_V2, notice, row, text, view } from '../lib/ui';
import { factory } from '../init';
import { rehostAttachments } from '../services/attachments';
import { activeRepos, hasPremium } from '../services/premium';
import { receiptCard, submitReport } from '../services/reports';
import type { Bindings, GuildRepo, GuildRow } from '../types';
import { deny, guarded, inGuild, messages } from './shared';

/* -------------------------------------------------------------------------- */
/*                                    Modal                                   */
/* -------------------------------------------------------------------------- */

const DESCRIPTION_MIN = 10;

/**
 * What the form needs to remember between opening and submitting, carried in
 * the modal's custom_id as `<type index>|<channelId>:<messageId>|<repo id>`.
 * Every part may be empty, and the repo is left off for servers with a single
 * repository. A bare `channelId:messageId` is the format from before report
 * types existed, so forms already open during a deploy still submit.
 */
function encodeContext(context: { type?: number; source?: string; repo?: number }): string | undefined {
  // Without a type or repo, keep the original format so simple servers are unchanged.
  if (context.type === undefined && context.repo === undefined) return context.source || undefined;
  const base = `${context.type ?? ''}|${context.source ?? ''}`;
  return context.repo === undefined ? base : `${base}|${context.repo}`;
}

function decodeContext(value: string | undefined): { type: number | null; source: string; repo: number | null } {
  const raw = value ?? '';
  if (!raw.includes('|')) return { type: null, source: raw, repo: null };
  const [type = '', source = '', repo = ''] = raw.split('|');
  return { type: type === '' ? null : Number(type), source, repo: repo === '' ? null : Number(repo) };
}

type Prefill = {
  description?: string;
  source?: string;
  type?: { index: number; name: string };
  repo?: Pick<GuildRepo, 'id' | 'repo_full_name'>;
};

function reportModal(prefill: Prefill = {}) {
  const description = makeTextInput('description', undefined, textInputStyle.Paragraph)
    .placeholder('What went wrong? What did you expect to happen instead?')
    .min_length(DESCRIPTION_MIN)
    .max_length(4000)
    .required(true);

  // Discord rejects a modal whose prefilled value is shorter than min_length
  // ("application didn't respond"), so short messages are left for the reporter to expand on.
  const prefilled = prefill.description && prefill.description.length >= DESCRIPTION_MIN;

  const title = truncate(['Report a bug', prefill.repo?.repo_full_name, prefill.type?.name].filter(Boolean).join(' · '), 45);
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

  const context = encodeContext({ type: prefill.type?.index, source: prefill.source, repo: prefill.repo?.id });
  return context ? modal.custom_value(context) : modal;
}

/* -------------------------------------------------------------------------- */
/*                                  Pre-check                                 */
/* -------------------------------------------------------------------------- */

type Check = { guild: GuildRow; repos: GuildRepo[]; premium: boolean } | { error: string };

/**
 * `repos` are the repositories members can report to right now: all of them with
 * Premium, otherwise just the primary one.
 */
async function canReport(
  env: Bindings,
  interaction: Parameters<typeof hasPremium>[1],
  guildId: string,
  userId: string
): Promise<Check> {
  const [guild, linked] = await Promise.all([getGuild(env.DB, guildId), getGuildRepos(env.DB, guildId)]);
  if (!guild || !linked.length) return { error: messages.notLinked };

  const age = await secondsSinceLastReport(env.DB, guildId, userId);
  if (age !== null && age < guild.cooldown_seconds) {
    return { error: `You're reporting a little fast — try again in **${guild.cooldown_seconds - age}s**.` };
  }
  const premium = hasPremium(env, interaction, guildId);
  return { guild, repos: activeRepos(linked, premium), premium };
}

/* -------------------------------------------------------------------------- */
/*                                  Pickers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reporting takes up to two steps before the form, because the form itself is
 * full (Discord allows five inputs): the repository, when the server has more
 * than one, then the type, when it defines any. `draft` is the id of a parked
 * message when the report started from "Apps → Report bug", so the form can
 * still be pre-filled at the end.
 *
 * The type picker's custom_id carries `<draft>|<repo id>`; a bare `<draft>` is
 * the format from before repositories, so pickers already open during a deploy
 * still work.
 */
type Picked = { draft: number; repo: number };

function encodePicked({ draft, repo }: { draft?: number; repo?: number }): string | undefined {
  if (repo === undefined) return draft === undefined ? undefined : String(draft);
  return `${draft ?? ''}|${repo}`;
}

function decodePicked(value: string | undefined): Picked {
  const [draft = '', repo = ''] = (value ?? '').split('|');
  return { draft: Number(draft) || 0, repo: Number(repo) || 0 };
}

function typePicker(types: string[], picked: { draft?: number; repo?: GuildRepo } = {}) {
  const select = makeStringSelect(
    'report-type',
    types.map((type, index) => [String(index), type] as const)
  ).placeholder('Choose a type');
  const state = encodePicked({ draft: picked.draft, repo: picked.repo?.id });

  return view([
    card([
      text('### What kind of problem is it?\nPick the closest match. The form opens next.'),
      row(state === undefined ? select : select.custom_value(state)),
    ]),
  ]);
}

function repoPicker(repos: GuildRepo[], draft?: number) {
  const select = makeStringSelect(
    'report-repo',
    repos.map((repo) => [String(repo.id), truncate(repo.repo_full_name, 100)] as const)
  ).placeholder('Choose a repository');

  return view([
    card([
      text('### Which project is it about?\nThis server has several repositories. Pick the one the bug belongs to.'),
      row(draft === undefined ? select : select.custom_value(String(draft))),
    ]),
  ]);
}

/** The step after a repository is known (or needn't be asked): the type picker, or straight to the form. */
type Next = { picker: ReturnType<typeof view> } | { modal: ReturnType<typeof reportModal> };

function afterRepo(
  guild: GuildRow,
  opts: { repo?: GuildRepo; draft?: number; prefill: Omit<Prefill, 'type' | 'repo'> }
): Next {
  const types = parseReportTypes(guild.report_types);
  if (types.length) return { picker: typePicker(types, { draft: opts.draft, repo: opts.repo }) };
  return { modal: reportModal({ ...opts.prefill, repo: opts.repo }) };
}

export const select_report_repo = factory.component(makeStringSelect('report-repo', [['0', 'repo']]), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const check = await canReport(c.env, c.interaction, ctx.guildId, ctx.member.user.id);
  if ('error' in check) return deny(c, check.error);

  const repo = check.repos.find((r) => r.id === Number(c.ref.values?.[0]));
  if (!repo) return deny(c, 'That repository is no longer available. Run the command again.');

  const draftId = Number(c.ref.custom_value);
  const draft = draftId ? await getDraft(c.env.DB, draftId, ctx.guildId, ctx.member.user.id) : null;

  const next = afterRepo(check.guild, {
    repo,
    draft: draft ? draftId : undefined,
    prefill: { description: draft?.description ?? undefined, source: draft?.source ?? undefined },
  });
  if ('modal' in next) return c.resModal(next.modal);
  return c.flags(...EPHEMERAL_V2).update().res(next.picker);
});

export const select_report_type = factory.component(makeStringSelect('report-type', [['0', 'type']]), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);

  const check = await canReport(c.env, c.interaction, ctx.guildId, ctx.member.user.id);
  if ('error' in check) return deny(c, check.error);

  const index = Number(c.ref.values?.[0]);
  const name = parseReportTypes(check.guild.report_types)[index];
  if (!name) return deny(c, 'That option is no longer available. Run the command again.');

  const picked = decodePicked(c.ref.custom_value);
  const repo = picked.repo ? check.repos.find((r) => r.id === picked.repo) : undefined;
  if (picked.repo && !repo) return deny(c, 'That repository is no longer available. Run the command again.');

  const draft = picked.draft ? await getDraft(c.env.DB, picked.draft, ctx.guildId, ctx.member.user.id) : null;

  return c.resModal(
    reportModal({
      description: draft?.description ?? undefined,
      source: draft?.source ?? undefined,
      type: { index, name },
      repo,
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

    const check = await canReport(c.env, c.interaction, ctx.guildId, ctx.member.user.id);
    if ('error' in check) return deny(c, check.error);

    if (check.repos.length > 1) return c.flags(...EPHEMERAL_V2).res(repoPicker(check.repos));

    const next = afterRepo(check.guild, { prefill: {} });
    return 'modal' in next ? c.resModal(next.modal) : c.flags(...EPHEMERAL_V2).res(next.picker);
  }
);

export const command_report_message = factory.command(
  makeMessageCommand('Report bug').contexts([0]).integration_types([0]),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);

    const check = await canReport(c.env, c.interaction, ctx.guildId, ctx.member.user.id);
    if ('error' in check) return deny(c, check.error);

    const target = c.interaction.data.resolved.messages[c.interaction.data.target_id];
    const source = target ? `${target.channel_id}:${target.id}` : undefined;
    const prefill = { description: target?.content || undefined, source };

    // Anything that needs a question first parks the message text until the form opens.
    const asksFirst = check.repos.length > 1 || parseReportTypes(check.guild.report_types).length > 0;
    if (asksFirst) {
      const draft = await createDraft(c.env.DB, {
        guildId: ctx.guildId,
        userId: ctx.member.user.id,
        source: source ?? null,
        description: target?.content || null,
      });
      if (check.repos.length > 1) return c.flags(...EPHEMERAL_V2).res(repoPicker(check.repos, draft));
      const next = afterRepo(check.guild, { draft, prefill });
      if ('picker' in next) return c.flags(...EPHEMERAL_V2).res(next.picker);
    }

    return c.resModal(reportModal(prefill));
  }
);

export const modal_report = factory.modal(reportModal(), (c) =>
  c.flags(...EPHEMERAL_V2).resDefer(
    guarded(async (c) => {
      const ctx = inGuild(c.interaction);
      if (!ctx) return c.followup(view([notice(messages.guildOnly)]));

      const check = await canReport(c.env, c.interaction, ctx.guildId, ctx.member.user.id);
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

      // A form without a repository (one opened before the server had several, or
      // on a single-repository server) files in the primary one.
      const repo = context.repo === null ? check.repos[0] : check.repos.find((r) => r.id === context.repo);
      if (!repo) {
        return c.followup(view([notice("That repository isn't available any more. Run `/report` again to pick another.")]));
      }

      const outcome = await submitReport(c.env, c.executionCtx, check.guild, repo, {
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
