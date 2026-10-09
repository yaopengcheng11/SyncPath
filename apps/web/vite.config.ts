import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
//
// In the monorepo, the cwd is the repo root when running `npm run dev:web`
// from there, but the .env files and index.html live in this package. We
// resolve everything relative to this config file.
export default defineConfig(({ mode }) => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, here, '');

  return {
    root: here,
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    define: {
      // Reserved for future client-side flags.
      'process.env.VITE_API_BASE': JSON.stringify(env.VITE_API_BASE ?? '/api')
    },
    server: {
      port: Number(env.VITE_PORT ?? 5183),
      // LAN mode opts into a strict port so a second local app cannot make
      // the printed URL point at the wrong service.
      strictPort: env.VITE_STRICT_PORT === 'true',
      host: env.VITE_HOST ?? false,
      // Proxy /api → Fastify so the SPA can use same-origin cookies
      // (HttpOnly, Secure, SameSite=Lax) without CORS dance in dev.
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET ?? 'http://localhost:3160',
          changeOrigin: false,
          secure: false
        }
      }
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true
    }
  };
});
