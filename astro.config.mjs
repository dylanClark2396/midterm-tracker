// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages with the custom domain tnelection.org (DNS on Cloudflare).
export default defineConfig({
  site: 'https://tnelection.org',
  trailingSlash: 'always',
  output: 'static',
});
