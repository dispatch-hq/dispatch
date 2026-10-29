import { defineConfig } from 'astro/config';

// The marketing site. Built to `site/dist`, which the Worker serves as static
// assets (see `assets` in wrangler.jsonc).
export default defineConfig({
  // Canonical origin, used for absolute URLs in meta tags (Discord and other
  // crawlers need an absolute og:image), robots.txt and the sitemap.
  // Override with SITE_URL when building for another environment.
  site: process.env.SITE_URL ?? 'https://dispatch.jakemackie.workers.dev',
  output: 'static',
  // `/privacy` rather than `/privacy.html`, matching the Worker's html_handling.
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  // `astro dev` only serves the static site. Worker routes such as /invite are
  // forwarded to `npm run dev` (wrangler) when it is running.
  vite: { server: { proxy: { '/invite': 'http://localhost:8787' } } },
});
