import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [preact({ compat: true })],
  site: 'https://clientreview.info',
  base: '/sg-bike-route/',
  trailingSlash: "never",

  vite: {
    plugins: [tailwindcss()],
  },
});
