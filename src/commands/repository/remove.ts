import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from '@discordjs/builders';
import { ButtonStyle, SeparatorSpacingSize } from 'discord-api-types/v10';
import { Button, type CommandContext } from 'discord-hono';
import { factory } from '../../init';
import type { AppEnv, GuildConfig } from '../../types';

export async function handleRemove(c: CommandContext<AppEnv>) {
  const guildId = c.interaction.guild_id;

  if (!guildId) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Server execution required.')
    );

    return c.flags('EPHEMERAL', 'IS_COMPONENTS_V2').res({
      components: [container.toJSON()],
    });
  }

  const config = await c.env.DB.prepare(
    `SELECT github_repo FROM guild_configs WHERE guild_id = ?`
  ).bind(guildId).first<GuildConfig>();

  if (!config) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        'No active repository linked. Execute `/repository setup` to configure.'
      )
    );

    return c.flags('EPHEMERAL', 'IS_COMPONENTS_V2').res({
      components: [container.toJSON()],
    });
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Remove Repository')
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Are you sure you want to remove [${config.github_repo}](https://github.com/${config.github_repo})?`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('confirm_remove_repository')
          .setLabel('Confirm')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('cancel_remove_repository')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      )
    );

  return c.flags('EPHEMERAL', 'IS_COMPONENTS_V2').res({
    components: [container.toJSON()],
  });
}

export const button_confirm_remove = factory.component(
  new Button('confirm_remove_repository', 'Confirm'),
  async (c) => {
    const guildId = c.interaction.guild_id;

    if (guildId) {
      await c.env.DB.prepare(
        `DELETE FROM guild_configs WHERE guild_id = ?`
      ).bind(guildId).run();
    }

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Repository unlinked successfully.')
    );

    return c.flags('IS_COMPONENTS_V2').update().res({
      components: [container.toJSON()],
    });
  }
);

export const button_cancel_remove = factory.component(
  new Button('cancel_remove_repository', 'Cancel'),
  async (c) => {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent('Removal cancelled.')
    );

    return c.flags('IS_COMPONENTS_V2').update().res({
      components: [container.toJSON()],
    });
  }
);