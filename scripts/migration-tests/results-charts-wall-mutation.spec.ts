import { test, expect } from '@playwright/test';
import path from 'node:path';
import { PAGES, analyzePage } from '../analyze-bundle.js';
import { sharePointFolderPath } from '../deployment-config.js';
import { seedVine } from '../results-charts-fixtures.js';
import { PIN, ds, root, startLocal, stopLocal, useServer, type Local } from './admin-local.js';
import { walkTheWall } from './results-charts-support.js';

// Phase 11a, part D: the wall's check can fail. results-charts-names.spec.ts walks the wall display and finds no name in the page; this builds the
// admin page again with the wall's rule taken out (LiveDisplay.svelte's `withNames` no longer asks whether this is the wall, which is what keeps
// names off it) and walks the same wall with the same check, which must find them. Chromium only (migration/playwright.config.ts says why).

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

const RULE = 'const withNames = $derived(!wall && namesShown);';

test('the wall check finds the names on a page built without the wall\'s rule', async ({ page }) => {
  test.setTimeout(240_000);
  const mutant = {
    name: 'the-wall-is-given-names',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.split('?')[0].endsWith('/admin/LiveDisplay.svelte')) return null;
      if (!code.includes(RULE)) throw new Error(`The rule this mutation removes is not in LiveDisplay.svelte any more: ${RULE}`);
      return code.replace(RULE, 'const withNames = $derived(namesShown);');
    },
  };
  const admin = PAGES.find((entry) => entry.name === 'admin')!;
  const built = await analyzePage(admin, { outRoot: path.join(root, 'test-results', '.wall-mutant'), keepHtml: true, extraPlugins: [mutant] });
  const { session } = await seedVine(ds);
  await useServer(page, local);
  await page.route(`**${sharePointFolderPath}/admin-wall-mutant.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: built.html! }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${sharePointFolderPath}/admin-wall-mutant.html#live-display/${session.id}/wall`);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Live results · Wall display' })).toBeVisible();
  const found = await walkTheWall(page, 'the mutant wall page');
  console.log(`[wall mutation] the check found ${found.length} names, among them: ${found.slice(0, 3).join(' | ')}`);
  expect(found.length, 'the check finds names when the rule is gone').toBeGreaterThan(0);
  for (const name of ['Mike A', 'José Álvarez']) expect(found.some((entry) => entry.endsWith(`: ${name}`)), name).toBe(true);
});
