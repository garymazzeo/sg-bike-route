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
    server: {
      proxy: {
        '/sg-bike-route/api/locations.php': {
          target: 'https://aadl.org',
          changeOrigin: true,
          rewrite: () => '/summergame/map/data/SummerGame2026',
        },
      },
    },
  },
});
