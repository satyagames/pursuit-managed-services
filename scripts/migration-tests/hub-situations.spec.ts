import { test, expect, type Page } from '@playwright/test';
import { sharePointFolderPath } from '../deployment-config.js';
import { addFlowContent, makeVisitor, mockApi } from './fixtures.js';

// Prompt 24: the hub in its four situations, on an iPad held both ways, as pictures for docs/history/RELEASE-24.md (test-results/hub-situations/). It reads
// only what every version of the hub has, so PMS_SHOT_NAME=before over an older build's pages makes the "before". Nothing is asserted but that the hub is there.

const name = process.env.PMS_SHOT_NAME || 'after';
const SITUATIONS: { situation: string; seed: string[] }[] = [
  { situation: 'first-visit', seed: [] },
  { situation: 'started', seed: ['q-h1'] },
  { situation: 'one-done', seed: ['q-h1', 'q-h2', 'q-h3'] },
  { situation: 'all-done', seed: ['q-h1', 'q-h2', 'q-h3', 'q-b1', 'q-b2', 'q-p1'] },
];

async function open(page: Page, seed: string[]) {
  const fixture = await mockApi(page);
  const { right } = addFlowContent(fixture);
  makeVisitor(fixture);
  fixture.give(seed.map((id) => ({ questionId: id, answer: id === 'q-p1' ? 'q-p1-a' : right(id) })));
  await page.goto(`${sharePointFolderPath}/index.html#/agenda?t=track-a`);
  await expect(page.locator('button.activity')).toHaveCount(3);
  await expect(page.locator('[data-motion]')).toHaveCount(0);
  await page.waitForTimeout(500);
}

for (const { situation, seed } of SITUATIONS) {
  for (const [hold, viewport] of [['portrait', { width: 820, height: 1180 }], ['landscape', { width: 1180, height: 820 }]] as const) {
    test(`the hub, ${situation}, ${hold}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await open(page, seed);
      await page.screenshot({ path: `test-results/hub-situations/${name}-${situation}-${hold}-${info.project.name}.png` });
    });
  }
}
