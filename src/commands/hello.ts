import { Command, Option } from 'discord-hono'
import { factory } from '../init'

export const command_hello = factory.command(
  new Command('hello', 'Say hello to someone').options(
    new Option('name', 'Name of the person to greet').required()
  ),
  (c) => {
    // discord-hono automatically injects command options into c.var
    const name = c.var.name
    return c.res(`Hello, ${name}! 👋`)
  }
)