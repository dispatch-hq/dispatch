# Deployment

This project is a serverless Discord bot deployed using **Cloudflare Workers**.

## 🚀 How It Works

Unlike static sites, this project does not compile to a `dist/` folder. Instead, Cloudflare’s CLI (`wrangler`) bundles the TypeScript source code directly and deploys it to Cloudflare’s global edge network as a lightweight HTTP endpoint:

```text
src/
  ↓
wrangler deploy (esbuild)
  ↓
Cloudflare Worker (Edge API)
  ↑ (HTTP POST)
Discord Interactions API
```

When users run slash commands in Discord, Discord sends an HTTP `POST` request directly to your Worker endpoint, which processes the request and responds instantly.

The deployment is configured in `wrangler.json`:

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dispatch",
  "main": "src/index.ts",
  "compatibility_date": "2026-07-22"
}
```

## 🔑 Environment Variables & Secrets

This bot relies on three key Discord credentials:

| Variable | Description |
| --- | --- |
| `DISCORD_APPLICATION_ID` | Your Discord Application Client ID |
| `DISCORD_PUBLIC_KEY` | Used by the Worker to verify incoming HTTP signatures |
| `DISCORD_TOKEN` | Used by `npm run register` to sync slash commands |

### Local Development

Store these in a local `.env` file (never commit this file):

```ini
DISCORD_APPLICATION_ID="your_app_id"
DISCORD_PUBLIC_KEY="your_public_key"
DISCORD_TOKEN="your_bot_token"
```

### Production Secrets

For production, upload your credentials securely to Cloudflare using Wrangler:

```sh
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_TOKEN
```

If deploying via CI/CD, set `CLOUDFLARE_API_TOKEN` in your pipeline environment variables.

## 🧞 Deployment Steps

1. **Register Slash Commands** (Run once or whenever command signatures change):
```sh
npm run register
```


2. **Deploy the Worker**:
```sh
npm run deploy
```


3. **Configure Discord interactions**:
Copy your live `*.workers.dev` URL and paste it into the **Interactions Endpoint URL** field under your Application settings in the [Discord Developer Portal](https://discord.com/developers/applications).

## 👀 Want to learn more?

Check out the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/) and [discord-hono guide](https://discord-hono.luis.fun).
