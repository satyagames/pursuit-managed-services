import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Prompt 44: the refactor's screenshot comparison. The same server and pages as playwright.config.ts, Chromium only, one spec
// (scripts/migration-tests/refactor-baseline.spec.ts). Its pictures are kept in test-results/refactor-before/ (never committed): record them once
// on the untouched branch with `npm run test:refactor -- --update-snapshots`, then `npm run test:refactor` after each step compares every page with
// them and fails on more than 0.1% of a page's pixels changed.
export default defineConfig({
  ...base,
  testMatch: /refactor-baseline\.spec\.ts/,
  outputDir: '../test-results/.refactor-run',
  snapshotPathTemplate: '../test-results/refactor-before/{arg}{ext}',
  timeout: 120_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled', caret: 'hide', scale: 'css' } },
  projects: [{ name: 'chromium' }],
});
