import type { APIRoute } from 'astro';

// Built from the page files, so a new page is listed without editing this file.
// Pages that must stay out of the index are skipped here, like 404 and the app shell.
const skip = new Set(['404', 'shell']);
const pages = import.meta.glob('./*.astro');

const paths = Object.keys(pages)
  .map((file) => file.replace(/^\.\//, '').replace(/\.astro$/, ''))
  .filter((name) => !skip.has(name))
  .map((name) => (name === 'index' ? '/' : `/${name}/`))
  .sort();

export const GET: APIRoute = ({ site }) => {
  const urls = paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml; charset=utf-8' } }
  );
};
