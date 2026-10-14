// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages with the custom domain tnelection.org (DNS on Cloudflare).
export default defineConfig({
  site: 'https://tnelection.org',
  trailingSlash: 'always',
  output: 'static',
  // sitemap-index.xml for search engines; the 404 page stays out.
  integrations: [sitemap({ filter: (page) => !page.endsWith('/404/') })],
});
