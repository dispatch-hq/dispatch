import { Command } from 'discord-hono'
import { factory } from '../init'

export const command_ping = factory.command(
  new Command('ping', 'Responds with Pong! 🏓'),
  (c) => {
    return c.res('Pong! 🏓')
  }
)