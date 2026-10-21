import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Vite configuration for the GOLD RING client.
 *
 * The shared package is consumed straight from TypeScript source so that the
 * exact same rules/physics code runs in the browser, in the Node server and in
 * Vitest. No build step (and therefore no drift) is possible between them.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      '@client': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The build script cleans dist/client itself; Vite's emptyDir hook is
    // skipped so builds also work in sandboxed/CI environments.
    emptyOutDir: false,
    sourcemap: true,
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', 'three/webgpu'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.glsl'],
});
