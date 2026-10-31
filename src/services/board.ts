import { makeLinkButton } from 'discord-hono';
import { cardImage, cardUrl, drawable } from '../cards';
import { getBoardStats, getGuild, getGuildRepos, updateSettings } from '../db';
import { escapeMarkdown, truncate } from '../lib/format';
import { card, section, text, type Block, type Container } from '../lib/ui';
import type { Bindings } from '../types';
import { editChannelMessage } from './discord';

/**
 * The status board: one message in a channel of the server's choosing that always
 * shows where its reports stand. Its image URL changes exactly when what it shows
 * changes, so that URL is also how `refreshBoard` knows an edit is needed.
 */
export async function boardCard(env: Bindings, guildId: string): Promise<{ card: Container; version: string }> {
  const [{ counts, top }, repos] = await Promise.all([getBoardStats(env.DB, guildId), getGuildRepos(env.DB, guildId)]);

  const url = await cardUrl(env, {
    k: 'board',
    repo: repos[0] ? drawable(repos[0].repo_full_name, 60) : null,
    ...counts,
    top: top.map((report) => ({ title: drawable(report.title, 70) || `Report #${report.id}`, votes: report.votes })),
  });

  const items: Block[] = top.map((report) => {
    const line = `**${report.votes}** · ${escapeMarkdown(truncate(report.title, 90))}`;
    return report.issue_url ? section(line, makeLinkButton(report.issue_url, 'View')) : text(line);
  });

  return {
    version: url,
    card: card([
      cardImage(url, `${counts.open} open, ${counts.pending} in review, ${counts.fixed} fixed, ${counts.week} fixed this week.`),
      ...(items.length ? [text('### Most upvoted'), ...items] : [text('No upvoted reports right now.')]),
      text(`-# Updated <t:${Math.floor(Date.now() / 1000)}:R>`),
    ]),
  };
}

/** Brings the server's board up to date. Best effort, and a no-op if nothing it shows has changed. */
export async function refreshBoard(env: Bindings, guildId: string): Promise<void> {
  const guild = await getGuild(env.DB, guildId);
  if (!guild?.board_channel_id || !guild.board_message_id) return;

  const board = await boardCard(env, guildId);
  if (board.version === guild.board_version) return;

  const edited = await editChannelMessage(env, guild.board_channel_id, guild.board_message_id, [board.card]);
  if (edited) await updateSettings(env.DB, guildId, { board_version: board.version });
}
