import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/grouptab/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon-180x180.png'],
      manifest: {
        name: 'GroupTab', short_name: 'GroupTab',
        description: 'Split group trip expenses. No accounts, no paywall.',
        start_url: '/grouptab/', scope: '/grouptab/', display: 'standalone',
        background_color: '#f4f6f4', theme_color: '#1f6f54',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { navigateFallback: '/grouptab/index.html' },
    }),
  ],
  test: {
    // e2e/ holds Playwright specs (run via `npx playwright test`), not
    // vitest unit tests — without this, vitest's default *.spec.ts glob
    // picks them up and fails outside a browser/webServer context.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
