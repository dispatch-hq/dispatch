import { register } from 'discord-hono';
import * as handlers from './commands';
import { factory } from './init';

const commands = factory.getCommands(Object.values(handlers));

// Set DISCORD_GUILD_ID to register to a single server — updates are instant,
// which is handy while developing. Global registration can take a while to
// propagate.
const result = await register(
  commands,
  process.env.DISCORD_APPLICATION_ID,
  process.env.DISCORD_TOKEN,
  process.env.DISCORD_GUILD_ID || undefined
);

console.log(result);
