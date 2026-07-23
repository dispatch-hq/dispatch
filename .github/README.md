# Dispatch Discord Bot

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
├── .dev.vars            # Local dev environment secrets (Dev Bot)
├── .env                 # Production environment secrets (Prod Bot)
├── package.json
├── tsconfig.json
└── wrangler.json
```

## 🔐 Environments & Secrets

This project uses dual environment configurations to keep local testing completely separated from production:

* **`.dev.vars`**: Contains credentials for your **Development/Beta Bot**. Read automatically during `npm run dev` and `npm run dev:register`.
* **`.env`**: Contains credentials for your **Production Bot**. Read during `npm run prod:register`.
* **Cloudflare Workers Secrets**: Production bot secrets deployed directly to Cloudflare via `npx wrangler secret put`.

## 🧞 Commands

All commands are run from the root of the project:

| Command | Action |
| --- | --- |
| `npm install` | Installs dependencies |
| `npm run dev` | Starts the local Cloudflare Worker runtime (reads `.dev.vars`) |
| `npm run dev:register` | Registers/updates slash commands for the **Dev/Beta Bot** |
| `npm run prod:register` | Registers/updates slash commands for the **Production Bot** |
| `npm run deploy` | Deploys your Worker and production logic to Cloudflare |

## 👀 Want to learn more?

Check out the [discord-hono documentation](https://discord-hono.luis.fun) or [Cloudflare Workers docs](https://developers.cloudflare.com/workers/).
