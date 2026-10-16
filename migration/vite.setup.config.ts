import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { appName } from './vite-plugin-app-name.ts';
import { builtSettings } from './vite-plugin-built-settings.ts';
import { unsupportedPage } from './vite-plugin-unsupported.ts';

const apiTarget = process.env.CEC_DEV_API_TARGET ?? 'http://localhost:3000';
const devPort = Number(process.env.VITE_SETUP_PORT) || 5176;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [appName(), builtSettings(), unsupportedPage(), svelte(), tailwindcss(), viteSingleFile()],
  server: {
    host: '0.0.0.0',
    port: devPort,
    strictPort: true,
    proxy: { '/api': apiTarget, '/assets': apiTarget },
  },
  build: {
    outDir: '../build-svelte/setup',
    emptyOutDir: true,
    target: 'safari16.4',
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: { input: fileURLToPath(new URL('./setup.html', import.meta.url)) },
  },
});