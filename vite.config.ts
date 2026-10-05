import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'cmaps' },
        { src: 'node_modules/pdfjs-dist/standard_fonts/*', dest: 'standard_fonts' }
      ]
    })
  ],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Generated data modules and the raw worker source must stay out of
          // the entry chunk: without an explicit chunk each merges into its
          // importer's chunk, which is the entry.
          if (id.includes('pdf/workerSource')) {
            return 'pdf-worker-source';
          }
          if (id.includes('generated/pdfAssets')) {
            return 'pdf-assets';
          }
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'pdf-runtime';
          }
          if (id.includes('node_modules/pdf-lib') || id.includes('node_modules/date-fns')) {
            return 'pdf-flatten';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/zustand')) {
            return 'ui-vendor';
          }
          return undefined;
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    globals: true
  }
});
