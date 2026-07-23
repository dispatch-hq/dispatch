// src/init.ts
import { createFactory } from 'discord-hono'

export type Env = {
  Bindings: {
    DISCORD_APPLICATION_ID: string
    DISCORD_PUBLIC_KEY: string
    DISCORD_TOKEN: string
    DISCORD_TEST_GUILD_ID: string
  }
}

export const factory = createFactory<Env>()