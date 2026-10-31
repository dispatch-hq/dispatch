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

  /**
   * Discord SKU id of the Premium subscription (Developer Portal → Monetization).
   * Unset means any active entitlement for this application counts as Premium.
   */
  PREMIUM_SKU_ID?: string;
};

export type AppEnv = {
  Bindings: Bindings;
};

export type Provider = 'github';

export type GuildRow = {
  guild_id: string;
  triage_channel_id: string | null;
  updates_channel_id: string | null;
  staff_role_id: string | null;
  dm_reporters: number;
  labels: string;
  /** Comma separated; empty means no picker. */
  report_types: string;
  cooldown_seconds: number;
  /** Accepted reports that fast-track a reporter past triage. 0 turns it off. */
  trust_min_reports: number;
  board_channel_id: string | null;
  board_message_id: string | null;
  /** Identifies what the status board last showed, to skip edits that change nothing. */
  board_version: string | null;
  created_at: string;
  updated_at: string;
};

/** A repository linked to a server. The oldest link is the server's primary repository. */
export type GuildRepo = {
  /** Handle used in Discord custom_ids; stable until the repository is disconnected. */
  id: number;
  guild_id: string;
  provider: Provider;
  installation_id: number;
  repo_id: number;
  repo_full_name: string;
  linked_by: string | null;
  linked_at: string;
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
  votes: number;
  /** The updates-channel post for this report, kept current with its status and votes. */
  announce_channel_id: string | null;
  announce_message_id: string | null;
  /** Staff's open question to the reporter; the report stays `pending` until it's answered. */
  info_request: string | null;
  info_requested_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CannedReply = {
  id: number;
  guild_id: string;
  label: string;
  body: string;
};

export type RewardTier = {
  guild_id: string;
  role_id: string;
  threshold: number;
};
