import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // 复用 public/manifest.webmanifest
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/zhaokao/, /^\/daily/, /^\/sitemap\.xml$/, /^\/robots\.txt$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 列表数据：stale-while-revalidate，缓存不超过 10 分钟
            urlPattern: /\/api\/(positions|campus|bianzhi)(\/|\?|$)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-lists',
              expiration: { maxEntries: 120, maxAgeSeconds: 600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // 其余 API：networkFirst 短超时回退缓存
            urlPattern: /\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@base-ui') || id.includes('@floating-ui')) return 'base-ui'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack')) return 'tanstack'
          if (id.includes('pinyin-pro')) return 'pinyin'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('axios')) return 'axios'
        },
      },
    },
  },
})
