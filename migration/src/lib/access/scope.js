// Scoping by role (Prompt 21, Phase 4; wireframe boards 7, 8 and 10): what the admin page shows a person, and what it may ask the lists for. The menu is
// built from the role matrix (the same matrix can() reads, so a tab is never decided apart from it); Content's two views are edited, shown read only, or
// not shown; the pickers list only the clients and sessions a person was given; and a read names only those places (readQueries), which the data layer's
// read check (owners.js) holds a scoped role to. Plain JS with no DOM; the admin page imports it, the participant page never does (`npm run test:bundle`).
//
// DECIDED (Phase 4): the client owns its activities and its brand, so a role given one session only sees them (the client's content is shown to read, in
// the Content views, and edited by nobody who holds only a session). A client nobody was given to is covered by no client's role: only a global role
// (Super admin, Admin, a migrated admin) sees it, so on day one a new client is seen by Super admins and Admins alone.
import { allowsIn, can, canView, grantsOf } from './can.js';

/** The actions that open each tab of the admin page: a tab shows when the person may at least look at one of them (a View cell counts). */
export const TAB_ACTIONS = Object.freeze({
  today: Object.freeze(['events.run']),
  clients: Object.freeze(['clients.manage']),
  content: Object.freeze(['content.edit', 'brand.edit']),
  guests: Object.freeze(['guests.manage', 'qr.manage']),
  results: Object.freeze(['results.view']),
  users: Object.freeze(['users.view']),
});

/** Whether the person's role opens the tab. @param {any} access @param {string} id @param {{ now?: Date }} [options] */
export const tabAllowed = (access, id, options) => (TAB_ACTIONS[id] ?? []).some((action) => canView(access, action, {}, options));
/** The tabs a person's role opens, in the menu's order. @template {{ id: string }} T @param {any} access @param {T[]} tabs @param {{ now?: Date }} [options] */
export const tabsFor = (access, tabs, options) => tabs.filter((tab) => tabAllowed(access, tab.id, options));
/** The first tab a person's role opens, or null. @param {any} access @param {{ id: string }[]} tabs @param {{ now?: Date }} [options] */
export const firstTab = (access, tabs, options) => tabsFor(access, tabs, options)[0]?.id ?? null;

/** Whether a grant's place includes the client, wholly or by one of its sessions (a session's row also carries its client). */
const touchesClient = (grant, clientId) => grant.scopeType === 'global' || ((grant.scopeType === 'client' || grant.scopeType === 'session') && grant.clientId === clientId);

/**
 * How Content shows a client to a person: each of its two views is 'edit', 'view' (read only: shown, not left out) or 'none'. Editing needs the action
 * for the whole client; any other holder of a Content action on the client sees both views to read.
 * @param {any} access @param {string} clientId @param {{ now?: Date }} [options]
 * @returns {{ activities: 'edit' | 'view' | 'none', brand: 'edit' | 'view' | 'none' }}
 */
export function contentModes(access, clientId, options) {
  const sees = grantsOf(access, options).some((grant) => touchesClient(grant, clientId)
    && (allowsIn(grant, 'content.edit', ['yes', 'view', 'option']) || allowsIn(grant, 'brand.edit', ['yes', 'view', 'option'])));
  const modeOf = (action) => (can(access, action, { clientId }, options) ? 'edit' : sees ? 'view' : 'none');
  return { activities: modeOf('content.edit'), brand: modeOf('brand.edit') };
}

/**
 * Where a person's grants reach: `all` (a global role), the clients they hold whole, the sessions they hold one by one with those sessions' clients
 * (shown to read, never their other sessions), and the periods of Leadership.
 * @param {any} access @param {{ now?: Date }} [options]
 * @returns {{ all: boolean, clientIds: Set<string>, sessionIds: Set<string>, sessionClients: Set<string>, periods: { from: string, to: string }[] }}
 */
export function reachOf(access, options) {
  const reach = { all: false, clientIds: new Set(), sessionIds: new Set(), sessionClients: new Set(), periods: [] };
  for (const grant of grantsOf(access, options)) {
    if (grant.scopeType === 'global') reach.all = true;
    else if (grant.scopeType === 'client') reach.clientIds.add(grant.clientId);
    else if (grant.scopeType === 'session') {
      reach.sessionIds.add(grant.sessionId);
      if (grant.clientId) reach.sessionClients.add(grant.clientId);
    } else if (grant.scopeType === 'period') reach.periods.push({ from: String(grant.periodFrom).slice(0, 10), to: String(grant.periodTo).slice(0, 10) });
  }
  return reach;
}

const dayOf = (value) => String(value ?? '').slice(0, 10);
/** Whether a day is inside one of the reach's periods. */
export const inPeriod = (reach, date) => Boolean(dayOf(date)) && reach.periods.some((period) => dayOf(date) >= period.from && dayOf(date) <= period.to);
/** Whether the reach covers a session ({ id, clientId, date }) to read its answers. */
export const mayReadSession = (reach, session) => reach.all || reach.sessionIds.has(session.id) || reach.clientIds.has(session.clientId) || inPeriod(reach, session.date);
/** Whether the reach lets a client's record (its name, look and activities) be read. With `sessions`, a period reaches only the clients that have a session in it. */
export function mayReadClient(reach, clientId, sessions) {
  if (reach.all || reach.clientIds.has(clientId) || reach.sessionClients.has(clientId)) return true;
  if (!reach.periods.length) return false;
  return sessions ? sessions.some((session) => session.clientId === clientId && inPeriod(reach, session.date)) : true;
}

/** The clients a person may see: the picker's list. @template {{ id: string }} T @param {any} access @param {T[]} clients @param {any[]} [sessions] @param {{ now?: Date }} [options] */
export const clientsFor = (access, clients, sessions, options) => { const reach = reachOf(access, options); return clients.filter((client) => mayReadClient(reach, client.id, sessions)); };
/** The sessions a person may see. @template {{ id: string, clientId?: string, date?: string }} T @param {any} access @param {T[]} sessions @param {{ now?: Date }} [options] */
export const sessionsFor = (access, sessions, options) => { const reach = reachOf(access, options); return sessions.filter((session) => mayReadSession(reach, session)); };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A session in a picker: "24 Oct 09:30 Morning workshop" (the day, its time and title when it has them; an old session's id is not a title). */
export function pickerLabel(session) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(session?.date ?? ''));
  const title = String(session?.title ?? '').trim();
  const words = [match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}` : '', session?.startTime, title && title !== session?.id ? title : ''].filter(Boolean).join(' ');
  return words || String(session?.id ?? '');
}

/** How many ids go to one address (the data layer's READ_CHUNK is 20; 15 leaves room for a session id of 58 characters). */
export const PLACES_PER_READ = 15;
const groups = (values) => Array.from({ length: Math.ceil(values.length / PLACES_PER_READ) }, (_unused, at) => values.slice(at * PLACES_PER_READ, (at + 1) * PLACES_PER_READ));

/**
 * The reads of `readLists` that fetch a list only for the places the reach holds: the same plain query for a global role (so its requests are the
 * ones the page always sent), queries by id or ClientId, fifteen to an address, for a scoped role, and none for a person with no place.
 * @param {ReturnType<typeof reachOf>} reach @param {'clients' | 'sessions' | 'sections'} list
 * @returns {{ list: string, where?: Record<string, string[]> }[]}
 */
export function readQueries(reach, list) {
  if (reach.all) return [{ list }];
  const owned = [...new Set([...reach.clientIds, ...reach.sessionClients])];
  if (list === 'clients') return reach.periods.length ? [{ list }] : groups(owned).map((group) => ({ list, where: { id: group } }));
  if (list === 'sessions') {
    if (reach.periods.length) return [{ list }];
    return [...groups([...reach.clientIds]).map((group) => ({ list, where: { clientId: group } })), ...groups([...reach.sessionIds]).map((group) => ({ list, where: { id: group } }))];
  }
  return groups(owned).map((group) => ({ list, where: { clientId: group } }));
}

/** Lists whose items belong to a session. */
const BY_SESSION = new Set(['tracks', 'uservisitlogs', 'qrtokens', 'visitorroster']);
const idsIn = (query, key) => (query.where?.[key] === undefined ? null : [query.where[key]].flat().map(String));

/**
 * `readLists` for a scoped role: a plain read of clients, sessions or activities becomes the reads for the places the reach holds (readQueries), and a
 * read by id of a session, its answers or a client the person does not hold is left out, not sent (it answers nothing). The sessions that come back are
 * remembered as readable, so the reads that follow for them (tracks, roster) are sent. A global role's reader is `readLists` itself.
 * @param {(queries: { list: string, where?: any }[]) => Promise<any[][]>} readLists @param {ReturnType<typeof reachOf> | null} reach @param {Set<string>} [readable] the sessions already known to be readable (a page keeps one set, so that a later poll reads what the first load found)
 */
export function scopedReader(readLists, reach, readable = new Set()) {
  if (!reach || reach.all) return readLists;
  const keep = (ids, test) => ids.filter(test);
  return async (queries) => {
    const plan = queries.map((query) => {
      if (!query.where && ['clients', 'sessions', 'sections'].includes(query.list)) return { query, parts: readQueries(reach, query.list) };
      let key = null; let test = null;
      if (query.list === 'sessions' && idsIn(query, 'id')) { key = 'id'; test = (id) => reach.sessionIds.has(id) || readable.has(id); }
      else if (BY_SESSION.has(query.list) && idsIn(query, 'sessionId')) { key = 'sessionId'; test = (id) => reach.sessionIds.has(id) || readable.has(id); }
      else if (query.list === 'clients' && idsIn(query, 'id')) { key = 'id'; test = (id) => mayReadClient(reach, id); }
      if (!key) return { query, parts: [query] };
      const kept = keep(idsIn(query, key), test);
      return { query, parts: kept.length ? [{ ...query, where: { ...query.where, [key]: kept } }] : [] };
    });
    const sent = plan.flatMap((entry) => entry.parts);
    const answers = sent.length ? await readLists(sent) : [];
    let at = 0;
    return plan.map((entry) => {
      const rows = answers.slice(at, at + entry.parts.length).flat();
      at += entry.parts.length;
      if (entry.query.list === 'sessions') for (const row of rows) readable.add(row.id);
      return rows;
    });
  };
}
