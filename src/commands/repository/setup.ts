import {
  ContainerBuilder,
  TextDisplayBuilder,
} from '@discordjs/builders';
import { Modal, TextInput, type CommandContext } from 'discord-hono';
import { factory } from '../../init';
import type { AppEnv } from '../../types';
import { parseGitHubRepo } from '../../utils/github';

export async function handleSetup(c: CommandContext<AppEnv>) {
  return c.resModal(
    new Modal('repository_setup_modal', 'Link GitHub Repository').row(
      new TextInput('repo_url_input', 'GitHub Repository URL or Name')
        .placeholder('https://github.com/owner/repo or owner/repo')
        .required()
        .min_length(3)
        .max_length(200)
    )
  );
}

export const modal_repository_setup = factory.modal<AppEnv>(
  new Modal('repository_setup_modal', 'Link GitHub Repository'),
  async (c) => {
    const guildId = c.interaction.guild_id;

    if (!guildId) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent('Guild context required.')
      );

      return c.flags('EPHEMERAL', 'IS_COMPONENTS_V2').res({
        components: [container.toJSON()],
      });
    }

    const parsedRepo = parseGitHubRepo(c.var.repo_url_input);

    if (!parsedRepo) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          'Invalid GitHub URL or format. Pass a full URL or `owner/repo`.'
        )
      );

      return c.flags('EPHEMERAL', 'IS_COMPONENTS_V2').res({
        components: [container.toJSON()],
      });
    }

    await c.env.DB.prepare(
      `INSERT INTO guild_configs (guild_id, github_repo, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET github_repo = excluded.github_repo, updated_at = CURRENT_TIMESTAMP`
    ).bind(guildId, parsedRepo).run();

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### Dispatch Configured\nLinked to [${parsedRepo}](https://github.com/${parsedRepo}).`
      )
    );

    return c.flags('IS_COMPONENTS_V2').res({
      components: [container.toJSON()],
    });
  }
);