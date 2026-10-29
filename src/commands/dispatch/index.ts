import { makeSlashCommand } from 'discord-hono';
import { factory } from '../../init';
import { MANAGE_GUILD_PERMISSION } from '../../lib/permissions';
import { sub_disconnect } from './disconnect';
import { group_rewards } from './rewards';
import { sub_settings } from './settings';
import { sub_setup } from './setup';

const subs = [sub_setup, sub_settings, sub_disconnect, group_rewards];

export const command_dispatch = factory.command(
  makeSlashCommand('dispatch', 'Configure Dispatch for this server')
    .options(factory.getSubCommands(subs))
    .default_member_permissions(MANAGE_GUILD_PERMISSION)
    .contexts([0])
    .integration_types([0]),
  factory.subLoader(subs)
);

export { button_disconnect_cancel, button_disconnect_confirm, select_disconnect_pick } from './disconnect';
export {
  button_settings_dm,
  button_settings_edit,
  modal_settings_edit,
  select_settings_staff,
  select_settings_triage,
  select_settings_updates,
} from './settings';
