import type { DiscordHono } from 'discord-hono';

export type Bindings = {
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;
  DB: D1Database;
};

export type Variables = {
  repo_url_input: string;
  [key: string]: unknown;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export type App = DiscordHono<AppEnv>;

export type GuildConfig = {
  guild_id: string;
  github_repo: string;
  updated_at: string;
};