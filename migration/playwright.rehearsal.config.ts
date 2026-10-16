import { defineConfig } from '@playwright/test';

// Phase 10f, part D: RUNBOOK.md rehearsed on the mocked SharePoint REST with the pages of a RELEASE PACKAGE (build-svelte/package/pms-<commit>/, made
// by `npm run package:release` from a committed tree), served at the new site's own folder address. Kept out of `npm run test:migration`, whose pages
// are the release candidate: a package exists only once one has been made.
//
//   npm run test:rehearsal       screenshots of the steps land in test-results/rehearsal/
export default defineConfig({
  testDir: '../scripts/rehearsal-tests',
  outputDir: '../test-results/.rehearsal-run',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  use: { headless: true },
  projects: [
    { name: 'chromium' },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
