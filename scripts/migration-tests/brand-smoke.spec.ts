import { test, expect, type Page } from '@playwright/test';
import { makeImage, withExifOrientation } from './brand-images.js';
import { another, ds, openAdmin, participantUrl, startLocal, stopLocal, today, type Local } from './admin-local.js';

// A smoke test of Brand Studio on Chromium AND WebKit (the engine of every iPad browser): upload (crop, re-encode, size cap,
// transparency, EXIF orientation), the preview, Save, and a participant's page. Safari cannot encode WebP, so there the
// pictures come out as PNG (and, if that is over the cap, a little smaller): what is asserted is what holds in both engines.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

const card = (page: Page, slot: string) => page.locator(`section.asset[data-slot="${slot}"]`);
const crop = (page: Page) => page.getByRole('dialog', { name: /Crop and fit/ });

async function pick(page: Page, slot: string, buffer: Buffer, name: string, mimeType: string) {
  const shown = await card(page, slot).locator('img').getAttribute('src', { timeout: 500 }).catch(() => null);
  await card(page, slot).locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  await expect(crop(page)).toBeVisible();
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(crop(page)).toHaveCount(0);
  // A picture already showing is replaced by the new one before it is read.
  if (shown) await expect(card(page, slot).locator('img')).not.toHaveAttribute('src', shown);
  // (If the picture was refused or could not be made, say why instead of only "Not set".)
  await expect(card(page, slot).getByTestId(`${slot}-status`)).toHaveText('Not saved yet').catch(async (error) => {
    throw new Error(`${error.message}\nThe card says: ${JSON.stringify(await card(page, slot).getByRole('alert').allTextContents())}`);
  });
}

const read = (page: Page, slot: string, points: [number, number][]) => card(page, slot).locator('img').evaluate(async (img: HTMLImageElement, at: [number, number][]) => {
  const blob = await (await fetch(img.src)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return { type: blob.type, bytes: blob.size, width: bitmap.width, height: bitmap.height, pixels: at.map(([x, y]) => [...ctx.getImageData(Math.min(x, bitmap.width - 1), Math.min(y, bitmap.height - 1), 1, 1).data]) };
}, points);

test('smoke: choose, crop and save a hero and a logo; the preview shows them; a participant sees the hero', async ({ page, browser, browserName }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openAdmin(page, local, 'Clients');
  // The upload is sent on to the server as it is (Playwright's WebKit cannot read a Blob request body to forward it by hand).
  await page.route('**/api/uploads/logo**', (route) => route.continue({ url: `${local.api}/api/uploads/logo${new URL(route.request().url()).search}` }));
  await page.locator('.row').filter({ hasText: 'Kroger' }).getByRole('button', { name: 'Brand' }).click();
  await expect(page.frameLocator('iframe[data-device]').getByRole('heading', { name: 'Hi Jane Doe!' })).toBeVisible();

  // A busy photo as a hero: where WebP can be made it is fitted under the cap; Safari cannot make WebP, so it says so, in words, and nothing changes.
  const photo = await makeImage(page, { width: 2000, height: 1500, type: 'image/jpeg', paint: 'photo', quality: 0.9 });
  if (browserName === 'webkit') {
    await card(page, 'hero').locator('input[type="file"]').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
    await crop(page).getByRole('button', { name: 'Use this picture' }).click();
    await expect(card(page, 'hero').getByRole('alert')).toContainText('This browser can only save it as a PNG');
    // (Nothing changes: Kroger's saved sample hero, Phase 10f, is still the one shown and saved.)
    await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Saved');
  } else {
    await pick(page, 'hero', photo, 'photo.jpg', 'image/jpeg');
    expect((await read(page, 'hero', [])).type).toBe('image/webp');
  }
  // A flat badge with a transparent background, cropped square, under 300 KB, in a format that works here.
  await pick(page, 'hero', await makeImage(page, { width: 1500, height: 1500, type: 'image/png', paint: 'logo' }), 'badge.png', 'image/png');
  const hero = await read(page, 'hero', []);
  expect(['image/webp', 'image/png']).toContain(hero.type);
  expect(hero.bytes).toBeLessThanOrEqual(300 * 1024);
  expect(hero.width, `${browserName}: ${hero.width} wide`).toBeGreaterThanOrEqual(900);
  expect(hero.width).toBeLessThanOrEqual(1200);
  expect(hero.height).toBe(hero.width);
  expect(hero.width, 'a flat badge fits at exactly the slot size in both engines').toBe(1200);
  if (browserName === 'chromium') expect(hero.type).toBe('image/webp');
  const corner = (await read(page, 'hero', [[3, 3]])).pixels[0];
  expect(corner[3], 'and its transparent corner stays transparent').toBe(0);

  // A phone photo turned by its EXIF tag comes out the right way up, and a transparent logo stays transparent.
  const rotated = withExifOrientation(await makeImage(page, { width: 600, height: 300, type: 'image/jpeg', paint: 'marker', quality: 0.95 }), 6);
  await pick(page, 'logo', rotated, 'phone.jpg', 'image/jpeg');
  const logo = await read(page, 'logo', [[480, 20], [320, 380], [20, 20]].map(([x, y]) => [x, y] as [number, number]));
  expect(logo.bytes).toBeLessThanOrEqual(150 * 1024);
  expect(logo.height * 2).toBe(logo.width);
  const scale = logo.width / 800;
  const [topRight, bottomLeft, topLeft] = (await read(page, 'logo', [[Math.round(480 * scale), Math.round(20 * scale)], [Math.round(320 * scale), Math.round(380 * scale)], [Math.round(20 * scale), Math.round(20 * scale)]])).pixels;
  expect(topRight[0], `${browserName}: red at the top right`).toBeGreaterThan(200);
  expect(bottomLeft[2], `${browserName}: blue at the bottom left`).toBeGreaterThan(200);
  expect(topLeft[3], `${browserName}: see-through where an unrotated picture would have its red square`).toBe(0);

  // The preview shows them as the real screen would.
  await expect(page.frameLocator('iframe[data-device]').locator('.pms-badge')).toHaveClass(/pms-badge-ready/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('brand-status')).toHaveText('All changes saved').catch(async (error) => {
    throw new Error(`${error.message}\nBrand Studio says: ${JSON.stringify(await page.locator('.brand__actions').getByRole('alert').allTextContents())}`);
  });
  const client = await ds.getClient('c-kroger');
  expect(client.theme.assets.hero).toMatch(/\/assets\/images\/clients\/kroger-hero-[0-9a-f]{10}\.(webp|png)$/);
  expect(client.logoUrl).toBe(client.theme.assets.logo);

  await ds.activateClient('c-kroger', today);
  const guest = await another(browser, local);
  await guest.page.goto(participantUrl);
  await expect(guest.page.locator('.pms-badge')).toHaveClass(/pms-badge-ready/);
  await guest.context.close();
});
