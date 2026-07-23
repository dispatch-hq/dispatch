// src/init.ts
import { createFactory } from 'discord-hono'

export type Env = {
  Bindings: {
    // Add future bindings here (e.g. KV, D1 databases)
  }
}

export const factory = createFactory<Env>()