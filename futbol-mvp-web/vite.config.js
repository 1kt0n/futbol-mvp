import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['e2e/**'],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['tercer-tiempo-logo.png', 'offline.html', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'Futbol MVP',
        short_name: 'FutbolMVP',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/me/, /^\/events/, /^\/auth/, /^\/admin-api/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'style' || request.destination === 'script',
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets-v1',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/public/tournaments/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-tournaments-v1',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 5 },
            },
          },
        ],
      },
    }),
  ],
})
