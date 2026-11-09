import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { encodeAnswer } from '../../migration/src/lib/participant/aop-answer.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { newFake, onSite, pageUrl, serveSharePoint, type Fake } from './sharepoint.js';

// Prompt 39: the admin page on the whole width of a PC or Mac window. The BUILT admin page, signed in as a Super admin (the six tabs and the chip),
// against the mocked SharePoint REST, with the sample clients, eight sessions (so Results has a second page), answers in Kroger's newest session
// and an Art of the Possible question rated by six guests. At 1024, 1280, 1366, 1440, 1536 and 1920 px, on each screen (Today; Clients with a
// client open; Content's activities and its brand; Guests and QR; Results' sessions with one open, and its dashboard; People with a person
// open): the page never scrolls sideways; the bar's six tabs are all in view, none cut, none with an ellipsis, and the bar has no scrollbar; the
// page's left edge is the bar's (within 1 px); the two columns of a split start on one top line (within 2 px); the chart cards of a row are one
// width and one height; the pager is one line; and the "Your access" popover has none of the words Prompt 39 took out. Pictures of each screen at
// 1440 and 1920 px go to test-results/admin/full-width/ to be looked at.

const pictures = fileURLToPath(new URL('../../test-results/admin/full-width/', import.meta.url));
const WIDTHS = [1024, 1280, 1366, 1440, 1536, 1920] as const;
const PICTURED = new Set<number>([1440, 1920]);
const mail = (name: string) => `${name}@deloitte.com`;
const ME = { Id: 7, Title: 'Satyadev, Vedala Venkata', Email: mail('vsatyadev'), LoginName: `i:0#.f|membership|${mail('vsatyadev')}`, IsSiteAdmin: false };
const CRITERIA = [['Strategic value', 'against'], ['Volume / repeatability', 'favours'], ['Standardisation', 'favours'], ['Compliance / risk', 'against'], ['Outsourcing suitability', 'favours']]
  .map(([label, direction], at) => ({ id: `c-a0000${at}`, label, hint: `High: ${label.toLowerCase()}.`, direction }));
const ROWS = [['Corp accounting – GL', 29, 'high'], ['AP / AR', 28, 'high'], ['Other finance', 11, 'split'], ['Treasury', 8, 'low'], ['Tax', 7, 'low'], ['FP&A', 6, 'medium'], ['Payroll', 5, 'high']] as const;
const DATES = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];

/** The site: the sample pack, a Super admin, a second person, eight sessions, answers and Art of the Possible in Kroger's newest. */
async function site(): Promise<Fake> {
  const fake = newFake({ user: ME });
  await onSite(fake, async (ds) => {
    await seedPack(ds, samplePack());
    const optionIds = ROWS.map((_, at) => `o-aop-${at + 1}`);
    for (const [at, [label, people]] of ROWS.entries()) await ds.createOption({ id: optionIds[at], questionId: 'q-aop', ...ds.matrixRowFields({ label, people: String(people) }) });
    await ds.createQuestion({ id: 'q-aop', sectionId: 'sec-aop', type: 'art-of-the-possible', prompt: 'Rate each sub-process on five criteria', optionIds, order: 1, criteria: CRITERIA });
    await ds.createSection({ id: 'sec-aop', title: 'The Art of Possibility', order: 99, enabled: true, industryTags: [], questionIds: ['q-aop'], clientId: 'c-kroger' });
    for (const [at, date] of DATES.entries()) await ds.activateClient(at % 2 ? 'c-dominos' : 'c-kroger', date);
    const { session } = await ds.activateClient('c-kroger', '2026-10-20') as { session: { id: string; sectionIds: string[] } };
    const questions = (await ds.listQuestions() as { id: string; sectionId: string; type: string; optionIds?: string[] }[]).filter((question) => session.sectionIds.includes(question.sectionId));
    const options = await ds.listOptions() as { id: string; questionId: string; correct?: boolean | null }[];
    for (let guest = 0; guest < 6; guest += 1) {
      const trackId = `t-guest-${guest + 1}`;
      const createdAt = `2026-10-20T09:0${guest}:00.000Z`;
      fake.add('tracks', { AppId: trackId, Title: trackId, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'qr', ParticipantName: `Guest ${guest + 1}`, CreatedAt: createdAt, ResumeCount: 0, LastResumedAt: null, RestartedAt: null, RestartSectionId: null, QrTokenId: null, VisitorId: null, SharePointUserId: null });
      const records = [];
      for (const question of questions) {
        const own = options.filter((option) => option.questionId === question.id);
        if (question.type === 'art-of-the-possible') {
          const grid = Object.fromEntries(optionIds.map((id, at) => [id, Object.fromEntries(CRITERIA.map((criterion) => {
            const tilt = ROWS[at][2];
            const towards = tilt === 'split' ? guest % 2 === 0 : tilt === 'high';
            return [criterion.id, tilt === 'medium' ? 2 : criterion.direction === 'favours' ? (towards ? 3 : 1) : (towards ? 1 : 3)];
          }))]));
          const answer = encodeAnswer(grid);
          records.push({ questionId: question.id, answer, firstAnswer: answer, attempts: 1, correct: null, answeredAt: createdAt });
        } else if (['single-select', 'true-false'].includes(question.type) && own.length) {
          const pick = own[guest % own.length].id;
          records.push({ questionId: question.id, answer: pick, firstAnswer: pick, attempts: 1, correct: own.find((option) => option.id === pick)?.correct ?? null, answeredAt: createdAt });
        }
      }
      fake.add('responses', { AppId: trackId, Title: trackId, SessionId: session.id, TrackId: trackId, ClientId: 'c-kroger', ResponsesJson: JSON.stringify(records) });
    }
  });
  fake.add('users', { Title: ME.Email, AppId: ME.Email, FullName: ME.Title, Email: ME.Email, Status: 'Active', Source: 'Typed' });
  fake.add('users', { Title: mail('pulmathur'), AppId: mail('pulmathur'), FullName: 'Mathur, Pulkit', Email: mail('pulmathur'), Status: 'Active', Source: 'Typed' });
  for (const [who, role] of [[ME.Email, 'Super admin'], [mail('pulmathur'), 'Admin']]) {
    fake.add('roleassignments', { Title: `${who}|${role}`, AppId: `${who}|${role}|global|`, UserKey: who, Role: role, ScopeType: 'global', ClientId: '', SessionId: '', Extras: '' });
  }
  return fake;
}

/** What the brief measures on the screen shown, in the window's pixels. */
const measure = (page: Page) => page.evaluate(() => {
  const box = (element: Element | null) => (element && element.getClientRects().length ? element.getBoundingClientRect() : null);
  const nav = document.querySelector('.shell__nav')!;
  const tabs = [...document.querySelectorAll<HTMLElement>('.shell__nav .tab')];
  const navBox = nav.getBoundingClientRect();
  const body = document.querySelector('.shell__body')!;
  const bodyBox = body.getBoundingClientRect();
  const bodyLeft = bodyBox.left + parseFloat(getComputedStyle(body).paddingLeft);
  const bodyRight = bodyBox.right - parseFloat(getComputedStyle(body).paddingRight);
  const brand = box(document.querySelector('.shell__brand'))!;
  const end = box(document.querySelector('.shell__end'))!;
  // The splits: each pair of columns that sit side by side.
  const pairs: [string, string][] = [['.today__main', '.today__side'], ['.clients__list', '.clients__detail'], ['.content-activities', '.content-detail'],
    ['.brand__preview', '.brand__controls'], ['.session-list', '.results-layout__session'], ['.people__list', '.people__detail']];
  const splits = pairs.map(([a, b]) => ({ a, b, one: box(document.querySelector(a)), two: box(document.querySelector(b)) }))
    .filter(({ one, two }) => one && two && one.right <= two.left + 1)
    .map(({ a, b, one, two }) => ({ pair: `${a} | ${b}`, gap: Math.abs(one!.top - two!.top) }));
  // The chart cards, row by row (one top line is one row).
  const rows = new Map<number, { width: number; height: number }[]>();
  for (const cell of document.querySelectorAll('.tally__cell:not(.tally__cell--wide) > .result-card')) {
    const rect = cell.getBoundingClientRect();
    const key = Math.round(rect.top);
    rows.set(key, [...(rows.get(key) ?? []), { width: rect.width, height: rect.height }]);
  }
  const pagers = [...document.querySelectorAll<HTMLElement>('.pager')].filter((pager) => pager.getClientRects().length).map((pager) => {
    const parts = [...pager.children].map((child) => child.getBoundingClientRect());
    return { oneLine: Math.max(...parts.map((part) => part.top)) < Math.min(...parts.map((part) => part.bottom)), line: pager.querySelector('.pager__line')!.getBoundingClientRect().height };
  });
  return {
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navScrolls: nav.scrollWidth - nav.clientWidth + (document.querySelector('.tabs')!.scrollWidth - document.querySelector('.tabs')!.clientWidth),
    tabs: tabs.map((tab) => { const rect = tab.getBoundingClientRect(); return { name: tab.textContent?.trim(), left: rect.left, right: rect.right, cut: tab.scrollWidth > tab.clientWidth + 1, height: rect.height }; }),
    nav: { left: navBox.left, right: navBox.right },
    bar: box(document.querySelector('.shell__bar'))!.height,
    brandLeft: brand.left, endRight: end.right, bodyLeft, bodyRight,
    splits, rows: [...rows.values()], pagers,
  };
});

async function check(page: Page, at: string) {
  await expect(page.locator('#admin-panel [aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const seen = await measure(page);
  expect(seen.sideways, `${at}: no sideways scroll`).toBeLessThanOrEqual(0);
  expect(seen.navScrolls, `${at}: the tab row has no scrollbar`).toBeLessThanOrEqual(0);
  expect(seen.bar, `${at}: the bar is 56 px`).toBe(56);
  expect(seen.tabs.map((tab) => tab.name), `${at}: six tabs`).toEqual(['Today', 'Clients', 'Content', 'Guests and QR', 'Results', 'People']);
  for (const tab of seen.tabs) {
    expect(tab.left, `${at}: ${tab.name} in the bar`).toBeGreaterThanOrEqual(seen.nav.left - 0.5);
    expect(tab.right, `${at}: ${tab.name} in the bar`).toBeLessThanOrEqual(seen.nav.right + 0.5);
    expect(tab.cut, `${at}: ${tab.name} not cut short`).toBe(false);
    expect(tab.height, `${at}: ${tab.name} as tall as the bar`).toBe(seen.tabs[0].height);
  }
  expect(Math.abs(seen.bodyLeft - seen.brandLeft), `${at}: the page's left edge is the bar's`).toBeLessThanOrEqual(1);
  expect(Math.abs(seen.bodyRight - seen.endRight), `${at}: the page's right edge is the bar's`).toBeLessThanOrEqual(1);
  for (const split of seen.splits) expect(split.gap, `${at}: ${split.pair} on one top line`).toBeLessThanOrEqual(2);
  for (const row of seen.rows) {
    expect(Math.max(...row.map((card) => card.width)) - Math.min(...row.map((card) => card.width)), `${at}: the cards of a row one width`).toBeLessThanOrEqual(1);
    expect(Math.max(...row.map((card) => card.height)) - Math.min(...row.map((card) => card.height)), `${at}: the cards of a row one height`).toBeLessThanOrEqual(1);
  }
  for (const pager of seen.pagers) {
    expect(pager.oneLine, `${at}: Previous, the page and Next on one line`).toBe(true);
    expect(pager.line, `${at}: "Page 1 of 2" on one line`).toBeLessThan(32);
  }
  return seen;
}

const tab = async (page: Page, name: string) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
};
const shoot = async (page: Page, width: number, name: string) => {
  if (PICTURED.has(width)) await page.screenshot({ path: `${pictures}${name}-${width}.png`, fullPage: true });
};

test.describe('the admin page on the whole width', () => {
  test.describe.configure({ timeout: 300_000 });
  for (const width of WIDTHS) {
    test(`at ${width} px: every screen`, async ({ page }) => {
      await mkdir(pictures, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await serveSharePoint(page, await site());
      await page.goto(pageUrl('admin.html'));
      await expect(page.getByTestId('identity-chip')).toBeVisible();
      const welcome = page.getByTestId('welcome-strip');
      if (await welcome.count()) await welcome.getByRole('button', { name: 'Got it' }).click();

      // The bar: "PMS Admin", no pill; the chip says the role alone below 1,280 px, and its reach from there; the spoken names are as before.
      await expect(page.getByTestId('shell-title')).toContainText('PMS Admin');
      await expect(page).toHaveTitle('Pursuit Managed Services Admin');
      await expect(page.locator('.shell__title > [aria-hidden="true"]'), 'the words seen').toHaveText('PMS Admin');
      await expect(page.locator('.shell__title > .sr-only'), 'the words heard').toHaveText('Pursuit Managed Services Admin');
      await expect(page.getByTestId('copy-label')).toHaveCount(0);
      await expect(page.getByTestId('tabs-menu')).toBeHidden();
      if (width < 1280) await expect(page.locator('.who__reach')).toBeHidden(); else await expect(page.locator('.who__reach')).toBeVisible();
      await page.getByTestId('identity-chip').click();
      const popover = page.getByTestId('access-popover');
      await expect(popover).toBeVisible();
      for (const gone of ['Signed in with your Deloitte account', 'Not available to you', 'Nothing hidden']) await expect(popover, `${width}: "${gone}"`).not.toContainText(gone);
      await page.keyboard.press('Escape');

      await check(page, `Today at ${width}`);
      await shoot(page, width, 'today');

      await tab(page, 'Clients');
      await page.getByRole('button', { name: 'Sessions and team: Kroger' }).click();
      await expect(page.locator('.clients__detail')).toBeVisible();
      await check(page, `Clients, a client open, at ${width}`);
      await shoot(page, width, 'clients-open');

      await tab(page, 'Content');
      await expect(page.locator('.content-activities')).toBeVisible();
      const strip = await page.locator('.content-strip__tab').evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().width));
      expect(Math.abs(strip[0] - strip[1]), `Content at ${width}: Activities and Brand one width`).toBeLessThanOrEqual(1);
      await check(page, `Content, activities, at ${width}`);
      await shoot(page, width, 'content-activities');
      await page.locator('.content-strip__tab[data-view="brand"]').click();
      await expect(page.locator('.brand__preview')).toBeVisible();
      await check(page, `Content, brand, at ${width}`);
      await shoot(page, width, 'content-brand');

      await tab(page, 'Guests and QR');
      const steps = await page.locator('.steps > .step').evaluateAll((parts) => parts.map((part) => { const rect = part.getBoundingClientRect(); return { width: rect.width, height: rect.height, top: rect.top }; }));
      if (width >= 1100) {
        expect(Math.max(...steps.map((step) => step.width)) - Math.min(...steps.map((step) => step.width)), `Guests at ${width}: the steps one width`).toBeLessThanOrEqual(1);
        expect(Math.max(...steps.map((step) => step.height)) - Math.min(...steps.map((step) => step.height)), `Guests at ${width}: the steps one height`).toBeLessThanOrEqual(1);
      }
      await check(page, `Guests and QR at ${width}`);
      await shoot(page, width, 'guests');

      await tab(page, 'Results');
      await expect(page.locator('article.card[data-session]')).toBeVisible();
      await expect(page.locator('.tally__grid').first()).toBeVisible();
      await expect(page.locator('.pager')).toBeVisible();
      // The view switch, Hide names, Refresh and the time in the title row; Art of the Possibility the whole row, its names across.
      const head = await page.locator('.results-head').evaluate((element) => {
        const title = element.querySelector('h2')!.getBoundingClientRect();
        const views = element.querySelector('.results-views')!.getBoundingClientRect();
        return { title: title.top, views: views.top, viewsBottom: views.bottom, titleBottom: title.bottom };
      });
      expect(head.views, `Results at ${width}: the view switch in the title row`).toBeLessThan(head.titleBottom);
      const aop = await page.locator('.tally__cell--wide').evaluate((cell) => ({ cell: cell.getBoundingClientRect().width, grid: cell.parentElement!.getBoundingClientRect().width,
        heads: [...cell.querySelectorAll('.aop__grid thead th')].map((th) => getComputedStyle(th).writingMode), first: cell.querySelector('.aop__grid tbody th')!.getBoundingClientRect().width,
        criteria: [...cell.querySelectorAll('.aop__grid thead th.aop__crit')].map((th) => th.textContent?.trim()) }));
      expect(Math.abs(aop.cell - aop.grid), `Results at ${width}: Art of the Possibility spans the row`).toBeLessThanOrEqual(1);
      expect(aop.heads.every((mode) => mode === 'horizontal-tb'), `Results at ${width}: column names across`).toBe(true);
      expect(aop.first, `Results at ${width}: the sub-process column`).toBeGreaterThanOrEqual(279);
      expect(aop.criteria.map((words) => words?.replace(/\s*\(.*\)$/, ''))).toEqual(CRITERIA.map((criterion) => criterion.label));
      await expect(page.locator('.tally__cell--wide .aop__grid tbody th').first()).toContainText(ROWS[0][0]);
      await check(page, `Results, a session open, at ${width}`);
      await shoot(page, width, 'results-session');
      await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
      await expect(page.locator('.dash')).toBeVisible();
      await check(page, `Results, the dashboard, at ${width}`);
      await shoot(page, width, 'results-dashboard');

      await tab(page, 'People');
      await page.getByRole('button', { name: /^Open .*Pulkit/ }).click();
      await expect(page.locator('.people__detail')).toBeVisible();
      await check(page, `People, a person open, at ${width}`);
      await shoot(page, width, 'people-open');
    });
  }

  test('below 1,024 px the tabs are one Menu, never a scrollbar; Esc closes it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await serveSharePoint(page, await site());
    await page.goto(pageUrl('admin.html'));
    await expect(page.getByTestId('identity-chip')).toBeVisible();
    const menu = page.getByTestId('tabs-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Clients' })).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('tab', { name: 'People' }).click();
    await expect(page.locator('#admin-tab-users'), 'People chosen; the menu shut').toHaveAttribute('aria-selected', 'true');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
