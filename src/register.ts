import { register } from 'discord-hono';
import * as handlers from './commands';
import { factory } from './init';

const commands = factory.getCommands(Object.values(handlers));
const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID || undefined;

// Set DISCORD_GUILD_ID to register to a single server — updates are instant,
// which is handy while developing. Global registration can take a while to
// propagate.
console.log(await register(commands, appId, token, guildId));

// `--clear-global` removes the app's global commands. Use it when a dev app
// is registered per-server, so stale global commands (e.g. from an older
// version) don't show up alongside the server ones.
if (process.argv.includes('--clear-global')) {
  if (!guildId) throw new Error('--clear-global needs DISCORD_GUILD_ID, or it would remove the commands just registered');
  console.log(await register([], appId, token));
}
