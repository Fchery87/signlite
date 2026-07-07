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
    rollupOptions: {
      output: {
        manualChunks(id) {
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
