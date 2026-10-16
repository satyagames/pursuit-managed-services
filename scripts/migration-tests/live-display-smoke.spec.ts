import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { addActivity, ds, openAdmin, startLocal, stopLocal, today, useServer, adminUrl, PIN, type Local } from './admin-local.js';

// A smoke test of the Live display on Chromium AND WebKit (the engine of every iPad browser): the display itself, its charts, Full screen, and the
// three exports, which run jsPDF and PptxGenJS (with the HTML and SVG paths of jsPDF left out of the admin build) in the engine that matters.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

test('smoke: the Live display shows the tally, goes full screen and leaves it, and exports CSV, PDF and PowerPoint', async ({ page }) => {
  test.setTimeout(90_000);
  const { session } = await ds.activateClient('c-kroger', today);
  const extra = await addActivity('c-kroger', { title: 'Kinds', questions: [
    { prompt: 'Rank these', type: 'ranked-voting', options: [['A', null], ['B', null], ['C', null]] },
    { prompt: 'Say something', type: 'open-text-feedback', options: [] },
  ] });
  await ds.addSectionsToLiveSession('c-kroger', [extra]);
  const track = await ds.beginVisit(crypto.randomUUID(), session.id, 'c-kroger');
  await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: 'c-kroger', responses: [
    { questionId: 'q-trivia-1', answer: 'o-trivia-1-b', firstAnswer: 'o-trivia-1-b', attempts: 1, correct: true, answeredAt: new Date().toISOString() },
    { questionId: `${extra}-q0`, answer: [`${extra}-q0-o1`, `${extra}-q0-o0`, `${extra}-q0-o2`], firstAnswer: 'x', attempts: 1, correct: null, answeredAt: new Date().toISOString() },
    { questionId: `${extra}-q1`, answer: 'Lovely day', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: new Date().toISOString() },
  ] });
  await page.setViewportSize({ width: 1280, height: 720 }); // (before full screen: Chromium will not resize a window that is in the browser's own full screen)
  await openAdmin(page, local);
  await page.getByRole('button', { name: 'Live display' }).click();
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
  await expect(page.locator('.live__meta')).toContainText('3 answers from 1 iPad ');
  await expect(page.locator('.result-card .bars').first()).toBeVisible();
  await expect(page.locator('.words__text')).toContainText(['Lovely day']);

  // Full screen: the display covers the window and leaves again (the browser's own full screen is taken where it is offered, and not needed).
  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'true');
  expect(await page.locator('section.live').evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  // One question at a time, and the whole card is on the screen (Phase 7c): the arrow keys move, and the card stays inside the window in this engine too.
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.live__eyebrow')).toContainText(/Question 1 of \d+/);
  await page.waitForTimeout(900); // the chart's own animation
  const whole = () => page.locator('.result-card').evaluate((card) => { const box = card.getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth + 0.5 && box.bottom <= window.innerHeight + 0.5 && card.scrollHeight <= card.clientHeight + 1; });
  expect(await whole(), 'the first question fits').toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.live__eyebrow')).toContainText(/Question 2 of \d+/);
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.getByRole('button', { name: 'Next question' }).click();
  await page.waitForTimeout(900);
  expect(await whole(), 'and the written answers do too').toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('section.live')).toHaveAttribute('data-presenting', 'false');

  // The three exports.
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await readFile((await (await csv).path())!, 'utf8'))).toContain('Lovely day');
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF' }).click();
  const pdfBytes = await readFile((await (await pdf).path())!);
  expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdfBytes.toString('latin1')).toContain('Kroger');
  const ppt = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PPT' }).click();
  const archive = await JSZip.loadAsync(await readFile((await (await ppt).path())!));
  expect(await archive.file('ppt/slides/slide1.xml')!.async('string')).toContain('Kroger');
  await expect(page.locator('.live__status[role="alert"]')).toHaveCount(0);
});

test('smoke: the old participant address is a notice with a link to the admin page in the same folder, and the link works', async ({ page }) => {
  const { session } = await ds.activateClient('c-kroger', today);
  await useServer(page, local);
  await page.goto(`${adminUrl.replace('admin.html', 'index.html')}#/master-results/${session.id}`);
  await expect(page.getByRole('heading', { name: 'Results have moved to the admin page' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the live display' }).click();
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Live results' })).toBeVisible();
});
