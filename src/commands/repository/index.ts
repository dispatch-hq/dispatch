import { Command, SubCommand } from 'discord-hono';
import { factory } from '../../init';
import type { AppEnv } from '../../types';
import { button_unlink_repository, handleInfo } from './info';
import {
  button_cancel_remove,
  button_confirm_remove,
  handleRemove,
} from './remove';
import { handleSetup, modal_repository_setup } from './setup';

export const command_repository = factory.command<AppEnv>(
  new Command('repository', 'Manage the linked GitHub repository for Dispatch').options(
    new SubCommand('setup', 'Link a GitHub repository to this server'),
    new SubCommand('info', 'View active GitHub repository configuration'),
    new SubCommand('remove', 'Unlink the active GitHub repository')
  ),
  async (c) => {
    switch (c.sub.command) {
      case 'setup':
        return handleSetup(c);
      case 'info':
        return handleInfo(c);
      case 'remove':
        return handleRemove(c);
      default:
        return c.res('Unknown subcommand.');
    }
  }
);

// Re-export interaction handlers for automatic loader registration
export {
  modal_repository_setup,
  button_unlink_repository,
  button_confirm_remove,
  button_cancel_remove,
};