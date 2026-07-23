import { Command, register } from 'discord-hono'

const commands = [
  new Command('ping', 'Responds with Pong!'),
]

register(
  commands,
  process.env.DISCORD_APPLICATION_ID,
  process.env.DISCORD_TOKEN
)