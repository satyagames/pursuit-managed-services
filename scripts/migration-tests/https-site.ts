import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SITE, type Fake } from './sharepoint.js';

// The three built pages and the mocked SharePoint REST, served over a REAL (local, HTTPS) connection at the approved host's own name, so that
// Chromium's DevTools network throttling applies to every request, the document included. Playwright's route.fulfill() does not go through the
// network stack and so is not throttled; this does. Pages are sent gzip-compressed (what SharePoint does), so a 1.7 MB page costs what it costs
// on the wire. The host name is mapped to this server with Chromium's --host-rules and the self-signed certificate is accepted by
// --ignore-certificate-errors; both are launch arguments of the test's own browser and touch nothing else.
//
// Needs `openssl` (macOS and Linux have it) to make a one-day certificate for the host name.

const release = fileURLToPath(new URL('../../build-svelte/release/', import.meta.url));
const ORIGIN = new URL(SITE).origin;
const SITE_PATH = new URL(SITE).pathname;
const PAGE_PATH = `${SITE_PATH}/Shared%20Documents/staging-test/`;

export type HttpsSite = { port: number; args: string[]; requests: { method: string; url: string }[]; bytes: { page: number; api: number }; close: () => Promise<void> };

/** @param {Fake} fake the mocked site that answers /_api; `delayMs` holds every API answer (the page's own files are not held). */
export async function startHttpsSite(fake: Fake, { delayMs = 0 } = {}): Promise<HttpsSite> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cec-https-'));
  const host = new URL(ORIGIN).hostname;
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '2', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`], { stdio: 'ignore' });
  const pages = new Map(['index.html', 'admin.html', 'setup.html'].map((name) => [name, gzipSync(readFileSync(path.join(release, name)), { level: 9 })]));
  const log: HttpsSite['requests'] = [];
  const bytes = { page: 0, api: 0 };
  const server = https.createServer({ key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }, (request, response) => {
    const url = new URL(request.url ?? '/', ORIGIN);
    log.push({ method: request.method ?? 'GET', url: url.pathname + url.search });
    if (url.pathname.startsWith(PAGE_PATH) || decodeURIComponent(url.pathname).startsWith(decodeURIComponent(PAGE_PATH))) {
      const name = decodeURIComponent(url.pathname).split('/').pop() ?? '';
      // The settings file beside the pages (Phase 10b): the prefix of this site's own lists, said on purpose (empty for the lists with
      // nothing in front of their names). It travels through the same throttled connection as everything else, so the measured times
      // include it.
      if (name === 'pms-config.txt') {
        const file = Buffer.from(JSON.stringify({ configVersion: 1, listPrefix: fake.prefix }));
        bytes.page += file.length;
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': file.length, 'Cache-Control': 'private, max-age=0' }).end(file);
        return;
      }
      const body = pages.get(name);
      if (!body) { response.writeHead(404).end(); return; }
      bytes.page += body.length;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': body.length, 'Cache-Control': 'private, max-age=0' }).end(body);
      return;
    }
    if (url.pathname.startsWith(`${SITE_PATH}/_api/`)) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', async () => {
        const body = Buffer.concat(chunks);
        if (delayMs) await new Promise((resolve) => { setTimeout(resolve, delayMs); });
        const reply = await fake.handle({
          method: request.method ?? 'GET', url: `${ORIGIN}${request.url}`, headers: request.headers as Record<string, string>,
          body: body.length ? body.toString('utf8') : null, bodyBuffer: body.length ? body : undefined,
        });
        const payload = Buffer.from(reply.body ?? '');
        bytes.api += payload.length;
        response.writeHead(reply.status, { ...reply.headers, 'Content-Length': payload.length }).end(payload);
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  return {
    port, requests: log, bytes,
    args: [`--host-rules=MAP ${host} 127.0.0.1:${port}`, '--ignore-certificate-errors'],
    close: async () => { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); await rm(dir, { recursive: true, force: true }); },
  };
}

export const pageAddress = (file: string) => `${ORIGIN}${PAGE_PATH}${file}`;
