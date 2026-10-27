import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Builds sw.js from src/pwa/sw.js with this build's files to precache and a version. */
function serviceWorker(): Plugin {
  return {
    name: 'vibe-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `/${f}`);
      const precache = [...files, '/app.html', '/favicon.svg', '/manifest.webmanifest', '/brand/icon-192.png', '/terms/', '/privacy/'];
      const version = createHash('sha256').update(precache.join('\n')).update(readFileSync('public/terms/index.html')).update(readFileSync('public/privacy/index.html')).digest('hex').slice(0, 12);
      const source = readFileSync('src/pwa/sw.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Firebase and @google/genai are dynamically imported, so they split on their own.
        manualChunks: (id: string) => (id.includes('node_modules/tone') ? 'tone' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
