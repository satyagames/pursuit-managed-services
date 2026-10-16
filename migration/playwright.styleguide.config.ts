import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Development-only checks of the design foundation. The styleguide exists only in the Vite dev
// server (never in a build), so this config starts that and the main config does not.
//
//   npm run test:styleguide      screenshots land in test-results/styleguide/
const port = 5191;

export default defineConfig({
  testDir: '../scripts/styleguide-tests',
  // Kept apart from test-results/styleguide so Playwright's own clean-up never deletes the screenshots.
  outputDir: '../test-results/.styleguide-run',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npm run dev:svelte',
    env: { VITE_PORT: String(port) },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
