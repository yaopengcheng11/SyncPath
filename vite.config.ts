import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    base: './', // CRITICAL: Makes paths relative (e.g., "assets/index.js") instead of absolute ("/assets/index.js")
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || (process as any).env?.API_KEY || '')
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  };
});
