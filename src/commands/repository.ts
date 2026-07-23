import { Button, Components, Command, Embed, Modal, SubCommand, TextInput } from 'discord-hono';
import { factory } from '../init';
import { parseGitHubRepo } from '../utils/github';

// 1. Slash Command with SubCommands defined
export const command_repository = factory.command(
  new Command('repository', 'Manage the linked GitHub repository for Dispatch').options(
    new SubCommand('setup', 'Link a GitHub repository to this server'),
    new SubCommand('info', 'View active GitHub repository configuration')
  ),
  async (c) => {
    const guildId = c.interaction.guild_id;

    if (!guildId) {
      return c.res({
        content: '❌ Commands must be executed inside a server.',
        flags: 64, // Ephemeral
      });
    }

    const subCommand = c.sub.command;

    // --- Subcommand: /repository setup ---
    if (subCommand === 'setup') {
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

    // --- Subcommand: /repository info ---
    if (subCommand === 'info') {
      const config: any = await c.env.DB.prepare(
        `SELECT github_repo FROM guild_configs WHERE guild_id = ?`
      ).bind(guildId).first();

      if (!config) {
        return c.res({
          content: '⚠️ **No repository configured.**\nRun `/repository setup` to link your GitHub project.',
          flags: 64,
        });
      }

      const embed = new Embed()
        .title('📦 Active Repository Link')
        .description(`This server is linked to:\n**\`${config.github_repo}\`**`)
        .color(0x5865f2)
        .footer({ text: 'Dispatch • Bug Reporting System' });

      const components = new Components().row(
        new Button('unlink_repository', 'Disconnect Repo', 'Danger')
      );

      return c.res({
        embeds: [embed],
        components: components,
      });
    }

    return c.res({ content: 'Unknown subcommand.', flags: 64 });
  }
);

// 2. Modal Submission Handler
export const modal_repository_setup = factory.modal(
  new Modal('repository_setup_modal', 'Link GitHub Repository'),
  async (c) => {
    const guildId = c.interaction.guild_id;
    if (!guildId) return c.res({ content: '❌ Guild not found.', flags: 64 });

    const rawInput = c.var.repo_url_input;
    const parsedRepo = parseGitHubRepo(rawInput);

    if (!parsedRepo) {
      return c.res({
        content: '❌ **Invalid GitHub URL/Format.**\nPlease enter a full URL (e.g., `https://github.com/owner/repo`) or `owner/repo`.',
        flags: 64,
      });
    }

    await c.env.DB.prepare(
      `INSERT INTO guild_configs (guild_id, github_repo, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET github_repo = excluded.github_repo, updated_at = CURRENT_TIMESTAMP`
    ).bind(guildId, parsedRepo).run();

    return c.res({
      content: `⚡ **Dispatch Configured!**\nLinked repository to **\`${parsedRepo}\`**. Members can now run \`/report\` to log issues directly.`,
    });
  }
);

// 3. Button Component Handler
export const button_unlink_repository = factory.component(
  new Button('unlink_repository', 'Disconnect Repo'),
  async (c) => {
    const guildId = c.interaction.guild_id;

    if (guildId) {
      await c.env.DB.prepare(`DELETE FROM guild_configs WHERE guild_id = ?`).bind(guildId).run();
    }

    return c.update().res({
      content: '🗑️ **Repository disconnected successfully.** Run `/repository setup` to link a new one.',
      embeds: [],
      components: [],
    });
  }
);