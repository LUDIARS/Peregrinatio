import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
