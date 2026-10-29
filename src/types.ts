export type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  /** Static site built from `site/` */
  ASSETS: Fetcher;

  /** Public origin of this Worker, e.g. https://dispatch.example.workers.dev (no trailing slash) */
  PUBLIC_URL: string;

  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_TOKEN: string;

  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** PEM private key from the GitHub App settings (PKCS#1 or PKCS#8) */
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;

  /** Random secret used to sign OAuth state and link tokens */
  STATE_SECRET: string;

  /** Hex accent colour for message cards, e.g. `84fada`. Defaults to the brand colour; beta sets its own. */
  ACCENT_COLOR?: string;
};

export type AppEnv = {
  Bindings: Bindings;
};

export type Provider = 'github';

export type GuildRow = {
  guild_id: string;
  provider: Provider | null;
  installation_id: number | null;
  repo_id: number | null;
  repo_full_name: string | null;
  linked_by: string | null;
  linked_at: string | null;
  triage_channel_id: string | null;
  updates_channel_id: string | null;
  staff_role_id: string | null;
  dm_reporters: number;
  labels: string;
  /** Comma separated; empty means no picker. */
  report_types: string;
  cooldown_seconds: number;
  created_at: string;
  updated_at: string;
};

/** A guild whose repository link is complete. */
export type LinkedGuild = GuildRow & {
  provider: Provider;
  installation_id: number;
  repo_id: number;
  repo_full_name: string;
};

export type ReportStatus = 'pending' | 'rejected' | 'open' | 'fixed' | 'closed';

export type Attachment = {
  name: string;
  url: string;
  content_type: string;
};

export type ReportRow = {
  id: number;
  guild_id: string;
  reporter_id: string;
  reporter_name: string;
  title: string;
  description: string;
  steps: string | null;
  environment: string | null;
  source_url: string | null;
  attachments: string;
  /** Type picked in the form (also an issue label), if the server has types. */
  report_type: string | null;
  status: ReportStatus;
  provider: Provider | null;
  repo_id: number | null;
  repo_full_name: string | null;
  issue_number: number | null;
  issue_url: string | null;
  triage_channel_id: string | null;
  triage_message_id: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

export type RewardTier = {
  guild_id: string;
  role_id: string;
  threshold: number;
};
