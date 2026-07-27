import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@runtime': r('./src/runtime'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // AudioWorklet modules must stay real files. Vite would otherwise inline
    // anything under 4kB as a data: URI, and addModule() can't reliably load
    // those. Any `*.worklet.js` is exempt from inlining.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.worklet.js') ? false : undefined),
  },
})
