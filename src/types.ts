import type { DiscordHono } from 'discord-hono';

export type Bindings = {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DISCORD_TEST_GUILD_ID?: string;
  DB: D1Database;
};

export type Variables = {
  repo_url_input: string;
  [key: string]: any;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export type App = DiscordHono<AppEnv>;