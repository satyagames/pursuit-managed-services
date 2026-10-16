import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SAMPLE_PICTURES } from '../../migration/src/lib/sample-pictures.js';
import { seedSampleClients } from '../../migration/src/lib/sample-seed.js';
import { another, ds, openAdmin, participantUrl, startLocal, stopLocal, today, type Local } from './admin-local.js';
import { newFake, onSite, pageUrl, serveSharePoint } from './sharepoint.js';

// Phase 10f: the sample clients have VJR's pictures (a logo, a hero and a background each), stored as Brand Studio stores them. On the local
// server they are in server/data and its uploads, so a participant sees them and Brand Studio opens with them. On SharePoint "Seed sample
// clients" puts them in the picture library first, and a participant's page then loads them from there, like any client's pictures.

const SLOTS = ['hero', 'logo', 'background'] as const;
const PICTURES = path.join(import.meta.dirname, '..', '..', 'migration', 'src', 'assets', 'sample-pictures');
const CLIENTS = [{ id: 'c-kroger', name: 'Kroger' }, { id: 'c-dominos', name: "Domino's" }] as const;
const nameOf = (src: string | null) => decodeURIComponent(String(src).split('/').pop() ?? '');

/** The Welcome screen's hero badge and background, once both have loaded: their addresses and natural sizes. */
async function welcomePictures(page: Page) {
  await expect(page.locator('.pms-hero-box')).toHaveAttribute('data-badge', 'ready', { timeout: 15_000 });
  await expect(page.locator('.shell')).toHaveAttribute('data-background', 'ready', { timeout: 15_000 });
  return page.evaluate(() => {
    const hero = document.querySelector<HTMLImageElement>('img.pms-badge')!;
    const background = document.querySelector<HTMLImageElement>('.shell > img')!;
    return {
      hero: { src: hero.currentSrc, width: hero.naturalWidth, height: hero.naturalHeight, alt: hero.alt },
      background: { src: background.currentSrc, width: background.naturalWidth, height: background.naturalHeight },
    };
  });
}

test.describe('on the local server (server/data and its uploads)', () => {
  let local: Local;
  test.beforeEach(async () => { local = await startLocal(); });
  test.afterEach(async () => { await stopLocal(local); });

  for (const client of CLIENTS) {
    test(`a participant sees the hero and the background of ${client.name} on Welcome`, async ({ browser }) => {
      await ds.activateClient(client.id, today);
      const guest = await another(browser, local);
      await guest.page.goto(participantUrl);
      const shown = await welcomePictures(guest.page);
      const pictures = SAMPLE_PICTURES[client.id];
      expect(nameOf(shown.hero.src)).toBe(pictures.hero.name);
      expect([shown.hero.width, shown.hero.height]).toEqual([pictures.hero.width, pictures.hero.height]);
      expect(shown.hero.alt).toBe(client.name);
      expect(nameOf(shown.background.src)).toBe(pictures.background.name);
      expect([shown.background.width, shown.background.height]).toEqual([pictures.background.width, pictures.background.height]);
      await expect(guest.page.getByRole('button', { name: 'Click here to begin' })).toBeVisible();
      await guest.context.close();
    });
  }

  test('Brand Studio opens with each sample client\'s three pictures, saved, and Today no longer says the logo is missing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const client of CLIENTS) {
      await openAdmin(page, local, 'Clients');
      await page.locator('.row').filter({ hasText: client.name }).getByRole('button', { name: 'Brand' }).click();
      await expect(page.getByRole('heading', { name: new RegExp(`Brand Studio · ${client.name}`) })).toBeVisible();
      for (const slot of SLOTS) {
        const card = page.locator(`section.asset[data-slot="${slot}"]`);
        await expect(card.getByTestId(`${slot}-status`)).toHaveText('Saved');
        const image = card.locator('img').first();
        await expect(image).toHaveAttribute('src', new RegExp(`/${SAMPLE_PICTURES[client.id][slot].name.replace('.', '\\.')}$`));
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { message: `${client.name} ${slot} loads` }).toBe(SAMPLE_PICTURES[client.id][slot].width);
      }
      await page.goto('about:blank');
    }
    // Today, with Kroger picked: readiness says nothing about a logo.
    await openAdmin(page, local);
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Kroger' });
    await expect(page.getByRole('button', { name: /^Go live$/ })).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/has no logo or hero image/)).toHaveCount(0);
  });
});

test.describe('on SharePoint (mocked REST)', () => {
  // (Not in WebKit: Playwright's WebKit does not hand a route the body of a request whose body is a Blob, so the fake stores each picture empty.
  // migration/playwright.config.ts says so; the next test, which seeds from this process, shows WebKit reading the pictures from the library.)
  test('Seed sample clients puts the six pictures in the library first, byte for byte; a second seed sends none', async ({ page }) => {
    const fake = newFake();
    const served = await serveSharePoint(page, fake);
    await page.goto(pageUrl('setup.html'));
    await page.getByRole('button', { name: 'Check Lists' }).click();
    await expect(page.getByTestId('lists-status')).toContainText('All list schemas ready');
    const samples = page.getByRole('region', { name: 'Sample clients' });
    page.once('dialog', (dialog) => void dialog.accept());
    await samples.getByRole('button', { name: 'Seed sample clients' }).click();
    await expect(samples.getByRole('status')).toHaveText('Complete: 76 created, 0 completed, 0 already present. Pictures: 6 uploaded, 0 already in the library.', { timeout: 30_000 });
    await expect(samples.getByRole('list', { name: 'Seeding progress' }).getByText(/: Uploaded$/)).toHaveCount(6);
    for (const client of CLIENTS) {
      const theme = JSON.parse(String(fake.item('clients', client.id)!.ThemeJson));
      for (const slot of SLOTS) {
        const name = SAMPLE_PICTURES[client.id][slot].name;
        expect(theme.assets[slot]).toBe(new URL(`${fake.libraryFolder}/${name}`, fake.settings.siteUrl).href);
        const stored = fake.file(`${fake.libraryFolder}/${name}`);
        expect(Buffer.from(stored!.bytes).equals(await readFile(path.join(PICTURES, name))), `${name} arrived whole`).toBe(true);
      }
    }
    expect(fake.files.size).toBe(6);

    // Seeding again uploads nothing and writes nothing.
    fake.reset();
    page.once('dialog', (dialog) => void dialog.accept());
    await samples.getByRole('button', { name: 'Seed sample clients' }).click();
    await expect(samples.getByRole('status')).toHaveText('Complete: 0 created, 0 completed, 76 already present.');
    expect(fake.count((entry) => entry.method !== 'GET'), 'the second run writes nothing').toBe(0);
    expect(fake.count((entry) => entry.path.includes('/Files')), 'and neither reads nor sends a picture').toBe(0);
    expect(served.unexpected).toEqual([]);
  });

  test('a participant on its own device sees Kroger\'s pictures, read from the library with its own sign-in', async ({ page }) => {
    const fake = newFake();
    // Seeded as Setup seeds (lib/sample-seed.js), from this process.
    await onSite(fake, async (data) => {
      await seedSampleClients(data, { file: async (name: string, type: string) => new Blob([await readFile(path.join(PICTURES, name))], { type }), siteUrl: fake.settings.siteUrl });
      await data.activateClient('c-kroger', '2026-10-14');
    });
    const seen = await serveSharePoint(page, fake);
    await page.goto(pageUrl('index.html'));
    const shown = await welcomePictures(page);
    expect(nameOf(shown.hero.src)).toBe(SAMPLE_PICTURES['c-kroger'].hero.name);
    expect([shown.hero.width, shown.hero.height]).toEqual([1200, 1200]);
    expect(nameOf(shown.background.src)).toBe(SAMPLE_PICTURES['c-kroger'].background.name);
    expect(seen.pictures.map((address) => address.split('/').pop())).toEqual(expect.arrayContaining([SAMPLE_PICTURES['c-kroger'].hero.name, SAMPLE_PICTURES['c-kroger'].background.name]));
    expect(seen.unexpected).toEqual([]);
  });
});
