// Where the local site is and who is asking (Phase 12): the address, the personas, the fixed "now", and the one way a mocked site is made for it.
//
// The address is HTTPS on a `.test` host name on purpose: a page opened over plain http, or at localhost or 127.0.0.1, takes itself for the local
// Express server (migration/src/lib/address-check.js isLocalAddress) and never asks SharePoint. On https://pms-local.test/... the shipped pages behave
// exactly as on PCOE: they read pms-config.txt beside them, work out the site from their own address and talk to /sites/PCOE/_api.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createSharePointFake } from '../sharepoint-fake.js';

export const HOST = 'pms-local.test';
export const ORIGIN = `https://${HOST}`;
export const SITE_PATH = '/sites/PCOE';
export const SITE_URL = `${ORIGIN}${SITE_PATH}`;
/** The folder the pages are in, as a browser asks for it. */
export const FOLDER_PATH = `${SITE_PATH}/Shared%20Documents/PMS/`;
export const pageUrl = (file = 'index.html', origin = ORIGIN) => `${origin}${FOLDER_PATH}${file}`;
export const DEFAULT_PORT = 5190;
/** 16 Oct 2026, 17:00 in India: the scenarios' "now". */
export const NOW = '2026-10-16T11:30:00.000Z';
/** The admin every scenario but `empty` has. A local, made-up PIN for a mocked site (LOCAL-SITE.md has it); never a real one. */
export const ADMIN = Object.freeze({ id: 'admin-local01', name: 'Rivera, Morgan', pin: '482916' });

/**
 * Who SharePoint says is asking, chosen by a cookie that only the local server reads (`pms-local-persona`): the pages never know.
 * `admin` may read PMSAdminUsers; nobody else may (403, as on PCOE's permissions plan).
 */
export const PERSONAS = Object.freeze({
  admin: { label: 'Admin (an owner of the site)', user: { Id: 7, Title: 'Rivera, Morgan' }, admin: true },
  staff: { label: 'Staff (a Firm iPad signed in as a member of staff)', user: { Id: 21, Title: 'Okafor, Jamie' }, admin: false },
  guest: { label: 'Guest (an iPad on the shared sign-in; the guest arrives with a QR code)', user: { Id: 30, Title: 'PMS iPad, Shared' }, admin: false },
  outsider: { label: 'Outsider (signed in, not an admin)', user: { Id: 55, Title: 'Lindqvist, Sam' }, admin: false },
});
export const PERSONA_COOKIE = 'pms-local-persona';
export const personaFromCookie = (header = '') => {
  const found = /(?:^|;\s*)pms-local-persona=([a-z]+)/.exec(header)?.[1];
  return found && found in PERSONAS ? found : 'admin';
};

/** The persona of the request being answered (an AsyncLocalStorage, so a $batch's parts know it too). */
export const asking = new AsyncLocalStorage();
export const currentPersona = () => PERSONAS[asking.getStore() ?? 'admin'];

/**
 * A mocked SharePoint as the local site uses it: the PCOE address, no list prefix, the tenant's answers (`strict: false`: an unnamed read is answered
 * without ClientId), the persona's user, and SharePoint's own Created, Modified and __metadata uri on every item. `empty` is a site with no lists.
 * @param {{ empty?: boolean, now?: () => string }} [options]
 */
export function makeFake({ empty = false, now = () => new Date().toISOString() } = {}) {
  return createSharePointFake({
    siteUrl: SITE_URL, prefix: '', strict: false, user: () => currentPersona().user, realShape: { now },
    ...(empty ? { without: ['clients', 'sessions', 'sections', 'questions', 'options', 'tracks', 'qrtokens', 'appsettings', 'visitorroster', 'uservisitlogs', 'adminusers', 'responses', 'logoLibrary'], schemaVersion: null } : {}),
  });
}
