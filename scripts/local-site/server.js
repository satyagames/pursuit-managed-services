// The local stand-in for the PCOE SharePoint site (Phase 12). Development only: no page imports it and the release package never holds it.
//
//   npm run local:site                         the newest release package's pages, scenario "ready", PCOE's latency
//   npm run local:site -- --scenario event-day --latency slow --open
//   npm run local:site -- --package build-svelte/package/pms-21462b6 --fresh
//
// It serves, over HTTPS at https://pms-local.test/sites/PCOE/Shared%20Documents/PMS/, the three pages and pms-config.txt of a release package byte
// for byte (the files that would be uploaded), the site's REST API at /sites/PCOE/_api from the mocked SharePoint of scripts/sharepoint-fake.js
// (its engine, behind real HTTP), and the picture library's files. What SharePoint does that the mock alone does not is added here, each with a test
// (scripts/test-local-site.js): a .json file in a document library comes back as SharePoint's "File Not Found" page with a success status, a
// write after the write token has expired is refused once with "security validation", an address too long is refused, PMSAdminUsers is readable by
// admins only, latency like PCOE's, and faults on demand. The data is kept in scripts/local-site/data/<scenario>/state.json after every write.
//
// The host name pms-local.test is not in any DNS: `--open` starts Playwright's own Chromium with it mapped to this server (and this server's own
// certificate accepted), touching nothing else on the machine. LOCAL-SITE.md has the other ways.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { ACCESS_DENIED } from '../sharepoint-fake.js';
import { SETTINGS_TEXT } from '../release-docs.js';
import { controlPage } from './control-page.js';
import { buildScenario, SCENARIOS } from './scenarios.js';
import { asking, DEFAULT_PORT, FOLDER_PATH, HOST, makeFake, NOW, ORIGIN, pageUrl, PERSONA_COOKIE, PERSONAS, personaFromCookie, SITE_PATH } from './site-shape.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
export const DATA = path.join(HERE, 'data');
const CERT = path.join(HERE, '.cert');
const PAGES = ['index.html', 'admin.html', 'setup.html'];

/** Latency profiles, per API request: PCOE measured about 350 ms with no throttling; "slow" is an iPad on a bad network. */
export const LATENCY = Object.freeze({ none: { ms: 0, jitter: 0 }, pcoe: { ms: 350, jitter: 60 }, slow: { ms: 1500, jitter: 200 } });
/** The longest query string the site accepts (ASSUMED: ASP.NET's default maxQueryStringLength; not measured on PCOE). */
export const MAX_QUERY = 2048;
export const QUERY_TOO_LONG = 'The length of the query string for this request exceeds the configured maxQueryStringLength value.';
/** SharePoint's words when the write token (the form digest) has expired: the data layer gets a new one and tries once more. */
export const DIGEST_EXPIRED = 'The security validation for this page is invalid and might be corrupted. Please use your web browser\'s Back button to try your operation again.';
/** What SharePoint answers for a file of a document library it will not hand out (PCOE, 14 Oct 2026: a .json), with status 200. */
export const FILE_NOT_FOUND_PAGE = '<!DOCTYPE html><html><head><title>Error</title></head><body><div id="ms-error-header"><h1>Sorry, something went wrong</h1></div><div id="ms-error"><p>File Not Found.</p></div></body></html>';
/** The faults the `chaos` scenario answers in turn, one every CHAOS_EVERY API requests. */
export const CHAOS = Object.freeze([{ status: 429, retryAfter: 2 }, { status: 503, retryAfter: 1 }, { status: 500 }, { drop: true }, { digest: true }]);
export const CHAOS_EVERY = 6;

/** The pages to serve: a package folder (`--package`), else the newest build-svelte/package/pms-<commit>/, else build-svelte/release. */
export function findPages(wanted) {
  if (wanted) return { dir: path.resolve(wanted), name: path.basename(path.resolve(wanted)) };
  const base = path.join(ROOT, 'build-svelte', 'package');
  const folders = existsSync(base) ? readdirSync(base).filter((name) => /^pms-[0-9a-f]{7}$/.test(name)).map((name) => ({ name, at: statSync(path.join(base, name)).mtimeMs })) : [];
  const newest = folders.sort((a, b) => b.at - a.at)[0];
  if (newest) return { dir: path.join(base, newest.name), name: newest.name };
  const release = path.join(ROOT, 'build-svelte', 'release');
  if (existsSync(path.join(release, 'index.html'))) return { dir: release, name: 'build-svelte/release (a build of the working tree: its Build line on Setup says which commit)' };
  throw new Error('There are no pages to serve: run `npm run package:release` (or `npm run build:svelte:release`) first, or pass --package <folder>.');
}

/** A certificate for pms-local.test, made once with openssl (Git for Windows, macOS and Linux have it) and kept in scripts/local-site/.cert. */
export function certificate() {
  const key = path.join(CERT, 'key.pem');
  const cert = path.join(CERT, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(CERT, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '825', '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Starts the local site. Resolves to { port, origin, site, close }; `site` is the running state the control page and the tests drive.
 * @param {{ port?: number, scenario?: string, packageDir?: string, latency?: keyof typeof LATENCY, fresh?: boolean, dataDir?: string, persist?: boolean, freeze?: boolean, quirks?: boolean }} [options]
 *   `quirks: false` turns off what this server adds to the mock (the .json page, the expired token, the query limit, PMSAdminUsers for admins only):
 *   the tests use it to show that each of their checks can fail.
 */
export async function startLocalSite({ port = DEFAULT_PORT, scenario = 'ready', packageDir, latency = 'pcoe', fresh = false, dataDir = DATA, persist = true, freeze = false, quirks = true } = {}) {
  const pages = findPages(packageDir);
  const settingsText = existsSync(path.join(pages.dir, 'pms-config.txt')) ? readFileSync(path.join(pages.dir, 'pms-config.txt'), 'utf8') : SETTINGS_TEXT;
  const site = {
    pages, settingsText, scenario, latency, persist, freeze, quirks, fake: null, extras: { notes: [], reveals: [], guests: [] },
    faults: [], offline: false, digestExpired: false, chaos: false, apiCount: 0, log: [], saving: null,
  };

  const stateFile = (name) => path.join(dataDir, name, 'state.json');
  const extrasFile = (name) => path.join(dataDir, name, 'extras.json');
  function save() {
    if (!site.persist) return;
    clearTimeout(site.saving);
    site.saving = setTimeout(() => {
      const file = stateFile(site.scenario);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(site.fake.exportState()));
      renameSync(`${file}.tmp`, file);
    }, 150);
  }
  /** Loads a scenario: its saved state, or (the first time, or with `rebuild`) a fresh build of it. */
  async function load(name, { rebuild = false } = {}) {
    if (!(name in SCENARIOS)) throw new Error(`No scenario "${name}".`);
    let state;
    let extras;
    if (!rebuild && site.persist && existsSync(stateFile(name)) && existsSync(extrasFile(name))) {
      state = JSON.parse(readFileSync(stateFile(name), 'utf8'));
      extras = JSON.parse(readFileSync(extrasFile(name), 'utf8'));
    } else {
      ({ state, extras } = await buildScenario(name));
      if (site.persist) {
        mkdirSync(path.dirname(stateFile(name)), { recursive: true });
        writeFileSync(stateFile(name), JSON.stringify(state));
        writeFileSync(extrasFile(name), JSON.stringify(extras, null, 2));
        if (extras.reveals?.length) writeFileSync(path.join(dataDir, name, 'reveals.json'), JSON.stringify(extras.reveals, null, 2));
      }
    }
    const fake = makeFake({ now: () => (site.freeze ? NOW : new Date().toISOString()) });
    fake.importState(state);
    // PMSAdminUsers is readable by admins only (PCOE's permissions plan): anyone else gets SharePoint's 403, in a $batch part too.
    if (site.quirks) fake.failNext({ status: 403, times: Infinity, message: ACCESS_DENIED, when: (entry) => entry.list === 'adminusers' && !PERSONAS[asking.getStore() ?? 'admin'].admin });
    Object.assign(site, { fake, extras, scenario: name, chaos: Boolean(extras.chaos), faults: [], offline: false, digestExpired: false, apiCount: 0 });
  }
  site.load = load;
  site.reset = () => load(site.scenario, { rebuild: true });
  await load(scenario, { rebuild: fresh });

  /** One fault from the queue or the chaos rota, for this API request, or null. */
  function faultFor(entryIsWrite) {
    if (site.chaos && site.apiCount % CHAOS_EVERY === 0) {
      const due = CHAOS[(site.apiCount / CHAOS_EVERY - 1) % CHAOS.length];
      if (!due.digest || entryIsWrite) return due;
    }
    const queued = site.faults.find((fault) => fault.times > 0 && (!fault.writesOnly || entryIsWrite));
    if (queued) { queued.times -= 1; return queued; }
    return null;
  }

  /** Sends a body as SharePoint does: gzip when the browser accepts it and the body is worth it. */
  const send = (request, response, status, headers, payload) => {
    const zipped = payload.length > 1024 && /gzip/.test(request.headers['accept-encoding'] ?? '');
    const out = zipped ? gzipSync(payload) : payload;
    response.writeHead(status, { ...headers, ...(zipped ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': out.length }).end(out);
  };
  const json = (response, status, data, headers = {}) => {
    const body = Buffer.from(JSON.stringify(data));
    response.writeHead(status, { 'Content-Type': 'application/json;odata=verbose;charset=utf-8', 'Content-Length': body.length, ...headers }).end(body);
  };
  const spError = (response, status, message, headers) => json(response, status, { error: { code: '-2147024891, System.UnauthorizedAccessException', message: { lang: 'en-US', value: message } } }, headers);

  async function api(request, response, url, body) {
    const persona = personaFromCookie(request.headers.cookie);
    const started = Date.now();
    const method = request.headers['x-http-method'] ?? request.method;
    const isWrite = method !== 'GET' && !/\/(contextinfo|\$batch)$/.test(url.pathname);
    site.apiCount += 1;
    const logEntry = { at: new Date().toISOString(), persona, method, path: decodeURIComponent(url.pathname.slice(SITE_PATH.length)), query: decodeURIComponent(url.search).slice(0, 300), status: 0, ms: 0 };
    site.log.push(logEntry);
    if (site.log.length > 5000) site.log.splice(0, site.log.length - 5000);
    const { ms, jitter } = LATENCY[site.latency] ?? LATENCY.none;
    if (ms) await wait(ms + Math.round((Math.random() * 2 - 1) * jitter));
    const finish = (status) => { logEntry.status = status; logEntry.ms = Date.now() - started; };
    if (site.offline) { finish('offline'); request.socket.destroy(); return; }
    if (site.quirks && url.search.length - 1 > MAX_QUERY) { finish(400); spError(response, 400, QUERY_TOO_LONG); return; }
    if (/\/contextinfo$/.test(url.pathname)) site.digestExpired = false;
    const fault = faultFor(isWrite);
    if (fault?.drop) { finish('dropped'); request.socket.destroy(); return; }
    if (fault?.digest || (site.quirks && isWrite && site.digestExpired)) {
      site.digestExpired = false;
      finish(403);
      spError(response, 403, DIGEST_EXPIRED);
      return;
    }
    if (fault) {
      finish(fault.status);
      spError(response, fault.status, fault.message ?? `The local site answered ${fault.status} on purpose.`, fault.retryAfter === undefined ? {} : { 'Retry-After': String(fault.retryAfter) });
      return;
    }
    const reply = await asking.run(persona, () => site.fake.handle({
      method: request.method, url: `${ORIGIN}${url.pathname}${url.search}`, headers: request.headers,
      body: body.length ? body.toString('utf8') : null, bodyBuffer: body.length ? body : undefined,
    }));
    const payload = Buffer.from(reply.body ?? '');
    finish(reply.status);
    const last = site.fake.requests.at(-1);
    if (last?.parts) logEntry.parts = last.parts.map((part) => `${part.list ?? ''} ${decodeURIComponent(new URL(part.url).pathname).replace(/^.*_api/, '')}`);
    if (reply.status === 204) response.writeHead(204, reply.headers).end();
    else send(request, response, reply.status, reply.headers, payload);
    if (request.method !== 'GET' && reply.status < 300) save();
  }

  const handler = async (request, response) => {
    const url = new URL(request.url ?? '/', ORIGIN);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    try {
      if (url.pathname === '/__local' || url.pathname.startsWith('/__local/')) {
        await controlPage({ site, request, response, url, body });
        return;
      }
      if (url.pathname.toLowerCase().startsWith(`${SITE_PATH.toLowerCase()}/_api/`)) {
        await api(request, response, url, body);
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      const folder = decodeURIComponent(FOLDER_PATH);
      if (decoded.startsWith(folder)) {
        const name = decoded.slice(folder.length);
        if (PAGES.includes(name)) {
          const file = readFileSync(path.join(site.pages.dir, name));
          send(request, response, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=0' }, file);
        } else if (name === 'pms-config.txt') {
          const file = Buffer.from(site.settingsText);
          response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': file.length }).end(file);
        } else if (site.quirks && /\.json$/i.test(name)) {
          // PCOE will not hand out a .json from a document library: its error page, with a success status (Phase 10g).
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(FILE_NOT_FOUND_PAGE);
        } else {
          response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(FILE_NOT_FOUND_PAGE);
        }
        return;
      }
      if (decoded.startsWith(`${site.fake.libraryFolder}/`)) {
        const stored = site.fake.file(decoded);
        if (!stored) { response.writeHead(404).end(); return; }
        response.writeHead(200, { 'Content-Type': stored.type, 'Content-Length': stored.bytes.length, 'Cache-Control': 'private, max-age=0' }).end(Buffer.from(stored.bytes));
        return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (url.pathname === '/' || url.pathname === SITE_PATH || url.pathname === `${SITE_PATH}/`) {
        response.writeHead(302, { Location: '/__local/' }).end();
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(FILE_NOT_FOUND_PAGE);
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error?.stack ?? error));
    }
  };

  const server = https.createServer(certificate(), (request, response) => { void handler(request, response); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const bound = server.address().port;
  return {
    port: bound, site, origin: ORIGIN,
    /** Chromium's launch arguments that map pms-local.test to this server and accept its certificate. */
    browserArgs: [`--host-rules=MAP ${HOST} 127.0.0.1:${bound}`, '--ignore-certificate-errors'],
    close: () => new Promise((resolve) => { clearTimeout(site.saving); server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => argv[(index += 1)];
    if (flag === '--scenario') options.scenario = value();
    else if (flag === '--package') options.packageDir = value();
    else if (flag === '--port') options.port = Number(value());
    else if (flag === '--latency') options.latency = value();
    else if (flag === '--fresh') options.fresh = true;
    else if (flag === '--freeze') options.freeze = true;
    else if (flag === '--open') options.open = true;
    else if (flag === '--help') options.help = true;
    else throw new Error(`Unknown option ${flag}. Try --help.`);
  }
  return options;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`npm run local:site -- [--scenario ${Object.keys(SCENARIOS).join('|')}] [--package <folder>] [--latency ${Object.keys(LATENCY).join('|')}] [--port ${DEFAULT_PORT}] [--fresh] [--freeze] [--open]`);
    process.exit(0);
  }
  const running = await startLocalSite(options);
  console.log(`The local PCOE site is running (scenario "${running.site.scenario}", latency "${running.site.latency}").`);
  console.log(`  Pages from: ${running.site.pages.name}`);
  console.log(`  Participant ${pageUrl('index.html')}\n  Admin       ${pageUrl('admin.html')}\n  Setup       ${pageUrl('setup.html')}\n  Control     ${ORIGIN}/__local/`);
  console.log(`  pms-local.test is mapped to 127.0.0.1:${running.port} only in a browser started with: ${running.browserArgs.map((arg) => JSON.stringify(arg)).join(' ')}`);
  for (const note of running.site.extras.notes ?? []) console.log(`  Note: ${note}`);
  if (options.open) {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: false, args: running.browserArgs });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/__local/`);
    browser.on('disconnected', () => { void running.close().then(() => process.exit(0)); });
  }
  process.on('SIGINT', () => { void running.close().then(() => process.exit(0)); });
}

