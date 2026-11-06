import { expect, type Page } from '@playwright/test';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi } from './fixtures.js';
import { installConfettiSpy } from './effects-support.js';

// Prompt 36: opening the thank-you page straight on the finale (every activity done, all right first time), with the confetti counter and a counter
// of animation frames, and the times the shower's canvas came and went. Used by finale.spec.ts and finale-perf.spec.ts.

const appPath = (hash: string) => `${sharePointFolderPath}/index.html${hash}`;
const ALL = ['q-h1', 'q-h2', 'q-h3', 'q-b1', 'q-b2', 'q-p1'];
export const HEADLINE = 'Thank you, Jordan Lee!';

/** Opens the thank-you page with every activity done (all right first time), the confetti counter and a frame counter installed. */
export async function openFinale(page: Page, { hash = '#/thank-you?t=track-a' } = {}) {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
  const fixture = await mockApi(page);
  const { right } = addFlowContent(fixture, { flow: 'open' });
  makeVisitor(fixture);
  fixture.give(ALL.map((id) => ({ questionId: id, answer: id === 'q-p1' ? 'q-p1-a' : right(id) })));
  await installConfettiSpy(page);
  await page.addInitScript(() => {
    const state = { frames: 0, showerAt: 0, showerGone: 0 };
    (window as unknown as Record<string, unknown>).__finale = state;
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { state.frames += 1; return request(callback); };
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof HTMLCanvasElement && node.hasAttribute('data-pms-shower')) state.showerAt = performance.now();
        for (const node of record.removedNodes) if (node instanceof HTMLCanvasElement && node.hasAttribute('data-pms-shower')) state.showerGone = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(appPath(hash));
  await expect(page.getByRole('heading', { name: HEADLINE })).toBeVisible({ timeout: 10_000 });
  return { problems };
}

