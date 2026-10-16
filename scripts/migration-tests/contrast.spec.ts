import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_KEYS, a11yPack, notLivePage, openParticipant, settle, themedSite, walkParticipant, type ThemeKey } from './a11y-support.js';
import { PIN, adminUrl, ds, startLocal, stopLocal, today, useServer, type Local } from './admin-local.js';
import { seedPack } from '../../migration/src/lib/seed.js';

// Phase 8, part C: contrast, computed from what the browser actually painted. axe can check a colour against a flat background but not against
// the participant page's gradient (it reports those as "needs review"), so this does it from pixels: every piece of visible text is found, all
// text is then made transparent, the page is photographed, and each piece of text's colour is compared with the WORST pixel behind it.
//   - text: 4.5:1, or 3:1 for large text (24 px, or 18.66 px and bold);
//   - the focus ring: 3:1 against the colours on both sides of it;
//   - disabled controls are exempt (WCAG 1.4.3); a locked activity's caption is measured and reported anyway.
// For each look: the default one, Kroger's and Domino's sample themes, and one with a light primary colour. The lowest ratio of each goes in
// test-results/a11y/contrast.json and is printed. Chromium only (it is arithmetic on pixels; the engines draw the same colours).

const out = fileURLToPath(new URL('../../test-results/a11y/', import.meta.url));

type Box = { text: string; where: string; x: number; y: number; w: number; h: number; color: string; opacity: number; large: boolean; disabled: boolean; size: number };
type Measured = { state: string; text: string; where: string; ratio: number; need: number; large: boolean; disabled: boolean };

/** Every piece of visible text, as the browser lays it out now. */
async function findText(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const boxes: Box[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const element = node.parentElement;
      if (!text || !element) continue;
      if (element.closest('script, style, noscript, canvas, [hidden], .sr-only, [inert]')) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || Number.parseFloat(style.fontSize) === 0) continue;
      let opacity = 1;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number(getComputedStyle(ancestor).opacity);
      if (opacity < 0.02) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      // One box for each LINE of the text (a paragraph that wraps round a swatch is not one rectangle: the swatch is not behind its words).
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        boxes.push({
          text: text.slice(0, 48), where: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.split(/\s+/)[0]}` : ''}`,
          x: rect.left + scrollX, y: rect.top + scrollY, w: rect.width, h: rect.height, color: style.color, opacity,
          large: size >= 24 || (size >= 18.66 && bold), size,
          disabled: Boolean(element.closest('button:disabled, [aria-disabled="true"], fieldset:disabled, [disabled]')),
        });
      }
    }
    return boxes;
  });
}

/** Photographs the page with every piece of text made transparent, in a window as tall as the page, so that nothing is hidden by scrolling. */
async function backgroundPicture(page: Page) {
  const original = page.viewportSize()!;
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  if (height > original.height) await page.setViewportSize({ width: original.width, height: Math.min(height, 6000) });
  await settle(page);
  const boxes = await findText(page);
  // (A style tag of its own, taken out again by its id: the page adds style tags of its own as screens open.)
  await page.evaluate(() => {
    const hide = document.createElement('style');
    hide.id = '__contrast-hide';
    hide.textContent = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;animation:none!important;transition:none!important}::placeholder{color:transparent!important}svg{visibility:hidden!important}canvas{visibility:hidden!important}';
    document.head.appendChild(hide);
  });
  const png = await page.screenshot();
  await page.evaluate(() => { document.getElementById('__contrast-hide')?.remove(); });
  if (height > original.height) await page.setViewportSize(original);
  return { boxes, png };
}

/** Compares each box's colour with the worst pixel behind it, in a blank page that only decodes the picture. */
async function measure(decoder: Page, png: Buffer, boxes: Box[]) {
  return decoder.evaluate(async ({ base64, boxes: list }) => {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const colour = (css: string) => {
      const swatch = document.createElement('canvas');
      swatch.width = swatch.height = 1;
      const draw = swatch.getContext('2d', { willReadFrequently: true })!;
      draw.fillStyle = '#000';
      draw.fillStyle = css;
      draw.clearRect(0, 0, 1, 1);
      draw.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = draw.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return list.map((box) => {
      const [r, g, b, a0] = colour(box.color);
      const alpha = a0 * box.opacity;
      const x0 = Math.max(0, Math.floor(box.x) + 1), y0 = Math.max(0, Math.floor(box.y) + 1);
      const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w) - 1), y1 = Math.min(canvas.height, Math.ceil(box.y + box.h) - 1);
      let worst = Infinity;
      if (x1 > x0 && y1 > y0) {
        const data = context.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        for (let at = 0; at < data.length; at += 8) { // every second pixel
          const back = [data[at], data[at + 1], data[at + 2]];
          const front = [r * alpha + back[0] * (1 - alpha), g * alpha + back[1] * (1 - alpha), b * alpha + back[2] * (1 - alpha)];
          const l1 = lum(front), l2 = lum(back);
          worst = Math.min(worst, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        }
      }
      return worst;
    });
  }, { base64: png.toString('base64'), boxes });
}

type Theme = { theme: ThemeKey; measured: Measured[]; ring: { state: string; against: string; ratio: number }[] };
const results: Theme[] = [];

async function textContrast(page: Page, decoder: Page, state: string): Promise<Measured[]> {
  const { boxes, png } = await backgroundPicture(page);
  const ratios = await measure(decoder, png, boxes);
  return boxes.map((box, index) => ({ state, text: box.text, where: box.where, ratio: ratios[index], need: box.large ? 3 : 4.5, large: box.large, disabled: box.disabled }));
}

/** The ring round the focused control, against what is on each side of it. */
async function ringContrast(page: Page, decoder: Page, state: string): Promise<{ state: string; against: string; ratio: number }[]> {
  await settle(page); // (a transition that is still running would be photographed half done)
  const info = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, outline: style.outlineColor, width: Number.parseFloat(style.outlineWidth), offset: Number.parseFloat(style.outlineOffset), name: (element.textContent ?? '').trim().slice(0, 24) };
  });
  if (!info) return [];
  await page.evaluate(() => {
    const still = document.createElement('style');
    still.id = '__contrast-still';
    still.textContent = '*{animation:none!important;transition:none!important}';
    document.head.appendChild(still);
  });
  // The viewport round the control, not the whole page: what is on screen is what a person sees, whatever sticks or scrolls.
  const view = page.viewportSize()!;
  const pad = 24;
  const clip = { x: Math.max(0, Math.floor(info.x - pad)), y: Math.max(0, Math.floor(info.y - pad)), width: 0, height: 0 };
  clip.width = Math.min(view.width - clip.x, Math.ceil(info.w + 2 * pad));
  clip.height = Math.min(view.height - clip.y, Math.ceil(info.h + 2 * pad));
  const png = await page.screenshot({ clip });
  if (process.env.RING_PICTURES) await writeFile(`${out}ring-${state.replace(/[^a-z]+/gi, '-')}.png`, png);
  await page.evaluate(() => { document.getElementById('__contrast-still')?.remove(); });
  info.x -= clip.x;
  info.y -= clip.y;
  return decoder.evaluate(async ({ base64, info: ring, state: label }) => {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const swatch = document.createElement('canvas');
    swatch.width = swatch.height = 1;
    const draw = swatch.getContext('2d', { willReadFrequently: true })!;
    draw.fillStyle = ring.outline; draw.fillRect(0, 0, 1, 1);
    const green = [...draw.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a: number[], b: number[]) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    // The colours on each side of the ring: one pixel beyond its outer edge, and one pixel inside its inner edge, at the middle of each of the four
    // sides (a pill's corners are curved, so anywhere else a straight sample would land on the ring itself).
    // (The inside neighbour is read 1 px from the control, in the band that fills the gap; the outside one 1.5 px past the ring, in the outer band.)
    const outer = ring.offset + ring.width + 1.5, inner = 1;
    const at = (distance: number) => {
      const out: number[][] = [];
      const midX = ring.x + ring.w / 2, midY = ring.y + ring.h / 2;
      for (const [px, py] of [[midX, ring.y - distance], [midX, ring.y + ring.h + distance], [ring.x - distance, midY], [ring.x + ring.w + distance, midY]]) {
        if (px >= 0 && py >= 0 && px < canvas.width && py < canvas.height) out.push([...context.getImageData(Math.round(px), Math.round(py), 1, 1).data].slice(0, 3));
      }
      return out;
    };
    // The second-lowest of the four sides: one side can have another control against it, inside the band, which is not the ring's own contrast; a ring that is
    // clipped on two sides, or has the page's colour against it, is still caught.
    const worst = (distance: number) => [...at(distance).map((pixel) => ratio(green, pixel))].sort((a, b) => a - b)[Math.min(1, at(distance).length - 1)];
    return [
      { state: `${label}: ring on "${ring.name}"`, against: 'just outside the ring', ratio: worst(outer) },
      { state: `${label}: ring on "${ring.name}"`, against: 'just inside the ring, next to the control', ratio: worst(inner) },
    ];
  }, { base64: png.toString('base64'), info, state });
}

async function decoderPage(context: BrowserContext) {
  const page = await context.newPage();
  await page.setContent('<!doctype html><title>decoder</title>');
  return page;
}

test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

for (const theme of THEME_KEYS) {
  test(`${theme} look: text and the focus ring meet their ratios on every participant screen and state`, async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 820, height: 1180 });
    const decoder = await decoderPage(context);
    const { fake, pack } = await themedSite({ theme });
    await openParticipant(page, fake);
    const measured: Measured[] = [];
    const ring: Theme['ring'] = [];
    await walkParticipant(page, { pack, clientId: THEMES[theme].clientId }, async (state) => {
      measured.push(...await textContrast(page, decoder, state));
      // Put the ring on the first control the keyboard reaches (the page is left as it was).
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      ring.push(...await ringContrast(page, decoder, state));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    });
    for (const state of ['not live', 'ended'] as const) {
      const other = await context.newPage();
      await other.setViewportSize({ width: 820, height: 1180 });
      await notLivePage(other, state);
      measured.push(...await textContrast(other, decoder, state));
      await other.close();
    }
    results.push({ theme, measured, ring });
    const enabled = measured.filter((item) => !item.disabled && Number.isFinite(item.ratio));
    const failing = enabled.filter((item) => item.ratio < item.need - 0.005);
    const lowest = [...enabled].sort((a, b) => a.ratio - b.ratio)[0];
    console.log(`[contrast ${theme}] ${enabled.length} pieces of text; lowest ${lowest.ratio.toFixed(2)}:1 ("${lowest.text}", ${lowest.where}, ${lowest.state}; needs ${lowest.need}); ring lowest ${Math.min(...ring.map((item) => item.ratio)).toFixed(2)}:1`);
    expect(failing.map((item) => `${item.state}: "${item.text}" (${item.where}) is ${item.ratio.toFixed(2)}:1, needs ${item.need}`), `${theme}: text under its ratio`).toEqual([]);
    expect(ring.filter((item) => item.ratio < 3).map((item) => `${item.state}, ${item.against}: ${item.ratio.toFixed(2)}:1`), `${theme}: the focus ring needs 3:1 on both sides`).toEqual([]);
  });
}

test('negative control: text that is too faint, and a ring with a light band beside it, are caught', async ({ page, context }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const decoder = await decoderPage(context);
  const { fake } = await themedSite({ theme: 'kroger' });
  await openParticipant(page, fake);
  await expect(page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<p id="faint" style="margin:0;color:#7a8a99;background:#8493a3;padding:8px;width:300px">Hard to read</p>');
  });
  const found = (await textContrast(page, decoder, 'negative control')).find((item) => item.text === 'Hard to read');
  expect(found, 'the faint line is found').toBeTruthy();
  expect(found!.ratio, 'and measured as faint').toBeLessThan(2);
  // A ring beside a light band: paint a white band where the outer dark band is and measure again.
  await page.getByRole('button', { name: 'Click here to begin' }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.addStyleTag({ content: ':focus-visible{box-shadow:0 0 0 3px #fff,0 0 0 9px #fff !important}' });
  const ring = await ringContrast(page, decoder, 'negative control');
  expect(Math.min(...ring.map((item) => item.ratio)), 'a white band either side of the ring is under 3:1').toBeLessThan(3);
});

test.describe('admin: text and the focus ring', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  test('every tab, Brand Studio and the Live display in each look: every piece of text and the ring meet their ratios', async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const decoder = await decoderPage(context);
    await seedPack(ds, a11yPack());
    const sessions: Record<string, { id: string }> = {};
    for (const theme of THEME_KEYS) {
      const clientId = THEMES[theme].clientId;
      const { session } = await ds.activateClient(clientId, today);
      sessions[theme] = session;
      const track = await ds.beginVisit(crypto.randomUUID(), session.id, clientId);
      const first = (await ds.listSections()).find((section: { clientId: string }) => section.clientId === clientId) as { questionIds: string[] };
      await ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId, responses: first.questionIds.slice(0, 2).map((questionId) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: new Date().toISOString() })) });
    }
    const measured: Measured[] = [];
    const ring: Theme['ring'] = [];
    const look = async (state: string) => {
      measured.push(...await textContrast(page, decoder, state));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      ring.push(...await ringContrast(page, decoder, state));
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    };
    await useServer(page, local);
    await page.goto(adminUrl);
    await look('PIN gate');
    await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
    await look('Today');
    for (const tab of ['Clients', 'Content', 'Guests and QR', 'Results']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { name: tab, exact: true }).first()).toBeVisible();
      await look(tab);
    }
    for (const [theme, name] of [['kroger', 'Kroger'], ['dominos', "Domino's"], ['light', 'Lemon Co'], ['default', 'Plain Co']] as const) {
      await page.getByRole('tab', { name: 'Clients', exact: true }).click();
      await page.getByRole('button', { name: `Brand: ${name}` }).click();
      await expect(page.getByRole('heading', { name: /Brand/ }).first()).toBeVisible();
      await look(`Brand Studio, ${theme}`);
      await page.getByRole('button', { name: '← Clients' }).click();
    }
    for (const theme of THEME_KEYS) {
      await page.evaluate((hash) => { location.hash = hash; }, `#live-display/${sessions[theme].id}`);
      await expect(page.locator('.result-card').first()).toBeVisible();
      await page.waitForTimeout(600); // the bars finish drawing in
      await look(`Live display, ${theme}`);
    }
    const enabled = measured.filter((item) => !item.disabled && Number.isFinite(item.ratio));
    const failing = enabled.filter((item) => item.ratio < item.need - 0.005);
    const lowest = [...enabled].sort((a, b) => a.ratio - b.ratio)[0];
    console.log(`[contrast admin] ${enabled.length} pieces of text; lowest ${lowest.ratio.toFixed(2)}:1 ("${lowest.text}", ${lowest.where}, ${lowest.state}; needs ${lowest.need}); ring lowest ${Math.min(...ring.map((item) => item.ratio)).toFixed(2)}:1`);
    results.push({ theme: 'admin' as ThemeKey, measured, ring });
    expect(failing.map((item) => `${item.state}: "${item.text}" (${item.where}) is ${item.ratio.toFixed(2)}:1, needs ${item.need}`), 'admin: text under its ratio').toEqual([]);
    expect(ring.filter((item) => item.ratio < 3).map((item) => `${item.state}, ${item.against}: ${item.ratio.toFixed(2)}:1`), 'admin: the focus ring needs 3:1 on both sides').toEqual([]);
  });
});

test.afterAll(async () => {
  if (results.length === 0) return;
  const summary = results.map(({ theme, measured, ring }) => {
    const enabled = measured.filter((item) => !item.disabled && Number.isFinite(item.ratio));
    const sorted = [...enabled].sort((a, b) => a.ratio - b.ratio);
    const captions = measured.filter((item) => item.disabled && /Finish the previous activity/.test(item.text));
    const normal = enabled.filter((item) => !item.large).sort((a, b) => a.ratio - b.ratio)[0];
    const large = enabled.filter((item) => item.large).sort((a, b) => a.ratio - b.ratio)[0];
    return {
      theme, pieces: enabled.length, lowest: { ratio: Number(sorted[0].ratio.toFixed(2)), text: sorted[0].text, where: sorted[0].where, state: sorted[0].state },
      lowestNormalText: normal ? Number(normal.ratio.toFixed(2)) : null, lowestLargeText: large ? Number(large.ratio.toFixed(2)) : null,
      lockedCaption: captions.length ? Number(Math.min(...captions.map((item) => item.ratio)).toFixed(2)) : null,
      focusRingLowest: ring.length ? Number(Math.min(...ring.map((item) => item.ratio)).toFixed(2)) : null,
    };
  });
  await writeFile(`${out}contrast.json`, `${JSON.stringify({ summary, detail: results }, null, 2)}\n`);
  console.table(summary.map(({ theme, pieces, lowest, lowestNormalText, lowestLargeText, lockedCaption, focusRingLowest }) => ({ theme, pieces, 'lowest overall': lowest.ratio, 'lowest normal text': lowestNormalText, 'lowest large text': lowestLargeText, 'locked caption (exempt)': lockedCaption, 'focus ring': focusRingLowest })));
});
