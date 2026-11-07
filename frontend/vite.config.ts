import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/@codemirror/view') ||
            id.includes('node_modules/@codemirror/state') ||
            id.includes('node_modules/@codemirror/commands') ||
            id.includes('node_modules/@codemirror/search') ||
            id.includes('node_modules/@codemirror/lang-markdown')
          ) {
            return 'codemirror-core';
          }
          if (id.includes('node_modules/katex')) {
            return 'katex';
          }
        },
      },
    },
  },
});
