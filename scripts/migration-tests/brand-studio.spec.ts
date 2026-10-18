import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GIF, SVG, makeImage, truncated, withExifOrientation } from './brand-images.js';
import { OPEN_PAGES_NOTE, legacyColours } from '../../migration/src/lib/brand/brand-studio.js';
import { resolveClientTheme } from '../../migration/src/lib/brand/client-theme.js';
import { assetFileName } from '../../migration/src/lib/brand/asset-names.js';
import { SCRIM_ALPHA } from '../../migration/src/lib/brand/scrim.js';
import { SAMPLE_PICTURES, SAMPLE_PICTURE_NAMES } from '../../migration/src/lib/setup/sample-pictures.js';
import { contrastRatio, deriveTheme, relativeLuminance } from '../../migration/src/lib/brand/theme.js';
import { PIN, adminUrl, another, ds, expectFits, openAdmin, participantUrl, shoot, startLocal, stopLocal, today, viewports, type Local } from './admin-local.js';

// Phase 6: Brand Studio end to end. The BUILT admin and participant pages against the REAL local server on a scratch
// copy of server/data (one server per test, uploads in the scratch folder too). Screenshots go to test-results/admin/
// and are looked at, not only taken.

let local: Local;
test.beforeEach(async () => { local = await startLocal(); });
test.afterEach(async () => { await stopLocal(local); });

export async function openBrand(page: Page, name = 'Kroger') {
  await openAdmin(page, local, 'Clients');
  await page.locator('.row').filter({ hasText: name }).getByRole('button', { name: 'Brand' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Brand Studio · ${name}`) })).toBeVisible();
}

const slotInput = (page: Page, slot: string) => page.locator(`input[type="file"][data-slot="${slot}"]`);
const card = (page: Page, slot: string) => page.locator(`section.asset[data-slot="${slot}"]`);
const crop = (page: Page) => page.getByRole('dialog', { name: /Crop and fit/ });

async function choose(page: Page, slot: string, buffer: Buffer, name = 'picture.png', mimeType = 'image/png') {
  await slotInput(page, slot).setInputFiles({ name, mimeType, buffer });
}

/** Chooses a picture and accepts the crop as it starts. */
async function pickPicture(page: Page, slot: string, buffer: Buffer, name?: string, mimeType?: string) {
  await choose(page, slot, buffer, name, mimeType);
  await expect(crop(page)).toBeVisible();
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(crop(page)).toHaveCount(0);
  // The card's status moves to "Not saved yet" once the new picture is in (an old picture may be showing until then).
  await expect(card(page, slot).getByTestId(`${slot}-status`)).toHaveText('Not saved yet');
  await expect(card(page, slot).locator('img')).toBeVisible();
}

/** What the card holds now, read back from the picture itself: its real type, size in bytes and in pixels. */
async function pictureOf(page: Page, slot: string) {
  return card(page, slot).locator('img').evaluate(async (img: HTMLImageElement) => {
    const blob = await (await fetch(img.src)).blob();
    const bitmap = await createImageBitmap(blob);
    return { type: blob.type, bytes: blob.size, width: bitmap.width, height: bitmap.height };
  });
}

const devices = [
  { label: 'iPhone', id: 'phone', width: 390, height: 844 },
  { label: 'iPad portrait', id: 'ipad-portrait', width: 820, height: 1180 },
  { label: 'iPad landscape', id: 'ipad-landscape', width: 1180, height: 820 },
  { label: 'Desktop', id: 'desktop', width: 1440, height: 900 },
] as const;
const scenes = ['Welcome', 'Activities', 'Question', 'Correct answer', 'Finale'] as const;
const deviceButton = (page: Page, label: string) => page.getByRole('group', { name: 'Device' }).getByRole('button', { name: label, exact: true });
const sceneButton = (page: Page, label: string) => page.getByRole('group', { name: 'Screen' }).getByRole('button', { name: label, exact: true });
const previewFrame = (page: Page) => page.frameLocator('iframe[data-device]');
const status = (page: Page) => page.getByTestId('brand-status');

// ---- Where it lives and how it is laid out ---------------------------------------------------------------

test('Brand Studio opens from a client row, with the controls and the real preview side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBrand(page);
  await expect(page.getByRole('group', { name: 'Device' }).getByRole('button')).toHaveText(devices.map((device) => device.label));
  await expect(page.getByRole('group', { name: 'Screen' }).getByRole('button')).toHaveText([...scenes]);
  await expect(previewFrame(page).getByRole('heading', { name: 'Hi Jane Doe!' })).toBeVisible();
  await expect(status(page)).toHaveText('All changes saved');
  // Two columns: the preview is to the right of the controls, and stays in view as the controls scroll.
  const [controls, preview] = await Promise.all([page.locator('.brand__controls').boundingBox(), page.locator('.brand__preview').boundingBox()]);
  expect(preview!.x).toBeGreaterThan(controls!.x + controls!.width - 1);
  // Back to the list.
  await page.getByRole('button', { name: '← Clients' }).click();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
});

test('at 820 wide and below the preview moves below the controls; nothing scrolls sideways and every target is 44px', async ({ page }) => {
  await openBrand(page);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(previewFrame(page).getByRole('heading', { name: 'Hi Jane Doe!' })).toBeVisible();
    const [controls, preview] = await Promise.all([page.locator('.brand__controls').boundingBox(), page.locator('.brand__preview').boundingBox()]);
    if (viewport.width <= 820) expect(preview!.y, `${viewport.width}: below`).toBeGreaterThanOrEqual(controls!.y + controls!.height - 1);
    else expect(preview!.x, `${viewport.width}: beside`).toBeGreaterThan(controls!.x + controls!.width - 1);
    await expectFits(page, `Brand Studio at ${viewport.width}`);
    await shoot(page, `brand-studio-${viewport.width}`);
  }
});

test('the preview draws the real screens at the real size of each device (screenshots of every one)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBrand(page, "Domino's");
  for (const device of devices) {
    // Tall enough that the whole device is on screen when it is photographed.
    await page.setViewportSize({ width: 1440, height: Math.max(900, device.height + 260) });
    await deviceButton(page, device.label).click();
    const frame = page.locator(`iframe[data-device="${device.id}"]`);
    await expect(frame).toBeVisible();
    expect(await frame.evaluate((element: HTMLIFrameElement) => [element.clientWidth, element.clientHeight, element.contentWindow!.innerWidth, element.contentWindow!.innerHeight]), `${device.label} is exactly its size`).toEqual([device.width, device.height, device.width, device.height]);
    for (const scene of scenes) {
      await sceneButton(page, scene).click();
      await expect(sceneButton(page, scene)).toHaveAttribute('aria-pressed', 'true');
      await expect(previewFrame(page).locator('main#app-content')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.locator('.bprev__box').screenshot({ path: `${(await import('./admin-local.js')).shots}brand-${device.id}-${scene.toLowerCase().replace(/ /g, '-')}.png` });
    }
  }
  // The right words are on the right screens.
  await sceneButton(page, 'Activities').click();
  await expect(previewFrame(page).getByRole('heading', { name: "DOMINO'S TRIVIA NIGHT" })).toBeVisible();
  await expect(previewFrame(page).getByRole('button', { name: /Warm-up round/ })).toBeVisible();
  await expect(previewFrame(page).getByText('Finish the previous activity')).toBeVisible();
  await sceneButton(page, 'Question').click();
  await expect(previewFrame(page).getByText('Which planet is known as the Red Planet?')).toBeVisible();
  await expect(previewFrame(page).getByRole('button', { name: 'Next' })).toBeDisabled();
  await sceneButton(page, 'Correct answer').click();
  await expect(previewFrame(page).getByText('Correct', { exact: true })).toBeVisible();
  await expect(previewFrame(page).getByRole('button', { name: 'Next' })).toBeEnabled();
  await sceneButton(page, 'Finale').click();
  await expect(previewFrame(page).getByRole('heading', { name: 'Thank you, Jane Doe!' })).toBeVisible();
});

test('the preview is read-only: nothing in it can be clicked, it writes nothing, and the admin page keeps its own title', async ({ page }) => {
  await openBrand(page);
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(`${request.method()} ${request.url()}`); });
  const title = await page.title();
  await sceneButton(page, 'Question').click();
  await page.frameLocator('iframe[data-device]').getByRole('button', { name: /Venus/ }).click({ force: true, timeout: 2000 }).catch(() => {});
  await sceneButton(page, 'Welcome').click();
  await previewFrame(page).getByRole('button', { name: 'Click here to begin' }).click({ force: true, timeout: 2000 }).catch(() => {});
  expect(await page.frameLocator('iframe[data-device]').locator('#app').getAttribute('inert')).not.toBeNull();
  expect(await page.title()).toBe(title);
  expect(writes).toEqual([]);
  await expect(previewFrame(page).getByRole('heading', { name: 'Hi Jane Doe!' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
});

// ---- Colours ------------------------------------------------------------------------------------------------

test('colours: hex, picker, presets and accent drive the preview and the contrast table; light primaries say "adjusted for readability" with before and after, and auto-fix', async ({ page }) => {
  await openBrand(page);
  const primary = page.getByLabel('Primary', { exact: true });
  await expect(primary).toHaveValue('#045BCC');
  const frameBackground = () => previewFrame(page).locator('.shell').evaluate((element) => getComputedStyle(element).backgroundImage);
  const before = await frameBackground();

  // A preset.
  await page.getByRole('button', { name: /Teal #0A6B6B/ }).click();
  await expect(primary).toHaveValue('#0A6B6B');
  await expect(status(page)).toHaveText('Unsaved changes');
  await expect.poll(frameBackground).not.toBe(before);
  expect(await frameBackground()).toContain('rgb(10, 107, 107)');

  // Typing: a half-typed colour is left alone and flagged; a whole one applies at once.
  await primary.fill('#12');
  await expect(page.getByText('Enter a colour like #045BCC.')).toBeVisible();
  await primary.fill('0B648F');
  await expect(page.getByText('Enter a colour like #045BCC.')).toHaveCount(0);
  await expect.poll(frameBackground).toContain('rgb(11, 100, 143)');
  await primary.blur();
  await expect(primary).toHaveValue('#0B648F');

  // The contrast table: three word pairings at 4.5:1 and above, all passing, with the figures printed.
  const rows = page.locator('.brand__contrast tbody tr');
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) {
    await expect(row.locator('td').last()).toHaveText('✓ Pass');
    expect(parseFloat((await row.locator('td').first().textContent()) ?? '0')).toBeGreaterThanOrEqual(4.5);
  }

  // A light yellow has to be darkened: say so, with before and after, and offer the fix.
  await primary.fill('#FFD100');
  const adjusted = page.getByTestId('adjusted');
  await expect(adjusted).toContainText('Adjusted for readability');
  await expect(adjusted).toContainText('#FFD100');
  const to = (await adjusted.locator('.mono').first().textContent())!.trim();
  expect(to).toMatch(/^#[0-9A-F]{6}$/);
  await expect(page.locator('[data-warning="primary-light"]')).toBeVisible();
  await expect(rows.first().locator('td').last()).toHaveText('✓ Pass');
  await adjusted.getByRole('button', { name: /Auto-fix/ }).click();
  await expect(primary).toHaveValue(to);
  await expect(page.getByTestId('adjusted')).toHaveCount(0);
  await expect(page.locator('[data-warning="primary-light"]')).toHaveCount(0);

  // Accent: optional, and the warnings are not blockers.
  await page.getByLabel('Accent (optional)').fill('#E21737');
  await expect(page.locator('[data-warning="accent-near-red"]')).toContainText('within 30°');
  await expect(page.locator('[data-warning="accent-near-red"]')).toContainText('never on a button');
  await expect(page.locator('.brand__contrast tbody tr')).toHaveCount(5);
  await expect(page.locator('.brand__contrast tbody tr').nth(3)).toContainText('✕ Not drawn');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'No accent' }).click();
  await expect(page.getByLabel('Accent (optional)')).toHaveValue('');
  await expect(page.locator('[data-warning="accent-near-red"]')).toHaveCount(0);

  // A red primary: its buttons would look like a wrong answer.
  await primary.fill('#C8102E');
  await expect(page.locator('[data-warning="primary-near-red"]')).toBeVisible();
  await primary.fill('#000000');
  await expect(page.locator('[data-warning="primary-dark"]')).toBeVisible();
  await shoot(page, 'brand-studio-warnings');
});

test('Revert returns to the saved look, Reset goes to the standard blue and keeps the pictures, and Copy brings another client\'s colours', async ({ page }) => {
  await openBrand(page, "Domino's");
  const primary = page.getByLabel('Primary', { exact: true });
  await expect(primary).toHaveValue('#0B648F');
  await expect(page.getByLabel('Accent (optional)')).toHaveValue('#E21737');
  await page.getByRole('button', { name: /Plum/ }).click();
  await page.getByLabel('Dark plate').check();
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Revert to saved' }).click();
  await expect(primary).toHaveValue('#0B648F');
  await expect(page.getByLabel('Light plate')).toBeChecked();
  await expect(status(page)).toHaveText('All changes saved');
  await expect(page.getByRole('button', { name: 'Revert to saved' })).toBeDisabled();

  await page.getByRole('button', { name: 'Reset to standard blue' }).click();
  await expect(primary).toHaveValue('#045BCC');
  await expect(page.getByLabel('Accent (optional)')).toHaveValue('');

  await page.getByRole('button', { name: 'Revert to saved' }).click();
  await page.getByRole('button', { name: 'Copy brand from another client...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy brand from another client' });
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await expect(dialog.getByText('Kroger')).toBeVisible();
  await dialog.getByRole('radio', { name: /Kroger/ }).check();
  await dialog.getByRole('button', { name: 'Copy colours' }).click();
  await expect(primary).toHaveValue('#045BCC');
  await expect(page.getByLabel('Accent (optional)')).toHaveValue('');
  await expect(page.locator('.toast')).toContainText('Colours copied from Kroger');
  expect((await ds.getClient('c-dominos')).theme.primary, 'nothing was saved by copying').toBe('#0B648F');
});

// ---- Pictures: what is refused, and what every slot ends as ------------------------------------------------------

/** The colour of pixels of the picture a card holds, read from the picture itself (r, g, b, a at each point of its own size). */
async function pixelsOf(page: Page, slot: string, points: [number, number][]) {
  return card(page, slot).locator('img').evaluate(async (img: HTMLImageElement, at: [number, number][]) => {
    const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    return at.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  }, points);
}

/** The picture's own bytes. */
async function bytesOf(page: Page, slot: string) {
  const base64 = await card(page, slot).locator('img').evaluate(async (img: HTMLImageElement) => {
    const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
    let text = '';
    for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(text);
  });
  return Buffer.from(base64, 'base64');
}

const alertOf = (page: Page, slot: string) => card(page, slot).getByRole('alert');
const KB = 1024;

test('a file that is not a picture, an SVG, a GIF, a damaged picture, one over 10 MB and one too small are each refused in plain words, with no crop dialog and no change', async ({ page }) => {
  await openBrand(page);
  const refused = async (buffer: Buffer, name: string, mimeType: string, pattern: RegExp) => {
    await choose(page, 'hero', buffer, name, mimeType);
    await expect(alertOf(page, 'hero')).toContainText(pattern);
    await expect(crop(page)).toHaveCount(0);
    await expect(status(page)).toHaveText('All changes saved');
  };
  await refused(Buffer.from('this is a text file renamed to a picture'), 'notes.png', 'image/png', /not a picture/);
  await refused(SVG, 'logo.svg', 'image/svg+xml', /SVG drawings are not accepted/);
  await expect(alertOf(page, 'hero')).toContainText('PNG or WebP');
  await refused(GIF, 'spin.gif', 'image/gif', /GIF pictures are not accepted/);
  await expect(alertOf(page, 'hero')).toContainText('animated');
  await refused(truncated(await makeImage(page, { width: 900, height: 900, type: 'image/png', paint: 'photo' })), 'broken.png', 'image/png', /looks damaged/);
  await refused(Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.png', 'image/png', /over the 10 MB limit/);
  await refused(await makeImage(page, { width: 100, height: 100, type: 'image/png', paint: 'photo' }), 'tiny.png', 'image/png', /too small for the hero badge/);
  await expect(alertOf(page, 'hero')).toContainText('600 px wide');
  // A SVG that says it is a PNG is still an SVG: the bytes decide.
  await refused(SVG, 'trick.png', 'image/png', /SVG drawings are not accepted/);
  // The next good file clears the message.
  await choose(page, 'hero', await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }));
  await expect(crop(page)).toBeVisible();
  await expect(alertOf(page, 'hero')).toHaveCount(0);
  await crop(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(crop(page)).toHaveCount(0);
  await expect(card(page, 'hero').locator('button[data-choose]')).toBeFocused();
  await expect(status(page)).toHaveText('All changes saved');
});

test('every slot ends at exactly its target size, under its cap, in a format that suits it, whatever came in', async ({ page }) => {
  test.setTimeout(90_000);
  await openBrand(page);
  const cases = [
    { slot: 'hero', width: 1200, height: 1200, cap: 300 * KB, types: ['image/webp', 'image/png'], made: { width: 2400, height: 2400, type: 'image/png', paint: 'photo' } },
    { slot: 'logo', width: 800, height: 400, cap: 150 * KB, types: ['image/webp', 'image/png'], made: { width: 1600, height: 400, type: 'image/png', paint: 'logo' } },
    { slot: 'background', width: 1536, height: 2048, cap: 350 * KB, types: ['image/webp', 'image/jpeg'], made: { width: 6000, height: 4000, type: 'image/jpeg', paint: 'photo' } },
  ] as const;
  for (const entry of cases) {
    const input = await makeImage(page, { ...entry.made, quality: 0.9 });
    await pickPicture(page, entry.slot, input, `${entry.slot}.${entry.made.type === 'image/jpeg' ? 'jpg' : 'png'}`, entry.made.type);
    const picture = await pictureOf(page, entry.slot);
    expect(picture, entry.slot).toMatchObject({ width: entry.width, height: entry.height });
    expect(picture.bytes, `${entry.slot} is ${picture.bytes} bytes`).toBeLessThanOrEqual(entry.cap);
    expect(entry.types as readonly string[], `${entry.slot} is ${picture.type}`).toContain(picture.type);
    await expect(card(page, entry.slot).getByTestId(`${entry.slot}-status`)).toHaveText('Not saved yet');
  }
  await expect(status(page)).toHaveText('Unsaved changes');
  await shoot(page, 'brand-studio-pictures-chosen');
});

test('a transparent logo stays transparent, and a wrong-shaped picture is fitted whole with see-through bands', async ({ page }) => {
  await openBrand(page, "Domino's");
  await pickPicture(page, 'logo', await makeImage(page, { width: 1000, height: 1000, type: 'image/png', paint: 'logo' }), 'square-logo.png');
  const picture = await pictureOf(page, 'logo');
  expect(['image/webp', 'image/png']).toContain(picture.type);
  expect([picture.width, picture.height]).toEqual([800, 400]);
  // A square logo in a 2:1 frame is fitted whole: bands at both sides are see-through, the middle holds the mark.
  const [leftBand, rightBand, corner, middle] = await pixelsOf(page, 'logo', [[20, 200], [780, 200], [400, 3], [400, 200]]);
  expect([leftBand[3], rightBand[3]], 'the bands are transparent').toEqual([0, 0]);
  expect(corner[3], 'and so is the space around the mark').toBe(0);
  expect(middle[3], 'the mark is opaque').toBe(255);
  expect(middle[0], 'and is the logo\'s red').toBeGreaterThan(150);
  await expect(crop(page)).toHaveCount(0);
});

test('a phone photo that is rotated by its EXIF tag comes out the right way up, with its metadata gone', async ({ page }) => {
  await openBrand(page);
  // Stored as a landscape 600 x 300 picture with a red square at its top-left and a blue one at its bottom-right, and an EXIF tag saying "turn it a quarter clockwise" (orientation 6).
  const stored = await makeImage(page, { width: 600, height: 300, type: 'image/jpeg', paint: 'marker', quality: 0.95 });
  const photo = withExifOrientation(stored, 6);
  expect(photo.includes(Buffer.from('Exif')), 'the input has EXIF').toBe(true);
  await pickPicture(page, 'logo', photo, 'phone.jpg', 'image/jpeg');
  expect(await pictureOf(page, 'logo')).toMatchObject({ width: 800, height: 400 });
  // Displayed upright it is portrait (300 x 600), fitted whole into the 2:1 frame: a strip 200 px wide at x 300 to 500.
  // The red square (stored top-left) is now at the top-right of it, and the blue (stored bottom-right) at the bottom-left.
  const [topRight, bottomLeft, wouldBeTopLeft, band] = await pixelsOf(page, 'logo', [[480, 20], [320, 380], [20, 20], [100, 200]]);
  expect(topRight[0], 'red at the top right').toBeGreaterThan(200);
  expect([topRight[1], topRight[2]]).toEqual([expect.any(Number), expect.any(Number)]);
  expect(topRight[1] + topRight[2]).toBeLessThan(120);
  expect(bottomLeft[2], 'blue at the bottom left').toBeGreaterThan(200);
  expect(bottomLeft[0] + bottomLeft[1]).toBeLessThan(120);
  expect(wouldBeTopLeft[3], 'nothing where an unrotated picture would have its red square').toBe(0);
  expect(band[3]).toBe(0);
  // Re-encoding through a canvas drops everything but the pixels.
  const out = await bytesOf(page, 'logo');
  for (const marker of ['Exif', 'JFIF', 'ICC_PROFILE', 'XMP']) expect(out.includes(Buffer.from(marker)), `output has no ${marker}`).toBe(false);
});

test('a picture too detailed for its size cap is stopped with what to do about it, and nothing changes', async ({ page }) => {
  test.setTimeout(120_000);
  await openBrand(page);
  const noise = await makeImage(page, { width: 1536, height: 2048, type: 'image/jpeg', paint: 'noise', quality: 0.5 });
  expect(noise.length, 'a noise picture is under the 10 MB input limit').toBeLessThan(10 * 1024 * 1024);
  await choose(page, 'background', noise, 'noise.jpg', 'image/jpeg');
  await expect(crop(page)).toBeVisible();
  await crop(page).getByRole('button', { name: 'Use this picture' }).click();
  await expect(alertOf(page, 'background')).toContainText(/too detailed to fit in 350 KB/, { timeout: 100_000 });
  await expect(alertOf(page, 'background')).toContainText('simpler picture');
  // (Phase 10f: Kroger has its sample background; the refused picture changes nothing, so that one is still shown and saved.)
  await expect(card(page, 'background').locator('img')).toHaveAttribute('src', (await ds.getClient('c-kroger')).theme.assets.background);
  await expect(card(page, 'background').getByTestId('background-status')).toHaveText('Saved');
  await expect(status(page)).toHaveText('All changes saved');
});

test('"Crop and fit": drag, wheel, slider and arrow keys all move the same view; Fit whole and Fill the frame jump between the two; the output is the frame\'s contents', async ({ page }) => {
  await openBrand(page);
  const photo = await makeImage(page, { width: 2400, height: 1200, type: 'image/png', paint: 'marker' });
  await choose(page, 'hero', photo, 'wide.png');
  const dialog = crop(page);
  await expect(dialog).toBeVisible();
  const area = dialog.getByRole('group', { name: /Crop area for the hero badge/ });
  const view = async () => (await area.getAttribute('data-view'))!.split(',').map(Number) as [number, number, number];
  const [scale0, cx0, cy0] = await view();
  // A wide picture in a square badge starts filled in ("cover"): 1200/1200 = scale 1, centred.
  expect([scale0, cx0, cy0]).toEqual([1, 1200, 600]);

  // Arrow keys: the picture moves the way the key points; Shift takes a bigger step.
  await area.focus();
  await page.keyboard.press('ArrowLeft');
  const [, cxLeft] = await view();
  expect(cxLeft, 'the picture moved left, so what is in the middle is further right').toBeGreaterThan(cx0);
  await page.keyboard.press('Shift+ArrowLeft');
  const [, cxBig] = await view();
  expect(cxBig - cxLeft).toBeGreaterThan(cxLeft - cx0);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect((await view())[1]).toBeCloseTo(cx0, 5);
  await page.keyboard.press('+');
  expect((await view())[0], 'plus zooms in').toBeGreaterThan(1);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  expect((await view())[0], 'minus zooms out, never past showing the whole picture').toBeLessThanOrEqual(1);
  await page.keyboard.press('Home');
  expect((await view())[0], 'Home shows the whole picture').toBeCloseTo(0.5, 5);
  await page.keyboard.press('End');
  expect((await view())[0], 'End fills the frame').toBeCloseTo(1, 5);
  await expect(dialog.locator('p[role="status"]')).toContainText('The picture fills the frame');

  // Slider.
  const slider = dialog.getByRole('slider', { name: 'Zoom' });
  await slider.fill('1000');
  expect((await view())[0]).toBeCloseTo(4, 3);
  await slider.fill('0');
  expect((await view())[0], 'the slider\'s least is the whole picture').toBeCloseTo(0.5, 3);
  await dialog.getByRole('button', { name: 'Fill the frame' }).click();
  expect((await view())[0]).toBeCloseTo(1, 5);

  // Wheel zooms, and a drag moves.
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  const zoomed = await view();
  expect(zoomed[0]).toBeGreaterThan(1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 5, { steps: 6 });
  await page.mouse.up();
  const dragged = await view();
  expect(dragged[1], 'dragging right shows more of the left of the picture').toBeLessThan(zoomed[1]);

  // What is drawn is what the frame shows: "Fit whole picture" leaves transparent bands above and below.
  await dialog.getByRole('button', { name: 'Fit whole picture' }).click();
  await dialog.getByRole('button', { name: 'Use this picture' }).click();
  // (The saved hero shows until the new one is in: Phase 10f gave Kroger one.)
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Not saved yet');
  await expect(card(page, 'hero').locator('img')).toBeVisible();
  const [topBand, bottomBand, middle] = await pixelsOf(page, 'hero', [[600, 100], [600, 1100], [600, 600]]);
  expect([topBand[3], bottomBand[3]], 'bands above and below').toEqual([0, 0]);
  expect(middle[3]).toBe(255);
  expect(await pictureOf(page, 'hero')).toMatchObject({ width: 1200, height: 1200 });
});

test('the crop dialog works from the keyboard: it opens on the crop area, Tab walks its controls in a sensible order, every control has a name and the focus ring shows', async ({ page }) => {
  await openBrand(page);
  await choose(page, 'hero', await makeImage(page, { width: 1500, height: 1500, type: 'image/png', paint: 'photo' }));
  const dialog = crop(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Crop and fit: Hero badge');
  const area = dialog.getByRole('group', { name: /Crop area/ });
  await expect(area).toBeFocused();
  const focused = () => page.evaluate(() => { const element = document.activeElement as HTMLElement; return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30); });
  const order: string[] = [await focused()];
  for (let step = 0; step < 5; step += 1) { await page.keyboard.press('Tab'); order.push(await focused()); }
  expect(order.map((entry) => entry.slice(0, 9))).toEqual(['Crop area', 'Zoom', 'Fit whole', 'Fill the ', 'Cancel', 'Use this ']);
  // The ring: land on the area by keyboard and it has the green outline.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(area).toBeFocused();
  const ring = await area.evaluate((element) => { const style = getComputedStyle(element); return [style.outlineStyle, style.outlineWidth]; });
  expect(ring).toEqual(['solid', '3px']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(card(page, 'hero').locator('button[data-choose]')).toBeFocused();
});

test('the crop dialog fits a phone: no sideways scroll, targets of 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBrand(page);
  await choose(page, 'background', await makeImage(page, { width: 1600, height: 2100, type: 'image/jpeg', paint: 'photo' }), 'tall.jpg', 'image/jpeg');
  await expect(crop(page)).toBeVisible();
  await expectFits(page, 'crop dialog at 390');
  const box = (await crop(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await shoot(page, 'brand-crop-dialog-390', { full: false });
});

// ---- Save, replace, remove: what is stored, and what a participant then sees ----------------------------------------------

/** Waits until every picture has finished fading in: the fonts are in and no CSS transition or animation is still running. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' || animation.playState === 'pending').length)).toBe(0);
}

/**
 * How far, on average (0 to 255 per colour channel), what the screen draws inside `target` is from the picture at `src` stretched to fill
 * it. Both are read as pixels: the screen from a screenshot of the element, the picture drawn on a canvas of the same size.
 */
async function pictureDifference(page: Page, target: ReturnType<Page['locator']>, src: string) {
  const box = (await target.boundingBox())!;
  const shot = await page.screenshot({ clip: box });
  return page.evaluate(async ({ shotBase64, src, width, height }) => {
    const draw = async (bitmap: ImageBitmap) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const screen = await draw(await createImageBitmap(await (await fetch(`data:image/png;base64,${shotBase64}`)).blob()));
    const picture = await draw(await createImageBitmap(await (await fetch(src)).blob()));
    let total = 0;
    for (let index = 0; index < screen.length; index += 4) {
      total += Math.abs(screen[index] - picture[index]) + Math.abs(screen[index + 1] - picture[index + 1]) + Math.abs(screen[index + 2] - picture[index + 2]);
    }
    return total / (screen.length / 4) / 3;
  }, { shotBase64: shot.toString('base64'), src, width: box.width, height: box.height });
}

/** What this test uploaded: the scratch server's uploads, less the six sample pictures it starts with (Phase 10f; server/data points at them). */
const uploads = async () => (await readdir(path.join(local.dir, 'uploads')).catch(() => [] as string[])).filter((name) => !SAMPLE_PICTURE_NAMES.includes(name));
const samplesLeft = async () => (await readdir(path.join(local.dir, 'uploads')).catch(() => [] as string[])).filter((name) => SAMPLE_PICTURE_NAMES.includes(name));
const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);
const NAME = (slug: string, slot: string) => new RegExp(`^/assets/images/clients/${slug}-${slot}-[0-9a-f]{10}\\.(webp|png|jpg)$`);
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

async function participantOn(browser: Parameters<typeof another>[0], clientId: string) {
  await ds.activateClient(clientId, today);
  const guest = await another(browser, local);
  await guest.page.goto(participantUrl);
  await expect(guest.page.locator('.pms-welcome')).toBeVisible();
  return guest;
}

test('Save uploads each new picture under <slug>-<slot>-<hash>, writes the theme once at version + 1, writes the older colours and logo from it, and a participant then sees it all', async ({ page, browser }) => {
  await openBrand(page, "Domino's");
  const before = await ds.getClient('c-dominos');
  const heroBytes = await makeImage(page, { width: 1400, height: 1400, type: 'image/png', paint: 'photo' });
  await pickPicture(page, 'hero', heroBytes, 'badge.png');
  await pickPicture(page, 'logo', await makeImage(page, { width: 1200, height: 600, type: 'image/png', paint: 'logo' }), 'logo.png');
  await pickPicture(page, 'background', await makeImage(page, { width: 1800, height: 2400, type: 'image/jpeg', paint: 'photo' }), 'bg.jpg', 'image/jpeg');
  // The focal point: a click on the picture (and the safe-area guide moves with it).
  const frame = card(page, 'background').locator('.asset__frame');
  const box = (await frame.boundingBox())!;
  await frame.click({ position: { x: box.width * 0.25, y: box.height * 0.75 } });
  await expect(card(page, 'background').getByLabel('Focal point across (%)')).toHaveValue(/^2[45](\.\d)?$/);
  await expect(card(page, 'background').getByLabel('Focal point down (%)')).toHaveValue(/^7[45](\.\d)?$/);
  await page.getByLabel('Primary', { exact: true }).fill('#2B6E3F');
  await page.getByLabel('Dark plate').check();
  expect(await uploads(), 'nothing is uploaded before Save').toEqual([]);

  const requests: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') { const url = new URL(request.url()); requests.push(`${request.method()} ${url.pathname.replace('/api/', '')}${url.search}`); } });
  await save(page).click();
  await expect(page.getByTestId('saved-note')).toHaveText(OPEN_PAGES_NOTE);
  await expect(status(page)).toHaveText('All changes saved');
  for (const slot of ['hero', 'logo', 'background']) await expect(card(page, slot).getByTestId(`${slot}-status`)).toHaveText('Saved');
  // Three uploads, and one write to the client.
  expect(requests.filter((entry) => entry.startsWith('POST uploads/logo?name=')).length).toBe(3);
  expect(requests.filter((entry) => entry.startsWith('PATCH clients/'))).toEqual(['PATCH clients/c-dominos']);

  const client = await ds.getClient('c-dominos');
  expect(client.themeVersion).toBe(before.themeVersion + 1);
  expect(client.theme.version).toBe(client.themeVersion);
  expect(client.theme.primary).toBe('#2B6E3F');
  expect(client.theme.accent).toBe('#E21737');
  expect(client.theme.plate).toBe('dark');
  expect(client.theme.tokens).toEqual(deriveTheme('#2B6E3F', '#E21737', { plate: 'dark' }).tokens);
  expect(client.theme.assets.hero).toMatch(NAME('dominos', 'hero'));
  expect(client.theme.assets.logo).toMatch(NAME('dominos', 'logo'));
  expect(client.theme.assets.background).toMatch(NAME('dominos', 'background'));
  expect(client.theme.assets.tile, 'tile stays reserved and unused').toBeNull();
  expect(client.theme.assets.backgroundFocus.x).toBeGreaterThan(23);
  expect(client.theme.assets.backgroundFocus.y).toBeGreaterThan(73);
  expect(client.theme.copy, "the client's words are untouched").toEqual(before.theme.copy);
  // The older fields follow the theme, and the logo address is the logo's.
  expect([client.primaryColor, client.secondaryColor]).toEqual(Object.values(legacyColours({ primary: '#2B6E3F', accent: '#E21737', plate: 'dark' })));
  expect(client.logoUrl).toBe(client.theme.assets.logo);
  // Domino's three sample pictures were its own uploads (Phase 10f): the save replaced them, so they were removed; Kroger's are untouched.
  expect((await samplesLeft()).sort()).toEqual(['hero', 'logo', 'background'].map((slot) => SAMPLE_PICTURES['c-kroger'][slot as 'hero'].name).sort());
  // The files are there, and each name carries the hash of its own bytes.
  const files = await uploads();
  expect(files).toHaveLength(3);
  for (const url of [client.theme.assets.hero, client.theme.assets.logo, client.theme.assets.background]) {
    const name = path.basename(url);
    expect(files).toContain(name);
    expect(name.split('-').at(-1)!.split('.')[0]).toBe(hashOf(await readFile(path.join(local.dir, 'uploads', name))));
  }

  // A participant gets the hero badge as it is (no plate), the colours, and the background with its focal point.
  const guest = await participantOn(browser, 'c-dominos');
  const hero = guest.page.locator('.pms-badge');
  await expect(hero).toHaveAttribute('src', client.theme.assets.hero);
  await expect(hero).toHaveAttribute('alt', "Domino's");
  await expect.poll(() => hero.evaluate((image: HTMLImageElement) => [image.complete, image.naturalWidth, image.naturalHeight])).toEqual([true, 1200, 1200]);
  await expect(guest.page.locator('.pms-hero'), 'a hero badge needs no plate').toHaveCount(0);
  expect(await guest.page.evaluate(() => document.documentElement.style.getPropertyValue('--bg-mid'))).toBe('#2B6E3F');
  const background = guest.page.locator('.shell img.image');
  await expect(background).toHaveAttribute('src', client.theme.assets.background);
  await expect(guest.page.locator('.shell')).toHaveAttribute('data-background', 'ready');
  const position = await background.evaluate((image) => getComputedStyle(image).objectPosition);
  expect(position).toMatch(/^2[45](\.\d)?% 7[45](\.\d)?%$/);
  // Wait for the pictures to finish fading in (the badge takes 320 ms, the background 400 ms) before looking at them: an
  // earlier capture of this screen was taken mid-fade and showed the hero almost transparent.
  await settle(guest.page);
  expect(await hero.evaluate((image) => getComputedStyle(image).opacity), 'the settled hero is fully opaque').toBe('1');
  expect(await background.evaluate((image) => getComputedStyle(image).opacity), 'and so is the background').toBe('1');
  // Sampled from the pixels: what the screen draws over the hero is the picture itself, not the picture blended into the page.
  expect(await pictureDifference(guest.page, hero, client.theme.assets.hero), 'the pixels over the hero match the picture').toBeLessThan(10);
  await guest.page.screenshot({ path: `${(await import('./admin-local.js')).shots}brand-participant-hero-background.png` });
  // The check can fail: with the badge held at 35% (where a capture mid-fade would have been) the pixels no longer match.
  await hero.evaluate((image) => { image.style.transition = 'none'; image.style.opacity = '0.35'; });
  expect(await pictureDifference(guest.page, hero, client.theme.assets.hero), 'a 35% hero is told apart from the picture').toBeGreaterThan(40);
  await guest.context.close();

  // Replace the hero: a new name, and the old file is removed once the new one is in use.
  const oldHero = path.basename(client.theme.assets.hero);
  await pickPicture(page, 'hero', await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'marker' }), 'badge-2.png');
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  const replaced = await ds.getClient('c-dominos');
  expect(replaced.theme.assets.hero).toMatch(NAME('dominos', 'hero'));
  expect(replaced.theme.assets.hero).not.toBe(client.theme.assets.hero);
  expect(replaced.themeVersion).toBe(client.themeVersion + 1);
  const afterReplace = await uploads();
  expect(afterReplace, 'the old file is gone').not.toContain(oldHero);
  expect(afterReplace).toContain(path.basename(replaced.theme.assets.hero));
  expect(afterReplace).toHaveLength(3);

  // Remove the hero: Welcome shows the logo on the (dark) plate, and the file goes.
  await card(page, 'hero').getByRole('button', { name: 'Remove' }).click();
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Not set');
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  const noHero = await ds.getClient('c-dominos');
  expect(noHero.theme.assets.hero).toBeNull();
  expect(await uploads()).toHaveLength(2);
  const plated = await participantOn(browser, 'c-dominos');
  await expect(plated.page.locator('.pms-hero[data-plate="dark"] img')).toHaveAttribute('src', noHero.theme.assets.logo);
  await expect(plated.page.locator('.pms-hero img')).toHaveAttribute('alt', "Domino's");
  await expect(plated.page.locator('.pms-badge')).toHaveCount(0);
  expect(await plated.page.locator('.pms-hero').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(11, 31, 58)');
  await plated.context.close();

  // Remove the logo too: the client's name in type, and LogoUrl is cleared for the legacy app.
  await card(page, 'logo').getByRole('button', { name: 'Remove' }).click();
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  const noLogo = await ds.getClient('c-dominos');
  expect([noLogo.theme.assets.logo, noLogo.logoUrl]).toEqual([null, '']);
  expect(await uploads()).toHaveLength(1);
  const named = await participantOn(browser, 'c-dominos');
  await expect(named.page.locator('.pms-hero-text')).toHaveText("Domino's");
  await named.context.close();
});

test('a client that only has the older logo keeps it through a Save, and choosing a new logo replaces it everywhere', async ({ page }) => {
  // (Phase 9b: Kroger ships with no logo now, and the drawn stand-in's address counts as none, so a client with an older LogoUrl is made: a real-looking address.)
  const OLDER = '/assets/images/clients/older-logo.png';
  // (Phase 10f: the sample Kroger has a logo in its theme, so its pictures are taken out first: a client with only the older logo.)
  const kroger = await ds.getClient('c-kroger');
  await ds.updateClient('c-kroger', { logoUrl: OLDER, theme: { ...kroger.theme, assets: { hero: null, logo: null, background: null, tile: null } } });
  const deleted: string[] = [];
  page.on('request', (request) => { if (request.method() === 'DELETE' && request.url().includes('/api/uploads/logo/')) deleted.push(request.url()); });
  await openBrand(page, 'Kroger');
  const before = await ds.getClient('c-kroger');
  expect(before.logoUrl).toBe(OLDER);
  // The older logo is shown and counts as saved.
  await expect(card(page, 'logo').getByTestId('logo-status')).toHaveText('Saved');
  await page.getByRole('button', { name: /Slate/ }).click();
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  const saved = await ds.getClient('c-kroger');
  expect(saved.logoUrl, 'the older logo is untouched').toBe(OLDER);
  expect(saved.theme.assets.logo, 'and is not copied into the theme').toBeNull();
  expect(saved.primaryColor).toBe(legacyColours({ primary: '#3C4A5E' }).primaryColor);
  expect(await uploads()).toEqual([]);
  // A new logo replaces it in both places; the seeded file is not ours to remove.
  await pickPicture(page, 'logo', await makeImage(page, { width: 900, height: 450, type: 'image/png', paint: 'logo' }), 'new-logo.png');
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  const replaced = await ds.getClient('c-kroger');
  expect(replaced.theme.assets.logo).toMatch(NAME('kroger', 'logo'));
  expect(replaced.logoUrl).toBe(replaced.theme.assets.logo);
  expect(await uploads()).toHaveLength(1);
  expect(deleted, 'the older address is not ours to remove: nothing was deleted').toEqual([]);
});

test('Revert throws away a picture that was only chosen: nothing was uploaded, nothing written', async ({ page }) => {
  await openBrand(page);
  const writes: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.method()); });
  await pickPicture(page, 'hero', await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }), 'badge.png');
  await expect(status(page)).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Revert to saved' }).click();
  // (Back to the saved hero: Phase 10f gave Kroger one.)
  await expect(card(page, 'hero').locator('img')).toHaveAttribute('src', (await ds.getClient('c-kroger')).theme.assets.hero);
  await expect(card(page, 'hero').getByTestId('hero-status')).toHaveText('Saved');
  await expect(status(page)).toHaveText('All changes saved');
  expect(writes).toEqual([]);
  expect(await uploads()).toEqual([]);
});

test('Save does nothing when nothing changed, and a failed upload stops the save before anything is written', async ({ page }) => {
  await openBrand(page);
  await expect(save(page)).toBeDisabled();
  await pickPicture(page, 'hero', await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }), 'badge.png');
  const before = await ds.getClient('c-kroger');
  await page.route('**/api/uploads/logo**', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic upload denied' }) }));
  await save(page).click();
  await expect(page.locator('.brand__actions').getByRole('alert')).toHaveText('Synthetic upload denied');
  await expect(status(page)).toHaveText('Unsaved changes');
  expect(await ds.getClient('c-kroger'), 'the client is exactly as it was').toEqual(before);
  // The picture is still there to try again.
  await expect(card(page, 'hero').locator('img')).toBeVisible();
  await page.unroute('**/api/uploads/logo**');
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  expect((await ds.getClient('c-kroger')).theme.assets.hero).toMatch(NAME('kroger', 'hero'));
});

test('if the write to the client fails, the pictures just uploaded are removed again', async ({ page }) => {
  await openBrand(page);
  await pickPicture(page, 'hero', await makeImage(page, { width: 1300, height: 1300, type: 'image/png', paint: 'photo' }), 'badge.png');
  await page.route('**/api/clients/c-kroger', (route) => (route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic write failure' }) })
    : route.fallback()));
  await save(page).click();
  await expect(page.locator('.brand__actions').getByRole('alert')).toContainText('Synthetic write failure');
  await expect.poll(uploads).toEqual([]);
  await expect(status(page)).toHaveText('Unsaved changes');
});

test('the unsaved-changes guard: leaving by tab, by Back or by Lock asks first; Keep editing stays; reload is the browser\'s own prompt', async ({ page }) => {
  await openBrand(page);
  const beforeUnload = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(await beforeUnload(), 'nothing unsaved: no prompt').toBe(false);
  await page.getByRole('button', { name: /Plum/ }).click();
  expect(await beforeUnload(), 'unsaved: the browser asks before closing or reloading').toBe(true);

  await page.getByRole('tab', { name: 'Today' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave Brand Studio?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Primary', { exact: true })).toHaveValue('#8B2F6F');

  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('button', { name: 'Lock' })).toBeVisible();

  await page.getByRole('button', { name: '← Clients' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('heading', { name: /Brand Studio/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Content' }).click();
  await dialog.getByRole('button', { name: 'Leave without saving' }).click();
  await expect(page.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
  expect((await ds.getClient('c-kroger')).theme.primary, 'nothing was saved').toBe('#045BCC');
  // And once saved there is nothing to ask.
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.locator('.row').filter({ hasText: 'Kroger' }).getByRole('button', { name: 'Brand' }).click();
  await page.getByRole('button', { name: /Plum/ }).click();
  await save(page).click();
  await expect(status(page)).toHaveText('All changes saved');
  expect(await beforeUnload()).toBe(false);
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
});

test('if someone else saved this client\'s look while it was open, Save says so and only overwrites if told to', async ({ page }) => {
  await openBrand(page);
  await ds.updateClient('c-kroger', { themeVersion: 7 });
  await page.getByRole('button', { name: /Teal/ }).click();
  await save(page).click();
  const dialog = page.getByRole('dialog', { name: 'Someone else changed this look' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect((await ds.getClient('c-kroger')).theme.primary, 'nothing was written').toBe('#045BCC');
  await expect(status(page)).toHaveText('Unsaved changes');
  await save(page).click();
  await dialog.getByRole('button', { name: 'Save mine anyway' }).click();
  await expect(status(page)).toHaveText('All changes saved');
  const client = await ds.getClient('c-kroger');
  expect([client.theme.primary, client.themeVersion]).toEqual(['#0A6B6B', 8]);
});

// ---- What a participant's page does with a look ---------------------------------------------------------------------

test('what an open participant page does after a save is what Brand Studio says: it keeps the old look until it is reloaded', async ({ page, browser }) => {
  const guest = await participantOn(browser, 'c-dominos');
  const mid = () => guest.page.evaluate(() => document.documentElement.style.getPropertyValue('--bg-mid'));
  expect(await mid()).toBe('#0B648F');
  const seen = guest.requests.length;
  await openBrand(page, "Domino's");
  await page.getByRole('button', { name: /Plum/ }).click();
  await save(page).click();
  await expect(page.getByTestId('saved-note')).toContainText('already open keep the old look until they are reloaded');
  // Longer than two of the local page's 3-second checks.
  await guest.page.waitForTimeout(7500);
  const since = guest.requests.slice(seen);
  expect(since.some((entry) => entry.includes('appsettings')), 'the open page did check what is live').toBe(true);
  expect(since.some((entry) => /GET clients/.test(entry)), 'but it never read the client again').toBe(false);
  expect(await mid(), 'and kept the old look').toBe('#0B648F');
  await guest.page.reload();
  await expect(guest.page.locator('.pms-welcome')).toBeVisible();
  expect(await mid(), 'a reloaded page shows the new one').toBe('#8B2F6F');
  await guest.context.close();
});

test('the Live display and its exports read the stored theme when there is one, and the older fields when there is not', async ({ browser }) => {
  await ds.updateClient('c-kroger', { primaryColor: '#111111', secondaryColor: '#222222' });
  await ds.createClient({ id: 'c-old', name: 'Old Co', slug: 'old-co', status: 'active', logoUrl: '', primaryColor: '#123456', secondaryColor: '#654321', createdAt: new Date().toISOString() });
  const brandColours = async (clientId: string, expected: string[]) => {
    const { session } = await ds.activateClient(clientId, today);
    const guest = await another(browser, local);
    await guest.page.goto(`${adminUrl}#live-display/${session.id}`);
    await guest.page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
    await guest.page.getByRole('button', { name: 'Unlock' }).click();
    await expect(guest.page.getByRole('heading', { name: 'Live results' })).toBeVisible();
    // The display wears the client's colours on itself (the admin page around it keeps its own).
    await expect.poll(() => guest.page.locator('section.live').evaluate((element) => [(element as HTMLElement).style.getPropertyValue('--brand-primary'), (element as HTMLElement).style.getPropertyValue('--brand-secondary')])).toEqual(expected);
    expect(await guest.page.evaluate(() => document.documentElement.style.getPropertyValue('--brand-primary')), 'the admin page itself is not recoloured').toBe('');
    await guest.context.close();
  };
  // Kroger has a stored theme: its colours are the theme's, whatever the older fields say.
  await brandColours('c-kroger', Object.values(legacyColours({ primary: '#045BCC' })));
  // Old Co has none: the older fields.
  await brandColours('c-old', ['#123456', '#654321']);
});

/** The brightest pixel inside each element once its words are hidden: what the words sit on. Contrast against white follows from it. */
async function worstContrastOver(page: Page, selector: string) {
  const elements = await page.locator(selector).all();
  expect(elements.length, `${selector} is on screen`).toBeGreaterThan(0);
  let worst = Infinity;
  for (const element of elements) {
    await element.scrollIntoViewIfNeeded();
    const box = (await element.boundingBox())!;
    // Clear of a pill's white border and of the curve of its corners.
    const inset = Math.min(10, box.height / 4, box.width / 4);
    const shot = await page.screenshot({ clip: { x: box.x + inset, y: box.y + inset, width: Math.max(1, box.width - 2 * inset), height: Math.max(1, box.height - 2 * inset) } });
    const brightest = await page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const lin = (value: number) => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
      let top = 0;
      for (let index = 0; index < data.length; index += 4) top = Math.max(top, 0.2126 * lin(data[index]) + 0.7152 * lin(data[index + 1]) + 0.0722 * lin(data[index + 2]));
      return top;
    }, shot.toString('base64'));
    worst = Math.min(worst, 1.05 / (brightest + 0.05));
  }
  return worst;
}

test('over a pure white background picture, white words still have 4.5:1: on the page, on pills and on the question (sampled from the pixels)', async ({ browser }) => {
  test.setTimeout(60_000);
  const guest = await another(browser, local);
  const white = await makeImage(guest.page, { width: 768, height: 1024, type: 'image/jpeg', paint: 'white', quality: 0.9 });
  const stored = await ds.uploadClientAsset(new Blob([white], { type: 'image/jpeg' }), assetFileName('dominos', 'background', white, 'image/jpeg'));
  const client = await ds.getClient('c-dominos');
  await ds.updateClient('c-dominos', { theme: { ...client.theme, assets: { ...client.theme.assets, background: stored.url, backgroundFocus: { x: 50, y: 50 } } } });
  await guest.page.goto(`${participantUrl}?preview=c-dominos`);
  await expect(guest.page.locator('.shell')).toHaveAttribute('data-background', 'ready');
  await guest.page.evaluate(() => document.fonts.ready);
  await guest.page.waitForTimeout(700); // the picture and its scrim fade in over 400 ms
  expect(await guest.page.locator('.shell img.image').evaluate((image: HTMLImageElement) => [image.naturalWidth, getComputedStyle(image).opacity])).toEqual([768, '1']);
  // The picture is white right through: sample it where no words are.
  const hideWords = await guest.page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; text-shadow: none !important; }' });
  const welcome = Math.min(await worstContrastOver(guest.page, '.pms-welcome h1'), await worstContrastOver(guest.page, '.pms-welcome .pms-line'));
  expect(welcome, 'Welcome: words straight on the page').toBeGreaterThanOrEqual(4.5);
  await guest.page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(guest.page.locator('button.activity').first()).toBeVisible();
  const hub = [await worstContrastOver(guest.page, '.pms-title'), await worstContrastOver(guest.page, '.pms-description'), await worstContrastOver(guest.page, 'button.activity')];

  expect(Math.min(...hub), 'the hub: title, description and the translucent pills').toBeGreaterThanOrEqual(4.5);
  await guest.page.locator('button.activity').first().click();
  await expect(guest.page.locator('.pms-question')).toBeVisible();
  const question = [await worstContrastOver(guest.page, '.pms-question'), await worstContrastOver(guest.page, '.pms-count')];
  expect(Math.min(...question), 'a question and its count').toBeGreaterThanOrEqual(4.5);
  await hideWords.evaluate((element) => element.remove());
  await guest.page.screenshot({ path: `${(await import('./admin-local.js')).shots}brand-participant-white-background.png` });
  // The test can fail: the scrim the shell had before (60% at the top) is not enough over a white picture under a pill.
  await guest.page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; }' });
  await guest.page.evaluate((alpha) => document.querySelector<HTMLElement>('.shell')!.style.setProperty('--scrim-alpha', String(alpha)), 0.6);
  await guest.page.getByRole('button', { name: 'Back to activities' }).click();
  expect(await worstContrastOver(guest.page, 'button.activity'), 'with a 60% scrim the pills fail').toBeLessThan(4.5);
  expect(SCRIM_ALPHA).toBe(0.63);
  await guest.context.close();
});

test('with every image request blocked the page is still interactive at normal speed, and the fallbacks show: the plate, the name in type and the gradient', async ({ browser }) => {
  const stash = await another(browser, local);
  const hero = await makeImage(stash.page, { width: 600, height: 600, type: 'image/jpeg', paint: 'photo', quality: 0.6 });
  const background = await makeImage(stash.page, { width: 768, height: 1024, type: 'image/jpeg', paint: 'photo', quality: 0.6 });
  await stash.context.close();
  const client = await ds.getClient('c-dominos');
  const heroUrl = (await ds.uploadClientAsset(new Blob([hero], { type: 'image/jpeg' }), assetFileName('dominos', 'hero', hero, 'image/jpeg'))).url;
  const backgroundUrl = (await ds.uploadClientAsset(new Blob([background], { type: 'image/jpeg' }), assetFileName('dominos', 'background', background, 'image/jpeg'))).url;
  await ds.updateClient('c-dominos', { theme: { ...client.theme, assets: { ...client.theme.assets, hero: heroUrl, logo: heroUrl, background: backgroundUrl, backgroundFocus: { x: 50, y: 50 } } } });
  await ds.activateClient('c-dominos', today);

  const timeToButton = async (blocked: boolean) => {
    const guest = await another(browser, local);
    if (blocked) await guest.page.route('**/*', (route) => (route.request().resourceType() === 'image' ? route.abort() : route.fallback()));
    const began = Date.now();
    await guest.page.goto(participantUrl);
    const button = guest.page.getByRole('button', { name: 'Click here to begin' });
    await expect(button).toBeEnabled();
    const took = Date.now() - began;
    return { guest, button, took };
  };
  const open = await timeToButton(false);
  await expect(open.guest.page.locator('.pms-badge')).toHaveClass(/pms-badge-ready/);
  await open.guest.context.close();

  const blocked = await timeToButton(true);
  expect(blocked.took, `${blocked.took} ms with images blocked`).toBeLessThan(3000);
  expect(blocked.took, `no slower than with images (${open.took} ms): nothing waits for a picture`).toBeLessThan(open.took + 1000);
  await expect(blocked.guest.page.locator('.pms-hero-text'), 'hero and logo both failed: the name in type on the plate').toHaveText("Domino's");
  await expect(blocked.guest.page.locator('.pms-badge')).toHaveCount(0);
  await expect(blocked.guest.page.locator('.shell')).toHaveAttribute('data-background', 'failed');
  await expect(blocked.guest.page.locator('.shell img.image, .shell .scrim')).toHaveCount(0);
  expect(await blocked.guest.page.evaluate(() => getComputedStyle(document.querySelector('.shell')!).backgroundImage), 'the gradient is what is behind everything').toContain('linear-gradient');
  await blocked.button.click();
  await expect(blocked.guest.page.locator('button.activity').first()).toBeVisible();
  await blocked.guest.page.screenshot({ path: `${(await import('./admin-local.js')).shots}brand-participant-images-blocked.png` });
  await blocked.guest.context.close();
});

test('a slow hero never holds the page up: the button works at once, the plate stands in after a moment, and the badge takes over when it arrives', async ({ browser }) => {
  const stash = await another(browser, local);
  const hero = await makeImage(stash.page, { width: 600, height: 600, type: 'image/jpeg', paint: 'photo', quality: 0.6 });
  await stash.context.close();
  const client = await ds.getClient('c-dominos');
  const heroUrl = (await ds.uploadClientAsset(new Blob([hero], { type: 'image/jpeg' }), assetFileName('dominos', 'hero', hero, 'image/jpeg'))).url;
  await ds.updateClient('c-dominos', { theme: { ...client.theme, assets: { ...client.theme.assets, hero: heroUrl, logo: null } }, logoUrl: '' });
  await ds.activateClient('c-dominos', today);
  const guest = await another(browser, local);
  await guest.page.route('**/assets/images/clients/*-hero-*', async (route) => { await new Promise((resolve) => setTimeout(resolve, 4000)); await route.fallback(); });
  await guest.page.goto(participantUrl);
  const button = guest.page.getByRole('button', { name: 'Click here to begin' });
  await expect(button).toBeEnabled();
  // The space is kept, nothing is drawn yet, and the page is already usable.
  await expect(guest.page.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'loading');
  const box = (await guest.page.locator('.pms-hero-box').boundingBox())!;
  expect(box.width).toBeGreaterThan(150);
  await expect(guest.page.locator('.pms-hero')).toHaveCount(0);
  // After a moment the plate (here the name in type: there is no logo) stands in.
  await expect(guest.page.locator('.pms-hero-text')).toHaveText("Domino's", { timeout: 3500 });
  expect((await guest.page.locator('.pms-hero-box').boundingBox())!.height, 'and nothing moved').toBeCloseTo(box.height, 0);
  // When the badge arrives it replaces the plate.
  await expect(guest.page.locator('.pms-badge')).toHaveClass(/pms-badge-ready/, { timeout: 8000 });
  await expect(guest.page.locator('.pms-hero')).toHaveCount(0);
  await guest.context.close();
});

test('the preview frame and the real participant page lay Welcome and the hub out the same way at a phone\'s size', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ds.activateClient('c-dominos', today);
  const guest = await another(browser, local);
  await guest.page.setViewportSize({ width: 390, height: 844 });
  await guest.page.goto(participantUrl);
  await expect(guest.page.locator('.pms-welcome')).toBeVisible();
  await openBrand(page, "Domino's");
  const preview = previewFrame(page);
  await expect(preview.locator('.pms-welcome')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await guest.page.evaluate(() => document.fonts.ready);
  const rects = async (target: { locator: Page['locator'] }, selectors: string[]) => {
    const out: Record<string, number[]> = {};
    for (const selector of selectors) {
      const box = await target.locator(selector).first().evaluate((element) => { const rect = element.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value)); });
      out[selector] = box;
    }
    return out;
  };
  const same = (a: number[], b: number[], what: string, skipWidth = false) => {
    for (const [index, name] of ['x', 'y', 'width', 'height'].entries()) {
      if (skipWidth && (index === 0 || index === 2)) continue; // a name of another length is another width, and centring moves its x
      expect(Math.abs(a[index] - b[index]), `${what} ${name}: ${a} vs ${b}`).toBeLessThanOrEqual(1);
    }
  };
  // (Phase 10f: Domino's has a hero badge, so the badge is laid out where the plate was; both are waited for until they have loaded.)
  await expect(guest.page.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'ready');
  await expect(preview.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'ready');
  const welcomeSelectors = ['.wordmark', '.pms-hero-box', '.pms-badge', 'h1', '.pms-cta .pill-button'];
  const real = await rects(guest.page, welcomeSelectors);
  const shown = await rects(preview, welcomeSelectors);
  for (const selector of welcomeSelectors) same(real[selector], shown[selector], `Welcome ${selector}`, selector === 'h1');
  // Same colours, same face.
  const look = (target: { locator: Page['locator'] }) => target.locator('.shell').evaluate((shell) => { const style = getComputedStyle(shell); return [style.backgroundImage, style.fontFamily, getComputedStyle(document.querySelector('h1')!).fontWeight, getComputedStyle(document.querySelector('.pill-button')!).backgroundColor]; });
  expect(await look(preview)).toEqual(await look(guest.page));

  // The hub.
  await guest.page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(guest.page.locator('button.activity').first()).toBeVisible();
  await sceneButton(page, 'Activities').click();
  await expect(preview.locator('button.activity').first()).toBeVisible();
  const hubSelectors = ['.pms-title', '.pms-description', 'hr.pms-divider', 'button.activity', '.pms-actions .pill-button, .pms-actions button'];
  // (Phase 15: the real hub's title, rule and activities rise in when it opens; they are compared where they settle, as the question above is shot settled.)
  await guest.page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const realHub = await rects(guest.page, hubSelectors);
  const shownHub = await rects(preview, hubSelectors);
  for (const selector of hubSelectors) same(realHub[selector], shownHub[selector], `Hub ${selector}`);
  await guest.context.close();
});

test('index.html?preview=<clientId> shows that client\'s Welcome and read-only activities with a Preview ribbon, even when it is not live, and saves nothing', async ({ browser }) => {
  // Nothing is live. A real iPad opens the preview address.
  const guest = await another(browser, local);
  const tracksBefore = (await ds.listClientTracks()).length;
  const writes: string[] = [];
  guest.page.on('request', (request) => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`); });
  await guest.page.setViewportSize({ width: 820, height: 1180 });
  await guest.page.goto(`${participantUrl}?preview=c-dominos`);
  await expect(guest.page.getByRole('status').filter({ hasText: 'Preview · nothing is saved' })).toBeVisible();
  // (Phase 10f: Domino's has its sample hero badge, shown as it is.)
  await expect(guest.page.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'ready');
  await expect(guest.page.locator('.pms-badge')).toHaveAttribute('src', `/assets/images/clients/${SAMPLE_PICTURES['c-dominos'].hero.name}`);
  await expect(guest.page.locator('.pms-badge')).toHaveAttribute('alt', "Domino's");
  expect(await guest.page.evaluate(() => document.documentElement.style.getPropertyValue('--bg-mid'))).toBe('#0B648F');
  await expect(guest.page.getByRole('heading', { name: 'Hi there!' })).toBeVisible();
  await guest.page.getByRole('button', { name: 'Click here to begin' }).click();
  await expect(guest.page.getByRole('heading', { name: "DOMINO'S TRIVIA NIGHT" })).toBeVisible();
  // Every activity of the client, switched on or not.
  const sections = await ds.listClientSections('c-dominos');
  await expect(guest.page.locator('button.activity')).toHaveCount(sections.length);
  await guest.page.locator('button.activity').first().click();
  await expect(guest.page.locator('.pms-question')).toBeVisible();
  // Phase 9b (SEC-1), ON PURPOSE the reverse of what this test asserted before: an address anybody can type must not carry the answer key.
  // The question, its options and the client's look are shown; nothing says which option is right (not the state, not the word, not the tick).
  await expect(guest.page.locator('.pms-options button').first()).toBeVisible();
  expect(await guest.page.locator('.pms-options button').count(), 'the options are shown').toBeGreaterThan(1);
  await expect(guest.page.locator('[data-state="correct"], [data-state="incorrect"]'), 'and none is marked').toHaveCount(0);
  await expect(guest.page.locator('.pms-options .verdict'), 'no "Correct" word or tick').toHaveCount(0);
  await expect(guest.page.locator('.pms-options')).not.toContainText(/\bCorrect\b|\bIncorrect\b/);
  await guest.page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {})))); // the step fades in; shoot it settled
  await guest.page.screenshot({ path: `${(await import('./admin-local.js')).shots}brand-participant-preview-question.png` });
  // Every question of every activity, not just the first.
  for (let step = 0; step < 12 && await guest.page.getByRole('button', { name: 'Next', exact: true }).isEnabled(); step += 1) {
    await guest.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(guest.page.locator('[data-state="correct"], [data-state="incorrect"]')).toHaveCount(0);
  }
  await expect(guest.page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
  await guest.page.getByRole('button', { name: 'Back to activities' }).click();
  await expect(guest.page.locator('button.activity').first()).toBeVisible();
  expect(writes, 'nothing was written').toEqual([]);
  expect(guest.requests.some((entry) => entry.includes('appsettings')), 'and it never asked what is live').toBe(false);
  expect(await guest.page.evaluate(() => sessionStorage.length + localStorage.length), 'and kept nothing').toBe(0);
  expect((await ds.listClientTracks()).length, 'no visit was made').toBe(tracksBefore);
  await guest.page.screenshot({ path: `${(await import('./admin-local.js')).shots}brand-participant-preview-link.png` });
  // An unknown client says so.
  await guest.page.goto(`${participantUrl}?preview=c-nobody`);
  await expect(guest.page.getByRole('alert')).toContainText('There is no client "c-nobody"');
  await guest.context.close();
});

test('an answer tile\'s picture can be uploaded in Content: cropped to 480 x 320 under 60 KB, stored under <slug>-tile-<hash>, and tidied up when replaced or abandoned', async ({ page }) => {
  // Phase 10c-2a: tidying up never asks a list for the rows with one picture address (a column with no index).
  const byPicture: string[] = [];
  page.on('request', (request) => { if (/[?&]imageUrl=/i.test(request.url())) byPicture.push(request.url()); });
  await openAdmin(page, local, 'Content');
  await page.getByLabel('Client', { exact: true }).selectOption({ label: "Domino's" });
  await page.getByRole('button', { name: 'Add activity' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Which logo?');
  await page.getByRole('dialog').getByRole('button', { name: 'Add activity' }).click();
  await expect(page.locator('.content-activities > ul .activity__select .row__title').last()).toHaveText('Which logo?');
  await page.getByRole('button', { name: 'Add question' }).click();
  await page.getByLabel('Question', { exact: true }).fill('Which of these is the pizza logo?');
  await page.getByLabel('Option 1 text').fill('Alpha');
  await page.getByLabel('Option 2 text').fill('Bravo');
  await page.getByLabel('Layout').selectOption('image-grid');
  const option = (n: number) => page.locator(`.opt__upload[data-option="${n}"]`);
  await expect(option(1)).toContainText('480 × 320 px');
  await expect(option(1)).toContainText('3:2');
  await expect(option(1)).toContainText('up to 60 kb');

  const pick = async (n: number, buffer: Buffer, name = 'tile.png') => {
    await option(n).locator('input[type="file"]').setInputFiles({ name, mimeType: 'image/png', buffer });
    await expect(crop(page)).toBeVisible();
    await crop(page).getByRole('button', { name: 'Use this picture' }).click();
    await expect(crop(page)).toHaveCount(0);
  };
  await pick(1, await makeImage(page, { width: 900, height: 600, type: 'image/png', paint: 'logo' }));
  const first = page.getByLabel('Option 1 picture address');
  await expect(first).toHaveValue(/\/assets\/images\/clients\/dominos-tile-[0-9a-f]{10}\.(webp|png)$/);
  const firstUrl = await first.inputValue();
  await expect(page.locator('.opt__preview img').first()).toHaveJSProperty('complete', true);
  const size = await page.locator('.opt__preview img').first().evaluate(async (image: HTMLImageElement) => { const blob = await (await fetch(image.src)).blob(); const bitmap = await createImageBitmap(blob); return [bitmap.width, bitmap.height, blob.size]; });
  expect(size.slice(0, 2)).toEqual([480, 320]);
  expect(size[2]).toBeLessThanOrEqual(60 * 1024);
  expect(await uploads()).toEqual([path.basename(firstUrl)]);
  // A second picture for the same option replaces the first (which was only this editing session's): the first is removed at once.
  await pick(1, await makeImage(page, { width: 900, height: 600, type: 'image/png', paint: 'photo' }), 'tile-2.png');
  await expect(first).not.toHaveValue(firstUrl);
  const secondUrl = await first.inputValue();
  await expect.poll(uploads).toEqual([path.basename(secondUrl)]);
  // A pasted link is still allowed.
  await page.getByLabel('Option 2 picture address').fill('https://img.test/bravo.svg');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  const section = (await ds.listClientSections('c-dominos')).find((entry: { title: string }) => entry.title === 'Which logo?');
  const question = await ds.getQuestion(section.questionIds[0]);
  const stored = await Promise.all(question.optionIds.map((id: string) => ds.getOption(id)));
  expect(stored.map((entry: { imageUrl?: string | null }) => entry.imageUrl)).toEqual([secondUrl, 'https://img.test/bravo.svg']);
  expect(await uploads()).toEqual([path.basename(secondUrl)]);

  // Replace it on a saved question: the old file goes after the save. Cancelling an upload removes it.
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await pick(1, await makeImage(page, { width: 900, height: 600, type: 'image/png', paint: 'marker' }), 'tile-3.png');
  await expect(first).not.toHaveValue(secondUrl);
  const thirdUrl = await first.inputValue();
  await expect.poll(async () => (await uploads()).length).toBe(2);
  expect((await uploads()).sort()).toEqual([path.basename(secondUrl), path.basename(thirdUrl)].sort());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(uploads).toEqual([path.basename(secondUrl)]);
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await pick(1, await makeImage(page, { width: 900, height: 600, type: 'image/png', paint: 'marker' }), 'tile-3.png');
  await expect(first).not.toHaveValue(secondUrl);
  const fourthUrl = await first.inputValue();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  await expect.poll(uploads).toEqual([path.basename(fourthUrl)]);
  expect(await ds.getOption(question.optionIds[0])).toMatchObject({ imageUrl: fourthUrl });
  // A duplicate of the activity shows the same file: replacing the picture here must leave the file for the duplicate.
  expect((await ds.duplicateActivity(section.id)).copied).toHaveLength(1);
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await pick(1, await makeImage(page, { width: 900, height: 600, type: 'image/png', paint: 'logo' }), 'tile-5.png');
  await expect(first).not.toHaveValue(fourthUrl);
  const fifthUrl = await first.inputValue();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Saved');
  expect(await ds.getOption(question.optionIds[0])).toMatchObject({ imageUrl: fifthUrl });
  // Give the tidy-up time to have removed it, had it been going to: it reads, and only then removes.
  await page.waitForTimeout(600);
  expect((await uploads()).sort(), 'the file the duplicate shows is still there').toEqual([path.basename(fourthUrl), path.basename(fifthUrl)].sort());
  expect(byPicture, 'no read filtered on a picture address').toEqual([]);
  // A refused picture shows its reason beside the option, not as a crash.
  await page.locator('.content-detail .row').filter({ hasText: 'pizza logo' }).getByRole('button', { name: 'Edit' }).click();
  await option(2).locator('input[type="file"]').setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: SVG });
  await expect(option(2).getByRole('alert')).toContainText('SVG drawings are not accepted');
});
