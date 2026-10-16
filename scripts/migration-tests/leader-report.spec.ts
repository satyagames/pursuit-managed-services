import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ds, openAdmin, startLocal, stopLocal, type Local } from './admin-local.js';
import { makeImage } from './brand-images.js';
import { BIG, HARBOUR_MOVED, HARBOUR_PEOPLE, bigComment, bigContent, bigName, bigPeople, harbourContent, seedSession } from '../leader-report-fixtures.js';
import { inspectPdf, squash } from '../pdf-inspect.js';
import { renderPdfPages } from '../render-pdf-pages.js';

// Phase 7b in a real browser: Admin -> Results -> "Leader report (PDF)" and "Participant answers (CSV)", against the REAL local server on
// a scratch copy of server/data, in Chromium and in WebKit (the engine of every iPad browser). The files are what the browser
// downloaded; the PDF is read back with pdf.js in this process. The numbers themselves are held by scripts/test-leader-report.js.
// Pictures of the pages, for a person to look at, are written to test-results/report/.

const out = fileURLToPath(new URL('../../test-results/report/', import.meta.url));
let local: Local;
test.beforeEach(async () => { local = await startLocal(); await mkdir(out, { recursive: true }); });
test.afterEach(async () => { await stopLocal(local); });

const harbour = (look = {}) => ({ content: harbourContent(look), people: HARBOUR_PEOPLE, extra: { questions: [HARBOUR_MOVED.question], options: HARBOUR_MOVED.options } });
const card = (page: Page, sessionId: string) => page.locator(`[data-session="${sessionId}"]`);
const line = (page: Page, sessionId: string) => card(page, sessionId).locator('.report-exports__status');

async function download(page: Page, sessionId: string, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), card(page, sessionId).getByRole('button', { name: button }).click()]);
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

/** Appends a measurement to test-results/report/browser.json (one file for the run, both engines). */
async function note(entry: Record<string, unknown>) {
  const file = path.join(out, 'browser.json');
  const held = JSON.parse(await readFile(file, 'utf8').catch(() => '[]')) as Record<string, unknown>[];
  await writeFile(file, `${JSON.stringify([...held.filter((each) => !(each.what === entry.what && each.browser === entry.browser)), entry], null, 2)}\n`);
}

test('both buttons download: the leader report as a PDF with embedded fonts and accented names, and the participant CSV', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const { session } = await seedSession(ds, harbour());
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdmin(page, local, 'Results');
  await expect(card(page, session.id)).toBeVisible();
  // The exports that were there before are untouched: the Live display button is still on the card, beside the new ones.
  await expect(card(page, session.id).getByRole('button', { name: 'Live display' })).toBeVisible();

  const pdf = await download(page, session.id, 'Leader report (PDF)');
  expect(pdf.name).toMatch(/^leader-report-harbour-2026-10-11-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const read = await inspectPdf(pdf.bytes);
  await expect(line(page, session.id)).toHaveText(`Saved ${pdf.name} (${read.pages.length} pages)`);
  expect(read.fonts.map((font) => font.name).sort()).toEqual(['OpenSans-Bold', 'OpenSans-Regular']);
  expect(read.fonts.every((font) => font.embedded)).toBe(true);
  expect(pdf.bytes.toString('latin1')).not.toMatch(/Helvetica|Times-Roman|Courier/);
  const text = squash(read.pages.map((sheet) => sheet.text).join(' '));
  for (const phrase of [
    'LEADER REPORT', 'Harbour & Søn', 'Harbour Discovery Day', 'About this report', 'How the numbers are counted',
    'José Álvarez', 'Zoë Brontë', 'Søren Kjær', 'Łukasz Żółć', 'José Álvarez (2)', 'Unnamed participant 1', 'Unnamed participant 2', 'Ada Łęcka',
    'Right first time: 3 of 6 (50%)', 'Most common wrong first answer: 1901 (2 of 6)', 'The top choice (50%) was 1887.', '3 of 6 got it right first time.', 'Correct', 'Average: 2.5 on a scale of 1 to 3',
    'Søren says: more time for questions, please. And coffee.', '=SUM(A1:A9) "quoted", with a comma', 'Great day — thank you!',
    'No answers recorded.', 'Restarted by the facilitator at', 'Questions no longer in the activity', 'It was fine',
  ]) expect(text, phrase).toContain(squash(phrase));
  // The answer first: the summary is on the cover, and the counting rules are the last page.
  expect(read.pages[0].text).toContain('Participants joined');
  expect(read.pages[0].text).not.toContain('About this report');
  expect(read.pages.at(-1)!.text).toContain('How the numbers are counted');
  expect(read.pages.at(-1)!.text).toContain('About this report');
  read.pages.forEach((sheet, index) => {
    expect(sheet.text, `page ${index + 1}`).toContain('Confidential – internal');
    expect(sheet.text, `page ${index + 1}`).toContain(`Page ${index + 1} of ${read.pages.length}`);
    expect(Math.round(sheet.width), 'A4').toBe(210);
  });
  expect(read.info.Title).toBe('Harbour & Søn leader report');
  // The wordmark is drawn (filled paths) on the cover, in the browser's own build of the page.
  expect(pdf.bytes.length).toBeGreaterThan(20_000);
  await writeFile(path.join(out, `download-${browserName}.pdf`), pdf.bytes);

  const csv = await download(page, session.id, 'Participant answers (CSV)');
  expect(csv.name).toMatch(/^participant-answers-harbour-2026-10-11-\d{4}-\d{2}-\d{2}\.csv$/);
  expect([...csv.bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]); // the byte-order mark, so a spreadsheet reads the accents
  const rows = csv.bytes.toString('utf8').slice(1);
  expect(rows.split('\r\n')[0]).toBe('Client,Date,Participant,Activity,Question,First answer,Final answer,Correct,Correct on first try,Attempts,Answered at');
  for (const phrase of ['Harbour & Søn,2026-10-11,José Álvarez,Harbour History,Which year did the harbour open?,1887,1887,Yes,Yes,1,', 'Łukasz Żółć', 'Zoë Brontë', '"\'=SUM(A1:A9) ""quoted"", with a comma"', '"Søren says: more time for questions, please.\nAnd coffee."', 'José Álvarez (2),Harbour History,Which year did the harbour open?,,,,,0,', 'Unnamed participant 2,(Questions no longer in the activity)']) {
    expect(rows, phrase).toContain(phrase);
  }
  await expect(line(page, session.id)).toHaveText(`Saved ${csv.name} (7 participants)`);
  await writeFile(path.join(out, `download-${browserName}.csv`), csv.bytes);
  await expect(card(page, session.id).locator('[role="alert"]')).toHaveCount(0);
});

test('sixty people and fifteen questions: the report is ready in under ten seconds, with every name and comment', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  const { session } = await seedSession(ds, { content: bigContent(), people: bigPeople() });
  await openAdmin(page, local, 'Results');
  await expect(card(page, session.id)).toBeVisible();
  const started = Date.now();
  const pdf = await download(page, session.id, 'Leader report (PDF)');
  const wall = Date.now() - started;
  await expect(line(page, session.id)).toContainText('Saved leader-report-');
  const inPage = Number(await line(page, session.id).getAttribute('data-ms'));
  const read = await inspectPdf(pdf.bytes);
  await note({ what: 'leader report, 60 people x 15 questions, click to file (local server)', browser: browserName, msInPage: inPage, msFromClickToDownload: wall, pages: read.pages.length, bytes: pdf.bytes.length });
  expect(inPage, `${inPage} ms in the page`).toBeLessThan(10_000);
  expect(wall, `${wall} ms from the click to the file`).toBeLessThan(10_000);
  const text = squash(read.pages.map((sheet) => sheet.text).join(' '));
  for (let i = 0; i < BIG.people; i += 1) expect(text, bigName(i)).toContain(squash(bigName(i)));
  for (let i = 0; i < 55; i += 1) expect(text, bigComment(i)).toContain(squash(bigComment(i)));
  expect(read.pages.at(-1)!.text).toContain(`Page ${read.pages.length} of ${read.pages.length}`);

  const csvStarted = Date.now();
  const csv = await download(page, session.id, 'Participant answers (CSV)');
  await note({ what: 'participant CSV, 60 people x 15 questions, click to file (local server)', browser: browserName, msFromClickToDownload: Date.now() - csvStarted, rows: csv.bytes.toString('utf8').split('\r\n').length - 2 });
  expect(csv.bytes.toString('utf8').split('\r\n').length - 2).toBe(60 * 15);
});

test('the progress line counts the pages, and Cancel stops the report and saves nothing', async ({ page }) => {
  test.setTimeout(180_000);
  const { session } = await seedSession(ds, { content: bigContent(), people: bigPeople() });
  await openAdmin(page, local, 'Results');
  await expect(card(page, session.id)).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });

  // With the page's clock held still, the report stops after each page it draws (it lets the browser breathe with a timer), so the
  // line can be read page by page.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  await card(page, session.id).getByRole('button', { name: 'Leader report (PDF)' }).click();
  await expect(line(page, session.id)).toHaveText(/^Preparing page 1 of \d+$/);
  const total = Number((await line(page, session.id).textContent())!.match(/of (\d+)$/)![1]);
  expect(total).toBeGreaterThan(20);
  await expect(line(page, session.id)).toHaveAttribute('role', 'status');
  await expect(card(page, session.id).getByRole('button', { name: 'Preparing...' })).toBeDisabled();
  await expect(card(page, session.id).getByRole('button', { name: 'Participant answers (CSV)' })).toBeDisabled();
  // Each tick of the clock lets it draw a little more; held still, it waits where it is.
  const drawing = async () => Number((await line(page, session.id).textContent())?.match(/^Preparing page (\d+) of/)?.[1] ?? 0);
  await page.clock.runFor(1);
  await expect.poll(drawing).toBeGreaterThan(1);
  const reached = await drawing();
  expect(reached).toBeLessThan(total);
  await page.waitForTimeout(300);
  expect(await drawing(), 'it waits while the clock is held').toBe(reached);
  await page.clock.runFor(1);
  await expect.poll(drawing).toBeGreaterThan(reached);
  expect(await drawing()).toBeLessThan(total);

  await card(page, session.id).getByRole('button', { name: 'Cancel' }).click();
  await page.clock.runFor(1);
  await expect(line(page, session.id)).toHaveText('Cancelled. Nothing was saved.');
  await expect(card(page, session.id).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(card(page, session.id).getByRole('button', { name: 'Leader report (PDF)' })).toBeEnabled();
  await page.clock.runFor(2000);
  expect(downloads).toBe(0);

  // Asked again, with time running: the whole report.
  await page.clock.resume();
  const pdf = await download(page, session.id, 'Leader report (PDF)');
  await expect(line(page, session.id)).toHaveText(`Saved ${pdf.name} (${total} pages)`);
  expect((await inspectPdf(pdf.bytes)).pages.length).toBe(total);
  expect(downloads).toBe(1);
});

test('a session that has gone says so, and the buttons work again', async ({ page }) => {
  const { session } = await seedSession(ds, harbour());
  await openAdmin(page, local, 'Results');
  await expect(card(page, session.id)).toBeVisible();
  await ds.deleteSession(session.id);
  await card(page, session.id).getByRole('button', { name: 'Leader report (PDF)' }).click();
  await expect(card(page, session.id).locator('[role="alert"]')).toHaveText('The report could not be made: That session no longer exists.');
  await expect(card(page, session.id).getByRole('button', { name: 'Leader report (PDF)' })).toBeEnabled();
});

test('the buttons fit a phone, an iPad and a laptop, with targets of 44px and no sideways scroll', async ({ page }) => {
  const { session } = await seedSession(ds, harbour());
  await openAdmin(page, local, 'Results');
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(card(page, session.id).getByRole('button', { name: 'Leader report (PDF)' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${viewport.width}: no sideways scroll`).toBe(true);
    for (const name of ['Leader report (PDF)', 'Participant answers (CSV)']) {
      const box = (await card(page, session.id).getByRole('button', { name }).boundingBox())!;
      expect(box.height, `${name} at ${viewport.width}`).toBeGreaterThanOrEqual(43.5);
      expect(box.width, `${name} at ${viewport.width}`).toBeGreaterThanOrEqual(43.5);
    }
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await card(page, session.id).evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(out, `results-buttons-${width}.png`) });
  }
});

// ---- Pictures of the pages, for a person to look at ------------------------------------------------------------------------------

const LOOKS = [
  // A light client colour (it has to be darkened to show on white paper), a coloured logo on the light plate.
  { name: 'light', look: { name: 'Solskin & Søn', primary: '#F2C200', plate: 'light' as const }, paint: 'logo' as const },
  // A dark client colour, and a white logo that keeps its dark plate.
  { name: 'dark', look: { name: 'Nordlys Søfart', primary: '#0B1F3A', plate: 'dark' as const }, paint: 'white-logo' as const },
];

for (const { name, look, paint } of LOOKS) {
  test(`pictures: the cover, a results page, a comments page, a participant page and the last page, for a ${name} client theme`, async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'the pictures are drawn once, by pdf.js in Chromium');
    test.setTimeout(120_000);
    // The logo goes where Brand Studio puts one: the scratch server's upload folder, under a content-hashed name.
    await page.goto('about:blank');
    const picture = await makeImage(page, { width: 800, height: 400, type: 'image/png', paint });
    const { url } = await ds.uploadClientAsset(new Blob([new Uint8Array(picture)], { type: 'image/png' }), `harbour-logo-${name === 'light' ? '0a1b2c3d4e' : '9f8e7d6c5b'}.png`);
    const { session } = await seedSession(ds, harbour({ ...look, logo: url }));
    await openAdmin(page, local, 'Results');
    const pdf = await download(page, session.id, 'Leader report (PDF)');
    await writeFile(path.join(out, `${name}.pdf`), pdf.bytes);
    expect(pdf.bytes.toString('latin1'), 'the logo is in the file').toContain('/Subtype /Image');

    const read = await inspectPdf(pdf.bytes);
    const startOf = (title: string) => read.pages.findIndex((sheet) => sheet.items.some((item) => item.text === title && Math.abs(item.size - 16) < 0.1)) + 1;
    const wanted = { cover: 1, results: startOf('Results by activity'), comments: startOf('What participants said'), participants: startOf('Participants'), 'no-longer-in-activity': startOf('Questions no longer in the activity'), last: startOf('How the numbers are counted') };
    expect(wanted.last, 'How the numbers are counted is the last page').toBe(read.pages.length);
    for (const [what, number] of Object.entries(wanted)) expect(number, what).toBeGreaterThan(0);
    const pictures = await renderPdfPages(pdf.bytes, { scale: 1.6, pages: Object.values(wanted), browser });
    for (const [what, number] of Object.entries(wanted)) {
      const made = pictures.find((each) => each.page === number)!;
      await writeFile(path.join(out, `${name}-${what}.png`), made.png);
      expect(made.png.length, `${name} ${what} is a real picture`).toBeGreaterThan(15_000);
    }
  });
}

test('pictures: sixty people and fifteen questions (the cover, a results page, a participants page and the last page)', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'the pictures are drawn once, by pdf.js in Chromium');
  test.setTimeout(180_000);
  const { session } = await seedSession(ds, { content: bigContent(), people: bigPeople() });
  await openAdmin(page, local, 'Results');
  const pdf = await download(page, session.id, 'Leader report (PDF)');
  await writeFile(path.join(out, 'sixty.pdf'), pdf.bytes);
  const read = await inspectPdf(pdf.bytes);
  const startOf = (title: string) => read.pages.findIndex((sheet) => sheet.items.some((item) => item.text === title && Math.abs(item.size - 16) < 0.1)) + 1;
  const wanted = { cover: 1, results: startOf('Results by activity'), comments: startOf('What participants said'), participants: startOf('Participants') + 1, last: startOf('How the numbers are counted') };
  expect(wanted.last, 'How the numbers are counted is the last page').toBe(read.pages.length);
  const pictures = await renderPdfPages(pdf.bytes, { scale: 1.6, pages: Object.values(wanted), browser });
  for (const [what, number] of Object.entries(wanted)) await writeFile(path.join(out, `sixty-${what}.png`), pictures.find((each) => each.page === number)!.png);
});

// ---- Phase 8: page 1 says whether the session had ended -----------------------------------------------------------------------------------
// A leader who reads only the cover of a report made during the event must learn that answers may still be arriving. The words are asserted in
// the file the browser downloaded (all three engines); the picture of the cover is drawn once, by pdf.js in Chromium.

const ENDED_ON_COVER = 'This session had ended when the report was made.';
const NOT_ENDED_ON_COVER = 'This session had not ended when the report was made, so answers may still arrive.';

for (const { name, end, cover, last } of [
  { name: 'not-ended', end: false, cover: NOT_ENDED_ON_COVER, last: /Notendedwhenthisreportwasmade,soanswersmaystillarrive/ },
  { name: 'ended', end: true, cover: ENDED_ON_COVER, last: /Ended[A-Za-z]+\d{1,2},\d{4}at\d{1,2}:\d{2}[AP]M/ },
]) {
  test(`the cover of a report on a session that ${end ? 'had ended' : 'had not ended'} says so in one line, and the last page keeps the full line`, async ({ page, browser, browserName }) => {
    test.setTimeout(90_000);
    const { session } = await seedSession(ds, { ...harbour({ name: 'Solskin & Søn', primary: '#F2C200' }), end });
    await openAdmin(page, local, 'Results');
    const pdf = await download(page, session.id, 'Leader report (PDF)');
    await writeFile(path.join(out, `${name}.pdf`), pdf.bytes);
    const read = await inspectPdf(pdf.bytes);
    const first = squash(read.pages[0].text);
    expect(first, 'page 1 says it').toContain(squash(cover));
    expect(first, 'and not the other thing').not.toContain(squash(end ? NOT_ENDED_ON_COVER : ENDED_ON_COVER));
    expect(first, 'the full "Session:" line is not on the cover').not.toContain('Session:');
    // (squash removes the spaces, so the patterns have none)
    expect(squash(read.pages.at(-1).text), 'the full line is still on the last page').toMatch(last);
    if (browserName !== 'chromium') return;
    const [picture] = await renderPdfPages(pdf.bytes, { scale: 1.6, pages: [1], browser });
    await writeFile(path.join(out, `${name}-cover.png`), picture.png);
    expect(picture.png.length, `${name} cover is a real picture`).toBeGreaterThan(15_000);
  });
}
