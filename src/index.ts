import { DiscordHono } from 'discord-hono'

const app = new DiscordHono()

// Listen for the /ping command sent from Discord
app.command('ping', (c) => {
  return c.res('Pong! 🏓')
})

export default app