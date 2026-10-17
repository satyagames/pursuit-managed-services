// What the admin's Clients screen decides: the add/edit form's rules, the stored theme a form makes,
// the list's derived columns, and who may be archived. Plain JS with JSDoc and no DOM, so
// `node --test` runs it (scripts/test-admin-today.js). AdminClients.svelte only renders it.
//
// Colours, logos, hero art and backgrounds are Brand Studio's (Phase 6). Here a client's look is whatever
// its ThemeJson already holds; a new client gets the default Deloitte-blue palette from deriveTheme, and
// the form edits only the words (event title, subtitle, welcome line). The older colour fields a new
// client starts with are worked out from that palette, as Brand Studio writes them on every save.

import { legacyColours } from '../brand/legacy-colours.js';
import { reviseClientTheme } from '../brand/client-theme.js';
import { groupsOf } from '../data/read-groups.js';
import { DEFAULT_PRIMARY } from '../brand/theme.js';

/** A slug is lower-case words of a to z and 0 to 9 joined by single hyphens. It is the front of every session id. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 40;
/**
 * A client's name (Clients.Name, copied into Title): a single line of text, 255 characters at most (pms-schema-meta.js; this page cannot carry that
 * file, so scripts/test-text-limits.js holds the two equal). Phase 10c-3.
 */
export const MAX_CLIENT_NAME = 255;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The event title a new client starts with. @param {string} name */
export const defaultEventTitle = (name) => (text(name) ? `${text(name).toUpperCase()} TRIVIA NIGHT` : '');

/** The slug a client's session ids really use: sessionIdFor() falls back to the name and the id. @param {any} api @param {any} client */
export const effectiveSlug = (api, client) => api.slugify(client.slug) || api.slugify(client.name) || api.slugify(client.id);

/**
 * What is wrong with a slug, in words; '' when it is fine.
 * @param {string} slug
 * @param {{ api: any, clients: any[], editingId?: string | null }} context
 */
export function slugProblem(slug, { api, clients, editingId = null }) {
  if (!slug) return 'Enter a slug.';
  if (slug.length > SLUG_MAX) return `Keep the slug to ${SLUG_MAX} characters or fewer.`;
  if (!SLUG_PATTERN.test(slug)) return 'Use a to z, 0 to 9 and hyphens, with no hyphen at either end or two in a row.';
  const taken = clients.find((client) => client.id !== editingId && effectiveSlug(api, client) === slug);
  return taken ? `${taken.name} already uses this slug.` : '';
}

/**
 * @typedef {object} ClientForm
 * @property {string} name
 * @property {string} slug
 * @property {string} eventTitle
 * @property {string} eventSubtitle
 * @property {string} welcomeLine
 */

/**
 * Every problem with the form, by field; an empty object means it can be saved.
 * @param {ClientForm} form
 * @param {{ api: any, clients: any[], editingId?: string | null }} context
 * @returns {{ name?: string, slug?: string }}
 */
export function clientProblems(form, context) {
  /** @type {{ name?: string, slug?: string }} */
  const problems = {};
  if (!text(form.name)) problems.name = 'Enter the client name.';
  else if (text(form.name).length > MAX_CLIENT_NAME) problems.name = `The name is ${text(form.name).length} characters; a client's name can hold ${MAX_CLIENT_NAME}.`;
  const slug = slugProblem(form.slug, context);
  if (slug) problems.slug = slug;
  return problems;
}

/**
 * The ThemeJson to store for a form, in the Phase 4 shape. A client that has a stored theme keeps its
 * palette, accent and pictures and takes the new words; a client without one gets the default
 * palette. The version is the client's ThemeVersion plus one, and the client's ThemeVersion is set
 * to the same number, so the tokens are trusted on the next boot (resolveClientTheme).
 * @param {any | null} existing The client record being edited, or null for a new client.
 * @param {ClientForm} form
 * @returns {{ theme: any, themeVersion: number }}
 */
export function themeForSave(existing, form) {
  const stored = existing?.theme && typeof existing.theme === 'object' && !Array.isArray(existing.theme) ? existing.theme : {};
  const version = (Number.isInteger(existing?.themeVersion) ? existing.themeVersion : 0) + 1;
  const before = stored.copy && typeof stored.copy === 'object' ? stored.copy : {};
  const name = text(form.name);
  // The text on the logo plate is the client's name until someone chose something else.
  const logoText = !text(before.logoText) || text(before.logoText) === text(existing?.name) ? name : text(before.logoText);
  const theme = reviseClientTheme(stored, {
    version,
    copy: { eventTitle: text(form.eventTitle), eventSubtitle: text(form.eventSubtitle), welcomeLine: text(form.welcomeLine), logoText },
  });
  return { theme, themeVersion: version };
}

/** The form for a client record (what the edit form starts with). @param {any} client */
export function formOf(client) {
  const copy = client?.theme?.copy ?? {};
  return {
    name: client?.name ?? '',
    slug: client?.slug ?? '',
    eventTitle: text(copy.eventTitle),
    eventSubtitle: text(copy.eventSubtitle),
    welcomeLine: text(copy.welcomeLine),
  };
}

/**
 * Creates a client. Its id is `c-<slug>`, and an id is unique in the list, so two admins adding the same
 * slug together cannot both succeed: the second is told so.
 * @param {any} api
 * @param {ClientForm & { logoUrl?: string, primaryColor?: string, secondaryColor?: string }} form
 */
export async function createClientRecord(api, form) {
  const slug = text(form.slug);
  try {
    return await api.createClient({
      id: `c-${slug}`,
      name: text(form.name),
      slug,
      status: 'active',
      logoUrl: text(form.logoUrl),
      // The two older colours still colour the results display and exports, so they start as the default palette gives them.
      primaryColor: form.primaryColor || legacyColours({ primary: DEFAULT_PRIMARY }).primaryColor,
      secondaryColor: form.secondaryColor || legacyColours({ primary: DEFAULT_PRIMARY }).secondaryColor,
      createdAt: new Date().toISOString(),
      ...themeForSave(null, form),
    });
  } catch (error) {
    if (error?.status === 409) throw Object.assign(new Error(`The slug "${slug}" is already taken by another client. Choose a different one.`), { code: 'slug-taken' });
    throw error;
  }
}

/**
 * Saves an edit: the name and the words always, the slug only while it is unlocked.
 * @param {any} api @param {any} client The record before the edit.
 * @param {ClientForm & { logoUrl?: string, primaryColor?: string, secondaryColor?: string }} form
 * @param {{ slugLocked: boolean }} options
 */
export function updateClientRecord(api, client, form, { slugLocked }) {
  return api.updateClient(client.id, {
    name: text(form.name),
    ...(slugLocked ? {} : { slug: text(form.slug) }),
    ...(form.logoUrl !== undefined ? { logoUrl: text(form.logoUrl) } : {}),
    ...(form.primaryColor ? { primaryColor: form.primaryColor } : {}),
    ...(form.secondaryColor ? { secondaryColor: form.secondaryColor } : {}),
    ...themeForSave(client, form),
  });
}

/**
 * The list's rows: status, activities, when it last went live and whether it is live now. Everything
 * is derived from lists the page has read; no column was added for it.
 * @param {{ clients: any[], sessions: any[], sections: any[], liveClientId: string | null }} input
 */
export function clientRows({ clients, sessions, sections, liveClientId }) {
  return [...clients].sort((a, b) => a.name.localeCompare(b.name)).map((client) => {
    const owned = sections.filter((section) => section.clientId === client.id);
    const own = sessions.filter((session) => session.clientId === client.id);
    return {
      client,
      archived: client.status === 'archived',
      activities: owned.length,
      liveActivities: owned.filter((section) => section.enabled === true).length,
      lastLive: own.map((session) => session.date ?? '').filter(Boolean).sort().at(-1) ?? null,
      liveNow: liveClientId === client.id,
      sessionCount: own.length,
      slugLocked: own.length > 0,
    };
  });
}

/**
 * Is this client live right now? Asked of the server at the moment of an archive, not of the page's
 * memory, because another admin may have gone live a moment ago. Two small reads.
 * @param {any} api @param {string} clientId
 */
export async function isClientLive(api, clientId) {
  const settings = await api.getAppSettings();
  if (!settings?.activeSessionId) return false;
  const session = await api.getSession(settings.activeSessionId);
  return Boolean(session) && session.status !== 'completed' && settings.activeClientId === clientId;
}

/**
 * Session ids to one read. A session's id is up to 51 characters (a 40-letter slug and a date), longer than the ids READ_CHUNK
 * was sized for: 20 of them made an address of 1,728 characters, 15 make one of about 1,320.
 */
const SESSIONS_TO_A_READ = 15;

/**
 * What a client is used by, read now, for the delete protection. Who is live and the client's own sessions are one request
 * (two lists side by side); then, only when it has sessions, their visits and their QR codes are read by session, 15 sessions
 * to a read, in one more request. A visit or a code is only ever made in a session of its client, so a client with no session
 * has neither, and nothing more is asked. (The screen used to read every session, visit and code there is: three whole lists,
 * which only get longer.)
 * @param {any} api the data service @param {string} clientId
 * @returns {Promise<{ live: boolean, sessions: any[], tracks: any[], tokens: any[] }>}
 */
export async function clientUsage(api, clientId) {
  const [settingRows, sessions] = await api.readLists([{ list: 'appsettings' }, { list: 'sessions', where: { clientId } }]);
  const groups = groupsOf(sessions.map((/** @type {any} */ session) => String(session.id)), SESSIONS_TO_A_READ);
  const found = groups.length === 0 ? [] : await api.readLists(groups.flatMap((ids) => [{ list: 'tracks', where: { sessionId: ids } }, { list: 'qrtokens', where: { sessionId: ids } }]));
  const own = (/** @type {any} */ row) => row.clientId === clientId;
  return {
    live: settingRows.find((/** @type {any} */ row) => row.id === 'default')?.activeClientId === clientId,
    sessions,
    tracks: found.filter((/** @type {any} */ _rows, /** @type {number} */ index) => index % 2 === 0).flat().filter(own),
    tokens: found.filter((/** @type {any} */ _rows, /** @type {number} */ index) => index % 2 === 1).flat().filter(own),
  };
}

/**
 * The newest check-in codes of one session, newest first, for the QR dialog: one read by the indexed SessionId. (It used to be
 * every code there is, picked through for the client's, so the dialog also listed the codes of the client's earlier days.)
 * @param {any} api the data service @param {string} sessionId @param {string} clientId @param {number} [most]
 */
export async function recentCodes(api, sessionId, clientId, most = 6) {
  const [tokens] = await api.readLists([{ list: 'qrtokens', where: { sessionId } }]);
  return tokens.filter((/** @type {any} */ token) => token.clientId === clientId).reverse().slice(0, most);
}

/**
 * Archives or restores a client. A live client cannot be archived.
 * @param {any} api @param {any} client @param {'active' | 'archived'} status
 */
export async function setClientStatus(api, client, status) {
  if (status === 'archived' && await isClientLive(api, client.id)) {
    throw Object.assign(new Error(`${client.name} is live now. Go live with another client, or end the session, before archiving it.`), { code: 'client-live' });
  }
  return api.updateClient(client.id, { status });
}
