import type { Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as dataService from '../../public/js/dataService.js';
import { samplePack } from '../../migration/src/lib/sample-clients.js';
import { seedPack } from '../../migration/src/lib/seed.js';
import { createSharePointFake } from '../sharepoint-fake.js';

// Runs a BUILT page in SharePoint mode: the page is served at an https address inside a site (which
// is what makes it a SharePoint page since Phase 10b), its settings file pms-config.txt is served
// beside it, and every /_api request is answered by the in-memory fake in scripts/sharepoint-fake.js.
// Nothing reaches a real tenant, and any request to anywhere else is recorded as unexpected and dropped.

export const SITE = 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE';
export const pageUrl = (file: string) => `${SITE}/Shared%20Documents/staging-test/${file}`;
export type Fake = ReturnType<typeof createSharePointFake>;
const PAGES = ['index.html', 'admin.html', 'setup.html'];

/**
 * What the site serves as pms-config.txt: an object (sent as JSON), `null` for no file at all (HTTP 404), or a function that
 * answers the request itself (a 503, a sign-in page, broken JSON).
 */
export type SettingsFile = Record<string, unknown> | null | ((route: Route) => Promise<unknown> | unknown);
/**
 * The file a test site has unless a test says otherwise: the prefix of that site's own lists, said on purpose, and an empty one for
 * the lists with nothing in front of their names (`newFake()`). Never left out: a page with no prefix from anywhere stops.
 */
export const settingsOf = (fake: Fake): SettingsFile => ({ configVersion: 1, listPrefix: fake.prefix });
const RELEASE = path.join(import.meta.dirname, '..', '..', 'build-svelte', 'release');

export const newFake = (options: Parameters<typeof createSharePointFake>[0] = {}) => createSharePointFake({ ...options, siteUrl: SITE });

/**
 * Runs `work` with the data service pointed at the fake from this (Node) process: how a test puts
 * records on the "site" the same way the app would, before the page under test is opened.
 */
export async function onSite<T>(fake: Fake, work: (ds: typeof dataService) => Promise<T>): Promise<T> {
  const restore = fake.install();
  try {
    dataService.configure({ sharePoint: fake.settings });
    return await work(dataService);
  } finally {
    restore();
    dataService.configure({ baseUrl: '/api' });
  }
}

/** Both sample clients on the site, with `clientId` live for `date`. Resolves to the live session. */
export const seedAndGoLive = (fake: Fake, clientId = 'c-kroger', date = '2026-10-11') => onSite(fake, async (ds) => {
  await seedPack(ds, samplePack());
  return (await ds.activateClient(clientId, date)).session as { id: string; clientId: string; sectionIds: string[] };
});

/**
 * `latencyMs`: every REST request is answered that much later (a slow site); the pages themselves are not held.
 * `settings`: the site's pms-config.txt. `served.settings` can be changed while the page is open (a file that is put right), and
 * `served.settingsFile` counts how many times the file was asked for.
 * `pages`: the folder the three built pages are read from, when it is not the release candidate (pages built with values inside them).
 */
export async function serveSharePoint(page: Page, fake: Fake, { latencyMs = 0, settings = settingsOf(fake), pages = RELEASE }: { latencyMs?: number; settings?: SettingsFile; pages?: string } = {}) {
  const served = { unexpected: [] as string[], pictures: [] as string[], settings, settingsFile: 0 };
  const origin = new URL(SITE).origin;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const file = PAGES.find((name) => `${url.origin}${url.pathname}` === pageUrl(name));
    if (file) {
      const body = await readFile(path.join(pages, file), 'utf8');
      return route.fulfill({ contentType: 'text/html', body });
    }
    if (`${url.origin}${url.pathname}` === pageUrl('pms-config.txt')) {
      served.settingsFile += 1;
      if (typeof served.settings === 'function') return served.settings(route);
      if (served.settings === null) return route.fulfill({ status: 404, contentType: 'text/html', body: '<html><body>404 NOT FOUND</body></html>' });
      return route.fulfill({ contentType: 'text/plain; charset=utf-8', body: JSON.stringify(served.settings) });
    }
    // (SharePoint does not tell upper case from lower in an address, so neither does this: a site spelled in another case in the settings still reaches it.)
    if (url.origin === origin && url.pathname.toLowerCase().startsWith('/sites/creativeexpcoe/_api/')) {
      if (latencyMs) await new Promise((resolve) => { setTimeout(resolve, latencyMs); });
      const reply = await fake.handle({ method: request.method(), url: request.url(), headers: request.headers(), body: request.postData(), bodyBuffer: request.postDataBuffer() ?? undefined });
      return route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
    }
    // A picture in the ClientLogos library, read back the way a browser reads an <img>: with the page's own sign-in.
    if (url.origin === origin && url.pathname.startsWith(`${fake.libraryFolder}/`)) {
      const file = fake.file(decodeURIComponent(url.pathname));
      served.pictures.push(url.pathname);
      if (!file) return route.fulfill({ status: 404, body: 'Not found' });
      return route.fulfill({ status: 200, contentType: file.type, body: Buffer.from(file.bytes) });
    }
    served.unexpected.push(url.href);
    return route.abort();
  });
  return served;
}

/** `GET clients`, `MERGE responses`, `POST /contextinfo`: one request of the fake's log, in words (a list by its key). */
export const shape = (entry: { method: string; list: string | null; path: string }) => `${entry.method} ${entry.list ?? entry.path.split('/_api')[1]}`;

/**
 * Stamps the moment an element first appears, in the page's own clock, so requests can be split
 * into those the first screen waited for and those sent once it was up. Call before page.goto().
 */
export async function stampFirstAppearance(page: Page, selector: string) {
  await page.addInitScript((target) => {
    const look = () => {
      if ((window as unknown as { firstScreenAt?: number }).firstScreenAt === undefined && document.querySelector(target)) {
        (window as unknown as { firstScreenAt?: number }).firstScreenAt = Date.now();
      }
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
    look();
  }, selector);
  return () => page.evaluate(() => (window as unknown as { firstScreenAt?: number }).firstScreenAt ?? null);
}
