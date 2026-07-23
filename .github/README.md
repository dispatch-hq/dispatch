# Flash Discord Bot

Serverless Discord bot built with TypeScript and `discord-hono`, hosted on Cloudflare Workers.

## 🚀 Project Structure

```text
/
├── src/
│   ├── commands/        # Slash command handlers
│   │   ├── hello.ts     # Individual command definitions
│   │   ├── ping.ts
│   │   └── index.ts     # Central command exporter
│   ├── index.ts         # Main Cloudflare Worker entrypoint
│   ├── init.ts          # Factory setup and environment types
│   └── register.ts      # Discord API command registration script
├── .env                 # Environment secrets (IDs & Tokens)
├── package.json
├── tsconfig.json
└── wrangler.json

```

## 🧞 Commands

All commands are run from the root of the project:

| Command | Action |
| --- | --- |
| `npm install` | Installs dependencies |
| `npm run dev` | Starts the local Cloudflare Worker dev environment |
| `npm run register` | Registers/updates slash commands with Discord's API |
| `npm run deploy` | Deploys your Worker to Cloudflare |

## 👀 Want to learn more?

Check out the [discord-hono documentation](https://discord-hono.luis.fun) or [Cloudflare Workers docs](https://developers.cloudflare.com/workers/).