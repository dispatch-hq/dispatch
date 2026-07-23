import { register } from 'discord-hono'
import * as handlers from './commands'
import { factory } from './init'

// Get command definitions directly from your handlers
const commands = factory.getCommands(Object.values(handlers))

register(
  commands,
  process.env.DISCORD_APPLICATION_ID,
  process.env.DISCORD_TOKEN
)