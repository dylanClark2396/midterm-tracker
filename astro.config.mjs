// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages project site: https://<user>.github.io/<repo>/
export default defineConfig({
  site: 'https://dylanclark2396.github.io',
  base: '/midterm-tracker',
  trailingSlash: 'always',
  output: 'static',
});
