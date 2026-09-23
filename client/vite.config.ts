import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'EasyRecette — toute vidéo devient une fiche cuisine',
        short_name: 'EasyRecette',
        description:
          "Transforme n'importe quelle vidéo ou article en recette structurée, et garde toute ta cuisine au même endroit.",
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2ede3',
        theme_color: '#17140f',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Raccourci utile : l'usage type est « je viens de copier un lien TikTok ».
        shortcuts: [
          {
            name: 'Importer un lien',
            short_name: 'Importer',
            url: '/?import=1',
          },
          {
            name: 'Liste de courses',
            short_name: 'Courses',
            url: '/shopping-list',
          },
        ],
      },
      workbox: {
        // Les appels API ne sont jamais servis depuis le cache : une recette
        // périmée affichée comme fraîche serait pire qu'une erreur réseau.
        // /media non plus : ce sont des vidéos de plusieurs mégaoctets, qui
        // rempliraient le cache du navigateur sans bénéfice réel.
        navigateFallbackDenylist: [/^\/api/, /^\/media/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'recipe-images',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],

  server: {
    port: 5173,
    // Le client appelle /api en relatif : aucune URL de backend ne traîne
    // dans le bundle, et le même code marche en production derrière un proxy.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Vidéos et vignettes des recettes importées : servies par l'API, mais
      // référencées en chemin relatif dans les fiches. Sans ce proxy, elles
      // seraient introuvables en développement.
      '/media': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },

  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
