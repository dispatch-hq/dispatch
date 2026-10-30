# Discord Interactions

## Rule: defer any handler that touches the database or an external API

Discord requires an initial response to an interaction within **3 seconds**, or the user sees "The application did not respond" and the token is wasted. D1 queries, GitHub calls and Discord REST calls can all exceed that in edge cases (cold start, contention, retries).

- If a command, component or modal handler awaits D1, GitHub, or any other network call **before** it responds, it must defer first: `return c.flags(...).resDefer(guarded(async (c) => { ...work...; await c.followup(view([...])) }))`.
- Always wrap deferred work in `guarded()` from `src/commands/shared.ts` so a failure replaces the "thinking…" state with an error message.
- Only reply synchronously (`c.res(...)`, `reply`, `deny`) when the handler needs no I/O, e.g. validating options, guild-only checks, or opening a modal with `resModal`.
- Check ephemeral vs public when deferring: the flags passed before `resDefer` decide the visibility of the follow-up.
- When adding or editing a handler, check the whole path, including any helper such as `panelFor` that queries the DB, not just the handler body.
- Tests should cover the deferred path via the harness in `test/support/harness.ts`.

# Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI, or Agents SDK task.

## Docs

- https://developers.cloudflare.com/workers/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

For all limits and quotas, retrieve from the product's `/platform/limits/` page. eg. `/workers/platform/limits`

## Commands

| Command | Purpose |
|---------|---------|
| `npx wrangler dev` | Local development |
| `npx wrangler deploy` | Deploy to Cloudflare |
| `npx wrangler types` | Generate TypeScript types |

Run `wrangler types` after changing bindings in wrangler.jsonc.

## Node.js Compatibility

https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Errors

- **Error 1102** (CPU/Memory exceeded): Retrieve limits from `/workers/platform/limits/`
- **All errors**: https://developers.cloudflare.com/workers/observability/errors/

## Product Docs

Retrieve API references and limits from:
`/kv/` · `/r2/` · `/d1/` · `/durable-objects/` · `/queues/` · `/vectorize/` · `/workers-ai/` · `/agents/`

## Best Practices (conditional)

If the application uses Durable Objects or Workflows, refer to the relevant best practices:

- Durable Objects: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Workflows: https://developers.cloudflare.com/workflows/build/rules-of-workflows/
