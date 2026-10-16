import { expect, test } from '@playwright/test';
import { axeCheck, describeFindings } from './a11y-support.js';
import { newFake, pageUrl, serveSharePoint } from './sharepoint.js';
import { TITLE } from '../sharepoint-fake.js';

// Phase 9b, the Setup page, in the BUILT page, in a browser, against the mocked SharePoint REST (scripts/sharepoint-fake.js; nothing here ran on the real
// tenant). F: Check Lists, strict about every column since Phase 10c-2b. (G's two read-only probes are in setup.spec.ts, with the self-test.)

// ---- F. DEP-1, and since Phase 10c-2b: Setup's Check Lists is strict about every column -----------------------------------------------
// Until Phase 10c-2b what the strict check did not test was listed apart, "Please check by eye", as warnings that left every row Ready. Schema v2
// checks every column strictly: the same flaws are problems now, in "What to fix", and there is no block of warnings.

test('Check Lists names a Yes/No made as text, a single-line Prompt and a missing index as problems; a column called Order0 is not the app\'s and is not named', async ({ page, browserName }) => {
  const fake = newFake();
  const set = (list: string, column: string, change: Record<string, unknown>) => Object.assign(fake.fields.get(list)!.find((entry) => entry.InternalName === column)!, change);
  set('sections', 'Enabled', { TypeAsString: 'Text' });
  set('questions', 'Prompt', { TypeAsString: 'Text' });
  set('tracks', 'SessionId', { Indexed: false });
  fake.fields.get('sections')!.push({ InternalName: 'Order0', TypeAsString: 'Number', Indexed: false, EnforceUniqueValues: false, RichText: false, AppendOnly: false, Required: false, ReadOnlyField: false });
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  await page.getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'List configuration needs attention' })).toBeVisible();
  const fix = page.getByRole('table', { name: 'What to fix' });
  const rows = (await fix.getByRole('row').allInnerTexts()).slice(1).map((row) => row.split('\t').map((cell) => cell.trim()).join(' | '));
  expect(rows).toEqual([
    `${TITLE.sections} | Enabled | Yes/No | Wrong type: it is Single line of text.`,
    `${TITLE.questions} | Prompt | Multiple lines of text, plain text | Wrong type: it is Single line of text.`,
    `${TITLE.tracks} | SessionId | Single line of text, indexed | Not indexed.`,
  ]);
  await expect(page.getByRole('heading', { name: 'Please check by eye' })).toHaveCount(0);
  // axe (WCAG 2.1 A and AA; it reads the DOM, which is the same in every engine) finds nothing in the list check.
  if (browserName === 'chromium') expect(describeFindings((await axeCheck(page, 'Setup: What to fix')).findings)).toBe('');
  // It only read: not one write went to the site.
  expect(fake.requests.filter((entry) => !['GET'].includes(entry.method) && !/\$batch|contextinfo/.test(entry.path)).length).toBe(0);
});

test('a site made from the schema is Ready in every row, with nothing to fix and no block of warnings', async ({ page }) => {
  const fake = newFake();
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('setup.html'));
  await page.getByRole('button', { name: 'Check Lists' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'All list schemas ready' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to fix' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Please check by eye' })).toHaveCount(0);
  await expect(page.getByTestId('check-by-eye')).toHaveCount(0);
});
