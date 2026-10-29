import type { SelectMenuDefaultValueType } from 'discord-api-types/v10';
import {
  buttonStyle,
  channelType,
  makeButton,
  makeChannelSelect,
  makeLabel,
  makeLinkButton,
  makeModal,
  makeRoleSelect,
  makeSubCommand,
  makeTextInput,
} from 'discord-hono';
import { getGuild, isLinked, updateSettings, type GuildSettings } from '../../db';
import { escapeMarkdown, MAX_REPORT_TYPES, parseLabels, parseReportTypes } from '../../lib/format';
import { canManageGuild } from '../../lib/permissions';
import { card, divider, EPHEMERAL_V2, notice, row, section, text, view } from '../../lib/ui';
import { factory } from '../../init';
import { getProvider } from '../../providers';
import { sendChannelMessage } from '../../services/discord';
import type { Bindings, GuildRow } from '../../types';
import { deny, inGuild, messages } from '../shared';

const TEXT_CHANNELS = [channelType.GUILD_TEXT, channelType.GUILD_ANNOUNCEMENT];

const DEFAULTS: Pick<GuildRow, 'dm_reporters' | 'labels' | 'report_types' | 'cooldown_seconds'> = {
  dm_reporters: 1,
  labels: 'bug',
  report_types: '', // no picker: members go straight to the form
  cooldown_seconds: 60,
};

function channelSelect(
  id: 'settings-triage' | 'settings-updates',
  current: string | null,
  placeholder: string,
  render: string
) {
  const select = makeChannelSelect(id)
    .custom_value(render)
    .channel_types(TEXT_CHANNELS)
    .min_values(0)
    .max_values(1)
    .placeholder(placeholder);
  return current ? select.default_values([{ id: current, type: 'channel' as SelectMenuDefaultValueType.Channel }]) : select;
}

function settingsPanel(guild: GuildRow | null, warning?: string) {
  const settings = { ...DEFAULTS, ...guild };
  const repo = isLinked(guild)
    ? section(
        `Repository **${guild.repo_full_name}**`,
        makeLinkButton(getProvider(guild.provider).repoUrl(guild.repo_full_name), 'Open')
      )
    : text('Repository *not connected* — run `/dispatch setup`');

  // Discord keeps a select's local value across message edits when the
  // custom_id is unchanged, so re-picking the same channel after a failed save
  // sends nothing. A per-render suffix makes every panel's selects fresh.
  const render = Date.now().toString(36);
  const staffRole = makeRoleSelect('settings-staff')
    .custom_value(render)
    .min_values(0)
    .max_values(1)
    .placeholder('No staff role');
  const labels = parseLabels(settings.labels);
  const types = parseReportTypes(settings.report_types);

  return card([
    text('## Settings'),
    repo,
    warning ? text(`**${warning}**`) : null,
    divider(),
    text('### Triage queue\nNew reports wait here for staff approval before reaching the repository, each with a thread for discussion. Leave empty to file issues immediately.'),
    row(channelSelect('settings-triage', settings.triage_channel_id ?? null, 'Off — file issues immediately', render)),
    text('### Updates channel\nNew issues, fixes and reward roles are announced here.'),
    row(channelSelect('settings-updates', settings.updates_channel_id ?? null, 'Off — no announcements', render)),
    text('### Staff role\nCan approve or reject reports. Members with **Manage Server** always can.'),
    row(
      settings.staff_role_id
        ? staffRole.default_values([{ id: settings.staff_role_id, type: 'role' as SelectMenuDefaultValueType.Role }])
        : staffRole
    ),
    divider(),
    text(
      [
        `**Labels on every issue** ${labels.length ? labels.map((l) => `\`${escapeMarkdown(l)}\``).join(' ') : '*none*'}`,
        `**Report types** ${types.length ? types.map((t) => `\`${escapeMarkdown(t)}\``).join(' ') : '*none*, members go straight to the form'}`,
        `**Cooldown** ${settings.cooldown_seconds}s between reports per member`,
        `**Reporter DMs** ${settings.dm_reporters ? 'On — reporters hear about approvals, fixes and maintainer comments' : 'Off'}`,
      ].join('\n')
    ),
    row(
      makeButton('settings-edit', 'Edit labels, types & cooldown', buttonStyle.Secondary),
      makeButton(
        'settings-dm',
        settings.dm_reporters ? 'Turn off reporter DMs' : 'Turn on reporter DMs',
        buttonStyle.Secondary
      )
    ),
  ]);
}

/**
 * Discord rejects a text input pre-filled with an empty string, and the modal
 * then fails with "didn't respond in time". An unset setting must send no value.
 */
function prefilled(input: ReturnType<typeof makeTextInput>, value: string) {
  return value ? input.value(value) : input;
}

function settingsModal(guild: GuildRow | null) {
  const settings = { ...DEFAULTS, ...guild };
  return makeModal('settings-edit', 'Report settings', [
    makeLabel(
      'Issue labels',
      prefilled(makeTextInput('labels'), settings.labels).placeholder('bug, from-discord').max_length(200).required(false)
    ).description('Added to every issue. Comma separated. Missing labels are created automatically.'),
    makeLabel(
      'Report types',
      prefilled(makeTextInput('types'), settings.report_types)
        .placeholder('Crash, UI, Performance, Other')
        .max_length(400)
        .required(false)
    ).description(`Members pick one before the form opens; it becomes an issue label. Up to ${MAX_REPORT_TYPES}. Empty to skip.`),
    makeLabel(
      'Cooldown (seconds)',
      makeTextInput('cooldown').value(String(settings.cooldown_seconds)).min_length(1).max_length(4).required(true)
    ).description('Minimum time between reports from the same member. 0 – 3600.'),
  ]);
}

/** Confirms the bot can post in a channel by announcing its new role there. */
async function claimChannel(env: Bindings, channelId: string, purpose: string): Promise<boolean> {
  const id = await sendChannelMessage(env, channelId, [notice(`This channel is now Dispatch's **${purpose}**.`)]);
  return id !== null;
}

async function applySettings(env: Bindings, guildId: string, settings: GuildSettings) {
  await updateSettings(env.DB, guildId, settings);
  return getGuild(env.DB, guildId);
}

/* -------------------------------------------------------------------------- */
/*                                  Handlers                                  */
/* -------------------------------------------------------------------------- */

export const sub_settings = factory.subCommand(
  makeSubCommand('settings', 'Triage queue, announcements, staff role, labels and more'),
  async (c) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);
    const guild = await getGuild(c.env.DB, ctx.guildId);
    return c.flags(...EPHEMERAL_V2).res(view([settingsPanel(guild)]));
  }
);

function channelHandler(field: 'triage_channel_id' | 'updates_channel_id', purpose: string) {
  return async (c: Parameters<Parameters<typeof factory.component>[1]>[0]) => {
    const ctx = inGuild(c.interaction);
    if (!ctx) return deny(c, messages.guildOnly);
    if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

    const channelId = c.ref.values?.[0] ?? null;
    const ok = channelId ? await claimChannel(c.env, channelId, purpose) : true;
    const guild = ok
      ? await applySettings(c.env, ctx.guildId, { [field]: channelId })
      : await getGuild(c.env.DB, ctx.guildId);

    const warning = ok
      ? undefined
      : `I can't post in <#${channelId}>. Give Dispatch **View Channel** and **Send Messages** there, then pick it again.`;
    return c.flags(...EPHEMERAL_V2).update().res(view([settingsPanel(guild, warning)]));
  };
}

export const select_settings_triage = factory.component(
  makeChannelSelect('settings-triage'),
  channelHandler('triage_channel_id', 'triage queue')
);

export const select_settings_updates = factory.component(
  makeChannelSelect('settings-updates'),
  channelHandler('updates_channel_id', 'updates channel')
);

export const select_settings_staff = factory.component(makeRoleSelect('settings-staff'), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);
  if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

  const guild = await applySettings(c.env, ctx.guildId, { staff_role_id: c.ref.values?.[0] ?? null });
  return c.flags(...EPHEMERAL_V2).update().res(view([settingsPanel(guild)]));
});

export const button_settings_dm = factory.component(makeButton('settings-dm', 'Toggle DMs'), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);
  if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

  const current = await getGuild(c.env.DB, ctx.guildId);
  const guild = await applySettings(c.env, ctx.guildId, { dm_reporters: (current?.dm_reporters ?? 1) ? 0 : 1 });
  return c.flags(...EPHEMERAL_V2).update().res(view([settingsPanel(guild)]));
});

export const button_settings_edit = factory.component(makeButton('settings-edit', 'Edit'), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);
  if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

  return c.resModal(settingsModal(await getGuild(c.env.DB, ctx.guildId)));
});

export const modal_settings_edit = factory.modal(settingsModal(null), async (c) => {
  const ctx = inGuild(c.interaction);
  if (!ctx) return deny(c, messages.guildOnly);
  if (!canManageGuild(ctx.member)) return deny(c, messages.adminOnly);

  const cooldown = Number(c.var.cooldown);
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 3600) {
    const guild = await getGuild(c.env.DB, ctx.guildId);
    return c
      .flags(...EPHEMERAL_V2)
      .update()
      .res(view([settingsPanel(guild, 'Cooldown must be a whole number of seconds between 0 and 3600.')]));
  }

  // Say so rather than silently dropping types past the limit.
  const typeCount = new Set((c.var.types ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)).size;
  if (typeCount > MAX_REPORT_TYPES) {
    const guild = await getGuild(c.env.DB, ctx.guildId);
    return c
      .flags(...EPHEMERAL_V2)
      .update()
      .res(view([settingsPanel(guild, `Use at most ${MAX_REPORT_TYPES} report types (you entered ${typeCount}).`)]));
  }

  const guild = await applySettings(c.env, ctx.guildId, {
    labels: parseLabels(c.var.labels ?? '').join(', '),
    report_types: parseReportTypes(c.var.types ?? '').join(', '),
    cooldown_seconds: cooldown,
  });
  return c.flags(...EPHEMERAL_V2).update().res(view([settingsPanel(guild)]));
});
