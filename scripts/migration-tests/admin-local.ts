import { expect, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from '../free-port.js';
import * as ds from '../../migration/src/lib/data/dataService.js';
import { localDate } from '../../migration/src/lib/admin/admin-today.js';
import { SAMPLE_PICTURE_NAMES } from '../../migration/src/lib/setup/sample-pictures.js';
import { sharePointFolderPath } from '../deployment-config.js';

// What the Phase 5b specs share: the BUILT admin and participant pages against the REAL local server
// (server/index.js) on a scratch copy of server/data, one server per test, so no test inherits
// another's clients, activities, guests or answers. Uploads go to the scratch folder too: a test run
// leaves nothing in public/ or server/data/.

export const root = fileURLToPath(new URL('../..', import.meta.url));
export const shots = fileURLToPath(new URL('../../test-results/admin/', import.meta.url));
export const adminUrl = `${sharePointFolderPath}/admin.html`;
export const participantUrl = `${sharePointFolderPath}/index.html`;
export const today = localDate();
export const PIN = '1234'; // server/data/adminusers.json

export type Local = { api: string; dir: string; server: ChildProcess };

// The tests also talk to the server from this process (through dataService, to set up and to check). A request that fails with "other side closed"
// used to be sent again, up to four times (Phase 7c added that, and a sequential port, because a different unrelated spec failed in each full run).
// Phase 8 found what it really was and took the retry out: the port. The scratch server was given a port from 5200-5599 and 5432 is in that range,
// where PostgreSQL listens, so every request to it was closed by PostgreSQL (scripts/free-port.js says how). The OS now picks a free port, and a
// request that still fails this way fails the test at once; it also says what it was in test-results/.stale-socket.log, so that if anything
// else ever causes it, the cause is in front of us and not hidden by a retry.
const nodeFetch = globalThis.fetch;
const staleLog = fileURLToPath(new URL('../../test-results/.stale-socket.log', import.meta.url));
globalThis.fetch = async (input, init) => {
  try {
    return await nodeFetch(input, init);
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code === 'UND_ERR_SOCKET' || /other side closed/i.test(cause?.message ?? '')) {
      const url = new URL(String(typeof input === 'object' && 'url' in input ? input.url : input));
      try { appendFileSync(staleLog, `${new Date().toISOString()} ${init?.method ?? 'GET'} ${url.host}${url.pathname} code=${cause?.code} message="${cause?.message}"\n`); } catch { /* the folder may not exist yet */ }
    }
    throw error;
  }
};

export async function startLocal(): Promise<Local> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cec-admin-5b-'));
  await cp(path.join(root, 'server', 'data'), dir, { recursive: true });
  // The local server's uploads hold the sample clients' pictures, which server/data points at (Phase 10f). The scratch server's uploads do too, so
  // a test that replaces one in Brand Studio removes the scratch copy, as on the real server, and never the file in public/.
  await mkdir(path.join(dir, 'uploads'), { recursive: true });
  for (const name of SAMPLE_PICTURE_NAMES) await copyFile(path.join(root, 'public', 'assets', 'images', 'clients', name), path.join(dir, 'uploads', name));
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, UPLOAD_DIR: path.join(dir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
    server.stdout!.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  const local = { api: `http://127.0.0.1:${port}`, dir, server };
  // Is it our server that answers on that port? (If something else did, say so, rather than let a test fail on a closed connection.)
  const hello = await nodeFetch(`${local.api}/api/clients`).catch((error) => { server.kill(); throw new Error(`The scratch server started on port ${port} does not answer there (${(error as Error).cause ?? error}): is another program using that port?`); });
  if (!hello.ok || !/json/.test(hello.headers.get('content-type') ?? '')) { server.kill(); throw new Error(`Something other than the scratch server answers on port ${port} (HTTP ${hello.status}).`); }
  ds.configure({ baseUrl: `${local.api}/api` });
  await mkdir(shots, { recursive: true });
  return local;
}

export async function stopLocal(local: Local | undefined) {
  local?.server.kill();
  ds.configure({ baseUrl: '/api' });
  if (local) await rm(local.dir, { recursive: true, force: true });
}

/** Sends a page's /api requests to this test's server, and keeps a list of them. */
export async function useServer(page: Page, local: Local) {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname.replace('/api/', '')}${url.search}`);
    // A page that outlives its test may ask once more after the server has gone: let it fail, not the test.
    const response = await route.fetch({ url: `${local.api}${url.pathname}${url.search}` }).catch(() => null);
    // (A page that is closing may take the answer back before it is delivered: not a failure of the test.)
    if (response) await route.fulfill({ response }).catch(() => {});
    else await route.abort().catch(() => {});
  });
  return requests;
}

/** Pictures Brand Studio uploaded live in the scratch server's UPLOAD_DIR; a page asks for them at /assets/images/clients/, as it would on the real server. */
export async function servePictures(page: Page, local: Local) {
  await page.route('**/assets/images/clients/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${local.api}${url.pathname}` }).catch(() => null);
    // (A page that is closing may take the answer back before it is delivered: not a failure of the test.)
    if (response) await route.fulfill({ response }).catch(() => {});
    else await route.abort().catch(() => {});
  });
}

export async function openAdmin(page: Page, local: Local, tab?: string) {
  const requests = await useServer(page, local);
  await servePictures(page, local);
  await page.goto(adminUrl);
  await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  if (tab) await page.getByRole('tab', { name: tab, exact: true }).click();
  return requests;
}

/** A participant (or a second admin) in a browser of its own. */
export async function another(browser: Browser, local: Local) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = await useServer(page, local);
  await servePictures(page, local);
  return { context, page, requests };
}

export const shoot = async (page: Page, name: string, { full = true } = {}) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${shots}${name}.png`, fullPage: full });
};

export const activityRow = (page: Page, id: string) => page.locator(`[data-activity="${id}"]`);
export const pickClient = (page: Page, name: string) => page.getByLabel('Client', { exact: true }).selectOption({ label: name });
export const activityTitles = (page: Page) => page.locator('.content-activities > ul .activity__select .row__title');

/** A settled answer to each question, as a participant's device saves it. */
export async function answerQuestions(trackId: string, sessionId: string, clientId: string, questionIds: string[]) {
  await ds.saveParticipantResponses({
    trackId, sessionId, clientId,
    responses: questionIds.map((questionId) => ({ questionId, answer: 'x', firstAnswer: 'x', attempts: 1, correct: null, answeredAt: new Date().toISOString() })),
  });
}

/** An activity that carries its client, with questions and options: what the Content screen makes. */
let sequence = 0;
export async function addActivity(clientId: string, {
  title = 'Basics', enabled = true, questions = [{ prompt: 'Which year was it founded?', options: [['1901', true], ['1950', false]] }],
}: { title?: string; enabled?: boolean; questions?: { prompt: string; type?: string; layout?: string; options: [string, boolean | null, string?][] }[] } = {}) {
  const id = `act-${clientId}-${sequence += 1}`;
  const questionIds: string[] = [];
  for (const [index, question] of questions.entries()) {
    const questionId = `${id}-q${index}`;
    const optionIds: string[] = [];
    for (const [position, [label, correct, imageUrl]] of question.options.entries()) {
      const optionId = `${questionId}-o${position}`;
      await ds.createOption({ id: optionId, questionId, label, value: label, correct, ...(imageUrl ? { imageUrl } : {}) });
      optionIds.push(optionId);
    }
    await ds.createQuestion({ id: questionId, sectionId: id, type: question.type ?? 'single-select', prompt: question.prompt, optionIds, order: index, ...(question.layout ? { layout: question.layout } : {}) });
    questionIds.push(questionId);
  }
  await ds.createSection({ id, title, order: sequence, enabled, industryTags: [], questionIds, clientId, description: '' });
  return id;
}

/** Everything a page shows must fit 44px targets and no sideways scroll; names what breaks. */
export async function expectFits(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal page scroll`).toBe(true);
  const small = await page.evaluate(() => {
    const clickable = [...document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type="hidden"]):not([type="file"]), textarea, summary, [role="tab"]')];
    return clickable
      // A check box, radio or switch is operated through its label; a hidden input is not a target at all.
      .map((element) => (element.matches('input[type="radio"], input[type="checkbox"]') ? element.closest('label') ?? element : element))
      .filter((element, index, all) => all.indexOf(element) === index)
      // Inside a closed dialog or a hidden panel nothing is on screen to be tapped.
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({ name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 32), box: element.getBoundingClientRect(), hidden: getComputedStyle(element).visibility === 'hidden' }))
      .filter(({ box, hidden }) => !hidden && box.width > 2 && box.height > 2 && (box.width < 43.5 || box.height < 43.5))
      .map(({ name, box }) => `${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  });
  expect(small, `${label}: targets under 44px`).toEqual([]);
}

export const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const;

export { ds };
