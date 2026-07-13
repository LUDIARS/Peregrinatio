import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const ludiarsHosts = (process.env.LUDIARS_ALLOWED_HOSTS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

// 旅のしおり PWA (iOS Safari 主戦場)。dev port は 5179 固定。
// API はデフォルト http://127.0.0.1:8090 を直叩き (サーバ側 CORS 許可済)。
// 別オリジン (Tunnel 等) からも使えるよう /api と /uploads を proxy できるようにしておく。
const SERVER_TARGET = 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        // 地図タイル/JS・取り込み画像・API をオフラインや再訪時にキャッシュする。
        runtimeCaching: [
          {
            // Google Maps の JS / タイル / 静的アセット (cross-origin = opaque を許可)。
            // Uploads cache. Google Maps is intentionally not matched by this SW.
            urlPattern: ({ url }) => url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pe-uploads',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 旅データ等の API (GET)。オンラインは最新優先、オフラインはキャッシュ。
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pe-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Peregrinatio',
        short_name: 'Pe旅',
        description: '旅のしおり — 目的地集め・施設サマリ・経路・PDF しおり',
        theme_color: '#0e7c86',
        background_color: '#f7f7f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5179,
    strictPort: true,
    host: true,
    ...(ludiarsHosts.length > 0 ? { allowedHosts: ludiarsHosts } : {}),
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true },
      '/uploads': { target: SERVER_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
