import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { appName } from './vite-plugin-app-name.ts';
import { builtSettings } from './vite-plugin-built-settings.ts';
import { unsupportedPage } from './vite-plugin-unsupported.ts';

const stubs = fileURLToPath(new URL('./src/lib/exports/export-stubs-unavailable.js', import.meta.url));
const apiTarget = process.env.CEC_DEV_API_TARGET ?? 'http://localhost:3000';
const devPort = Number(process.env.VITE_ADMIN_PORT) || 5175;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [appName(), builtSettings(), unsupportedPage(), svelte(), tailwindcss(), viteSingleFile()],
  resolve: {
    // jsPDF can load these three, for HTML and SVG to PDF, which no export here uses (see the file). They are about 80 kB gzip.
    alias: {
      html2canvas: stubs,
      canvg: stubs,
      dompurify: stubs,
    },
  },
  server: {
    host: '0.0.0.0',
    port: devPort,
    strictPort: true,
    proxy: { '/api': apiTarget, '/assets': apiTarget },
  },
  build: {
    outDir: '../build-svelte/admin',
    emptyOutDir: true,
    target: 'safari16.4',
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: { input: fileURLToPath(new URL('./admin.html', import.meta.url)) },
  },
});