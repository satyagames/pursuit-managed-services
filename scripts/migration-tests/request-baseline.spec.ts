import { test, expect, type Browser, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { baselineFile, differences, linesOf, readBaseline, tally, writeBaseline } from '../request-baseline.js';
import { newFake, onSite, pageUrl, seedAndGoLive, serveSharePoint, type Fake } from './sharepoint.js';

// Phase 10b, the request baseline in a real browser: what the BUILT participant page asks the mocked SharePoint REST on its way to its
// first screen, compared with what it asked before the list namespace and the settings file existed
// (scripts/request-baseline/browser-participant-start.<engine>.txt, recorded at the commit named in scripts/request-baseline.js and
// never regenerated to make this pass). Four starts: a first staff visit, a first QR scan (the session's first device, then a later
// one) and a reload inside an activity. Requests for the page itself and for its settings file are not REST requests and are not here.
//
// Each engine has its own file because Playwright's WebKit drops the boundary of a fulfilled `$batch` reply, so the page there finds
// grouped reads unusable and sends plain ones: a different, and equally real, set of addresses.
//
// To record a baseline that does not exist yet: PMS_WRITE_BASELINE=1 npx playwright test --config migration/playwright.config.ts request-baseline

const choices = (page: Page) => page.locator('.pms-options button');

/**
 * Waits until the page has sent what it reads and fetches ahead once its first screen is up (Phase 10j): the questions and options of every
 * enabled activity (part D: lib/participant/activity-content.js; a QR scan reads them beside its claim), and once its visit is logged what its next writes
 * will ask for (part C: lib/participant/boot.js writesAhead): the answers list's item type always here, and, where a visit can begin from Welcome, the
 * participants list's type and columns and, for a session not started yet, the sessions list's. So a recording does not depend on how soon the
 * page is closed.
 */
async function fetchedAhead(fake: Fake, { canBegin }: { canBegin: boolean }) {
  const type = (list: string) => fake.count((entry) => entry.list === list && entry.method === 'GET' && /ListItemEntityTypeFullName/.test(entry.url) && !entry.batched);
  const columns = (list: string) => fake.count((entry) => entry.list === list && entry.method === 'GET' && /\/fields\?/.test(entry.url));
  await expect.poll(() => [fake.count({ method: 'GET', list: 'questions' }), fake.count({ method: 'GET', list: 'options' })]).toEqual([1, 1]);
  await expect.poll(() => type('responses')).toBe(1);
  if (canBegin) for (const list of ['tracks', 'sessions']) await expect.poll(() => [type(list), columns(list)]).toEqual([1, 1]);
}

const visitorCode = (fake: Fake, sessionId: string, name: string) => onSite(fake, async (ds) => {
  await ds.setSessionParticipationMode(sessionId, 'client-visit');
  const visitor = await ds.createVisitor({ sessionId, displayName: name, enabled: true });
  return (await ds.provisionQrToken('c-kroger', sessionId, { visitorId: visitor.id })).id as string;
});

/** The four starts, one after another, each on a site of its own. Resolves to every REST request the pages sent, as recorder lines. */
async function fourStarts(browser: Browser): Promise<string> {
  const lines: string[] = [];
  const take = (fake: Fake) => { lines.push(...fake.requests.map(linesOf)); fake.reset(); };
  const open = async (fake: Fake) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const served = await serveSharePoint(page, fake);
    return { context, page, served };
  };
  /** Stops the page (so its timer sends nothing more) and takes what it sent. */
  const finish = async (fake: Fake, visit: Awaited<ReturnType<typeof open>>) => {
    await visit.context.close();
    expect(visit.served.unexpected, 'the page asked for nothing outside its site').toEqual([]);
    take(fake);
  };

  // 1. A first staff visit: Welcome, then the visit log.
  {
    const fake = newFake();
    await seedAndGoLive(fake, 'c-kroger');
    const visit = await open(fake);
    fake.reset();
    await visit.page.goto(pageUrl('index.html'));
    await expect(visit.page.getByRole('heading', { name: 'Hi Casey Example!' })).toBeVisible();
    await expect(visit.page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
    await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);
    await fetchedAhead(fake, { canBegin: true });
    await finish(fake, visit);
  }

  // 2 and 3. A first QR scan: the device that starts the session, then one after it.
  {
    const fake = newFake();
    const session = await seedAndGoLive(fake, 'c-kroger');
    const opening = await visitorCode(fake, session.id, 'Avery Stone');
    const code = await visitorCode(fake, session.id, 'Jordan Lee');
    for (const [token, name] of [[opening, 'Avery Stone'], [code, 'Jordan Lee']]) {
      const visit = await open(fake);
      fake.reset();
      await visit.page.goto(`${pageUrl('index.html')}?qr=${token}`);
      await expect(visit.page.getByRole('heading', { name: `Hi ${name}!` })).toBeVisible();
      await expect(visit.page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
      await expect.poll(() => fake.count({ method: 'POST', list: 'uservisitlogs' })).toBe(1);
      await fetchedAhead(fake, { canBegin: false });
      await finish(fake, visit);
    }
  }

  // 4. A reload inside an activity: the visit, its answers and the resume stamp.
  {
    const fake = newFake();
    const session = await seedAndGoLive(fake, 'c-kroger');
    const code = await visitorCode(fake, session.id, 'Jordan Lee');
    const visit = await open(fake);
    await visit.page.goto(`${pageUrl('index.html')}?qr=${code}`);
    await visit.page.getByRole('button', { name: 'Click here to begin' }).click();
    await visit.page.getByRole('button', { name: "Kroger's History" }).click();
    await choices(visit.page).nth(1).click();
    await expect(choices(visit.page).nth(1)).toHaveAttribute('data-state', 'correct');
    await expect.poll(() => fake.count({ method: 'POST', list: 'responses' })).toBe(1);
    await visit.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(visit.page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
    fake.reset();
    await visit.page.reload();
    await expect(visit.page.getByRole('progressbar', { name: 'Question 2 of 5' })).toBeVisible();
    await expect(choices(visit.page).first()).toBeVisible();
    await expect.poll(() => fake.count({ method: 'MERGE', list: 'tracks' })).toBe(1);
    await finish(fake, visit);
  }
  return `${lines.join('\n')}\n`;
}

test('the participant page starts with the requests it sent before Phase 10b: first visit, first QR scans, reload', async ({ browser }, testInfo) => {
  const name = `browser-participant-start.${testInfo.project.name}`;
  if (process.env.PMS_WRITE_BASELINE) {
    test.setTimeout(180_000);
    expect(existsSync(baselineFile(name)), `${name}.txt exists and is never written over`).toBe(false);
    const recordings = [];
    for (let run = 0; run < 4; run += 1) recordings.push(tally(await fourStarts(browser)));
    await writeBaseline(name, `the built participant page's start-up (first staff visit, two first QR scans, a reload in an activity) in ${testInfo.project.name}, on the mocked SharePoint REST (4 recordings)`, recordings);
    return;
  }
  test.setTimeout(90_000);
  const found = differences(await readBaseline(name), tally(await fourStarts(browser)));
  expect(found, `${found.length} difference(s) from scripts/request-baseline/${name}.txt:\n\n${found.join('\n\n')}\n`).toEqual([]);
});
