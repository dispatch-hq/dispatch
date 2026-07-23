import { Command, Option, register } from 'discord-hono'

const commands = [
  new Command('hello', 'Hello, World!').options(new Option('name', 'Your name')),
  new Command('help', 'Docs URL'),
]

register(
  commands,
  process.env.DISCORD_APPLICATION_ID,
  process.env.DISCORD_TOKEN,
  // process.env.DISCORD_TEST_GUILD_ID,
)