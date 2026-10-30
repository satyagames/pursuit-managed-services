import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';

// Prompt 21, Phase 5: the Leadership dashboard (board 9) in the BUILT admin page, signed in as a person of the new lists, against the mocked SharePoint
// REST. Leadership opens Results on the dashboard; it reads the sessions' summaries and the clients, never an answer; a period's Leadership sees every
// client of the period, a client's Leadership that client only (another client's data is never asked for); the arrow opens a client's sessions in place,
// each with its Export; the i button of a figure shows its words on focus and hides them on Escape; the keyboard reaches every control; axe finds nothing.

const mail = (name: string) => `${name}@deloitte.com`;
const me = (name: string, title: string) => ({ Id: 7, Title: title, Email: mail(name), LoginName: `i:0#.f|membership|${mail(name)}`, IsSiteAdmin: false });

/** A summary item: `afters` Afters with a mean of `mean`, in FY27-Q2. */
const summary = (id: string, clientId: string, date: string, afters: number, mean: number, more: Record<string, unknown> = {}) => ({
  Title: id, AppId: id, ClientId: clientId, Period: 'FY27-Q2', SessionDate: `${date}T00:00:00Z`, Guests: afters, Answers: afters * 3, Completed: afters, BeforeCount: afters,
  AfterCount: afters, PairedCount: afters, MeanBefore: mean - 1, MeanAfter: mean,
  SummaryJson: JSON.stringify({ v: 1, title: 'Morning workshop', startTime: '09:30', facilitator: 'Aedla, Rajeshwar', scaleMax: 5, pairedBefore: mean - 1, pairedAfter: mean,
    moved: { started: 4, moved: 2 }, distribution: { before: [1, 2, 3, 2, 2], after: [0, 1, 2, 4, 3] }, firstChoices: [{ questionId: 'q', prompt: 'First?', options: [{ label: 'Speed', count: 6 }] }],
    kinds: { choice: afters }, groups: {}, feedback: { count: 1, themes: [{ word: 'clarity', count: 1 }], quotes: [{ name: 'Asha Rao', text: 'Clear and useful' }] } }),
  ...more,
});

async function site(who: ReturnType<typeof me>, kind: string, scope: string, place: Record<string, string> = {}) {
  const fake = newFake({ user: who });
  await onSite(fake, (ds) => seedPack(ds, samplePack()));
  const name = who.Email.split('@')[0];
  fake.add('users', { Title: who.Email, AppId: who.Email, FullName: who.Title, Email: who.Email, Status: 'Active', Source: 'Typed' });
  fake.add('roleassignments', {
    Title: `${name}|${kind}`, AppId: `${who.Email}|${kind}|${scope}|${place.ClientId ?? ''}`, UserKey: who.Email, Role: kind, ScopeType: scope, ClientId: '', SessionId: '', Extras: '', ...place,
  });
  // Kroger 12 Afters at 3.3, Domino's 12 at 2.7: the all-client average is 3.0, so Kroger is 110 and Domino's 90.
  fake.add('sessionsummary', summary('kroger-2026-10-14-0930', 'c-kroger', '2026-10-14', 12, 3.3));
  fake.add('sessionsummary', summary('dominos-2026-10-20-0930', 'c-dominos', '2026-10-20', 12, 2.7));
  return fake;
}
async function open(page: Page, fake: Fake) {
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  const served = await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await expect(page.getByRole('heading', { name: 'Leadership dashboard', level: 2 })).toBeVisible();
  return served;
}
const axe = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((each) => `${each.id}: ${each.nodes.map((node) => node.target.join(' ')).join(', ')}`), label).toEqual([]);
};
const requests = (fake: Fake) => (fake as unknown as { requests: { url?: string; query?: string; path?: string; parts?: { url?: string; query?: string }[] }[] }).requests
  .flatMap((entry) => [entry, ...(entry.parts ?? [])]).map((each) => decodeURIComponent(`${each.path ?? ''}${each.url ?? ''} ${each.query ?? ''}`));

test('Leadership for a period: every client of the period against 100, the headline and the six tiles, from summaries alone', async ({ page }) => {
  const fake = await site(me('bmilder', 'Milder, Brian'), 'Leadership', 'period', { PeriodFrom: '2026-09-01T00:00:00Z', PeriodTo: '2026-11-30T00:00:00Z' });
  await open(page, fake);
  await expect(page.locator('.dash__headline')).toHaveText("2 sessions with 24 guests at 2 clients in FY27 Q2. Confidence matched the all-client average (index 100); Kroger was highest at 110."
    + ' Guests moved 20% up the scale (2.0 to 3.0), and 50% of those who started not confident ended confident.');
  await expect(page.getByRole('heading', { name: 'Leadership dashboard', level: 2 }), 'the dashboard\'s heading has the focus when it opens').toBeFocused();
  await expect(page.getByRole('list', { name: 'Key figures' }).getByRole('listitem')).toHaveCount(6);
  await expect(page.locator('.dash__bar-row', { hasText: 'Kroger' }).first()).toContainText('110');
  const sent = requests(fake);
  expect(sent.some((line) => /PMSParticipantAnswers/.test(line)), 'no answer is read').toBe(false);
  expect(sent.some((line) => /PMSSessionSummary.*Period eq 'FY27-Q2'/.test(line)), 'the summaries by period').toBe(true);
  await axe(page, 'the dashboard');
});

test('Leadership on one client: that client only, and another client\'s data is never asked for; the arrow opens its sessions in place with an Export', async ({ page }) => {
  const fake = await site(me('ablepe', 'Lepe, Annabell'), 'Leadership', 'client', { ClientId: 'c-kroger' });
  await open(page, fake);
  await expect(page.locator('.dash__client')).toHaveCount(1);
  const arrow = page.getByRole('button', { name: /sessions of Kroger/ });
  await expect(arrow).toHaveAttribute('aria-expanded', 'false');
  await arrow.focus();
  await page.keyboard.press('Enter');
  await expect(arrow).toHaveAttribute('aria-expanded', 'true');
  const sessions = page.getByRole('list', { name: 'Sessions of Kroger' });
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await expect(sessions).toContainText('14 Oct 09:30 Morning workshop');
  await expect(sessions.getByRole('button').filter({ hasText: /PDF|report/i }).first()).toBeVisible();
  expect(requests(fake).some((line) => line.includes('c-dominos') || line.includes('dominos-2026')), 'nothing of Domino\'s is asked for').toBe(false);
  await axe(page, 'a client\'s sessions open');
});

test('the i button: focus shows the formula, Escape hides it, and every figure has one', async ({ page }) => {
  await open(page, await site(me('bmilder', 'Milder, Brian'), 'Leadership', 'period', { PeriodFrom: '2026-09-01T00:00:00Z', PeriodTo: '2026-11-30T00:00:00Z' }));
  const info = page.getByRole('button', { name: 'About Confidence index', exact: true });
  await info.focus();
  const tip = page.getByRole('tooltip').filter({ hasText: 'Mean confidence after the session' });
  await expect(tip).toBeVisible();
  await expect(info).toHaveAccessibleDescription(/Mean confidence after the session \/ the same for the baseline x 100/);
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  expect(await page.getByRole('button', { name: /^About / }).count()).toBeGreaterThanOrEqual(10);
});

test('the keyboard: the period chips, Compare with and Hide names, and the headline follows', async ({ page }) => {
  await open(page, await site(me('bmilder', 'Milder, Brian'), 'Leadership', 'period', { PeriodFrom: '2026-09-01T00:00:00Z', PeriodTo: '2026-11-30T00:00:00Z' }));
  await page.getByRole('button', { name: 'Q1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash__headline')).toHaveText('No session in FY27 Q1 has a summary yet.');
  await page.getByRole('button', { name: 'Q2', exact: true }).press('Enter');
  await page.getByLabel('Compare with').selectOption('client');
  await page.getByLabel('Client to compare with').selectOption({ label: "Domino's" });
  await expect(page.locator('.dash__headline')).toContainText("above Domino's");
  await page.getByText('More filters').click();
  await expect(page.locator('.dash__quotes')).toContainText('Asha Rao');
  await page.getByLabel('Hide names').check();
  await expect(page.locator('.dash__quotes')).not.toContainText('Asha Rao');
  await expect(page.locator('.dash__quotes')).toContainText('Guest 1');
  // (Phase 6: Hide names is Results' one switch: the Sessions view shows it on.)
  await page.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(page.getByLabel('Hide names')).toBeChecked();
});

test('a Producer opens Results on Sessions, as before, and the dashboard shows their client only', async ({ page }) => {
  const fake = await site(me('raedla', 'Aedla, Rajeshwar'), 'Producer', 'client', { ClientId: 'c-kroger' });
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  await serveSharePoint(page, fake);
  await page.goto(pageUrl('admin.html'));
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { name: 'Results', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leadership dashboard', level: 2 })).toBeVisible();
  await expect(page.locator('.dash__client')).toHaveCount(1);
  await expect(page.locator('.dash__client')).toContainText('Kroger');
});

test('no summary yet (Prompt 21, Phase 6): the dashboard says no session has ended yet, instead of empty figures', async ({ page }) => {
  const fake = await site(me('ablepe', 'Lepe, Annabell'), 'Leadership', 'client', { ClientId: 'c-kroger' });
  (fake as unknown as { lists: Map<string, unknown[]> }).lists.get('sessionsummary')!.length = 0;
  await open(page, fake);
  await expect(page.getByRole('heading', { name: 'No session has ended yet', level: 3 })).toBeVisible();
  await expect(page.getByText('A session\'s figures appear here once it has ended.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Key figures' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export report' })).toBeDisabled();
  await axe(page, 'no summary yet');
});

test('Prompt 22: each client shows its shift and moved to confident beside its bar, in its row and in each session; the i buttons by keyboard; no sideways scroll', async ({ page }) => {
  const fake = await site(me('bmilder', 'Milder, Brian'), 'Leadership', 'period', { PeriodFrom: '2026-09-01T00:00:00Z', PeriodTo: '2026-11-30T00:00:00Z' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, fake);
  const card = page.getByRole('region', { name: 'Confidence index and shift by client' });
  // Kroger: 12 paired, 2.3 to 3.3 on 5 (+20%); 2 of the 4 who started not confident ended confident (50%, under the minimum of 10: low sample).
  const kroger = card.locator('.dash__bar-row', { hasText: 'Kroger' });
  await expect(kroger).toContainText('110');
  await expect(kroger).toContainText('Shift +20%');
  await expect(kroger).toContainText('50% moved to confident');
  await expect(kroger).toContainText('Low sample (n = 4)');
  await expect(kroger).toContainText('12 of 12 guests answered both');
  const row = page.locator('.dash__client', { hasText: 'Kroger' });
  await expect(row.locator('.dash__client-head')).toContainText('Shift +20%');
  await row.getByRole('button', { name: /sessions of Kroger/ }).press('Enter');
  const session = page.getByRole('list', { name: 'Sessions of Kroger' }).getByRole('listitem');
  await expect(session).toContainText('Session index 100');
  await expect(session).toContainText('Shift +20%');
  await expect(session).toContainText('12 of 12 guests answered both');

  // The i buttons of the shift column: Tab reaches them from the card's own, Enter or Space keeps the words open, Escape hides them.
  await card.getByRole('button', { name: 'About Confidence index by client' }).focus();
  await page.keyboard.press('Tab');
  const shift = card.getByRole('button', { name: 'About Confidence shift' });
  await expect(shift).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(shift).toHaveAttribute('aria-expanded', 'true');
  const shiftTip = card.getByRole('tooltip').filter({ hasText: 'Confidence shift' });
  await expect(shiftTip).toBeVisible();
  await expect(shiftTip).toContainText('not compared with the baseline');
  await page.keyboard.press('Escape');
  await expect(shiftTip).toBeHidden();
  await page.keyboard.press('Tab');
  const moved = card.getByRole('button', { name: 'About Moved to confident' });
  await expect(moved).toBeFocused();
  await page.keyboard.press('Space');
  await expect(card.getByRole('tooltip').filter({ hasText: 'Moved to confident' })).toBeVisible();
  await page.keyboard.press('Escape');
  const ids = await page.locator('[id^="metric-tip-"]').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size, 'no two i buttons share the id of their words').toBe(ids.length);
  await axe(page, 'the shift by client at 1280');
  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `no sideways scroll at ${width}`).toBeLessThanOrEqual(0);
  }
  await axe(page, 'the shift by client at 375');
});
