// The Users list's rules (Prompt 21, Phase 2; board 3): each person's roles and reach from their assignment rows, the role chips, the filters (search,
// client, session, status), the sessions of a client by date, time and title, and the pages of fifty. Plain JS with no DOM, so that `node --test`
// holds them; the admin page's Users screens import it. Everything is read once and filtered here: a site has hundreds of people, not thousands
// (ASSUMED; the lists are read in full pages below the 5,000-item view limit, and Phase 7 revisits it with the indexes).
import { ROLES } from './access-matrix.js';
import { grantsOf } from './can.js';

/** How many people a page of the list shows. */
export const PAGE_SIZE = 50;

/** The chips above the list, in board 3's order; `id` is a role of PMSRoleAssignments, or 'all'. */
export const ROLE_CHIPS = Object.freeze([
  { id: 'all', label: 'All' }, { id: 'Super admin', label: 'Super admins' }, { id: 'Admin', label: 'Admins' }, { id: 'Producer', label: 'Producers' },
  { id: 'Designer', label: 'Designers' }, { id: 'Leadership', label: 'Leadership' },
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day as people say it: "28 Oct 2026" (from a date or an ISO time; the day as stored, not the device's). */
export function dayWords(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : '');
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}

/** A session as a list says it: its date, then its time and title when it has them ("4 Nov 2026, 14:30, Round two"). */
export const sessionLabel = (session) => [dayWords(session?.date), session?.startTime, session?.title].filter(Boolean).join(', ') || String(session?.id ?? '');

/** The sessions of a client, earliest first, as { id, label } (none until a client is picked). */
export const sessionsOfClient = (sessions, clientId) => (clientId ? sessions.filter((session) => session.clientId === clientId) : [])
  .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')))
  .map((session) => ({ id: session.id, label: sessionLabel(session) }));

/**
 * Where an assignment reaches, in words: "All clients", "Kroger", "Kroger, 4 Nov 2026", "All clients, 1 Dec 2026 to 28 Feb 2027", then ", until <day>".
 * @param {any} assignment @param {{ clients?: any[], sessions?: any[] }} [at]
 */
export function reachWords(assignment, { clients = [], sessions = [] } = {}) {
  const clientName = (id) => clients.find((client) => client.id === id)?.name ?? id ?? '';
  let words;
  if (assignment.scopeType === 'client') words = clientName(assignment.clientId);
  else if (assignment.scopeType === 'session') {
    const session = sessions.find((entry) => entry.id === assignment.sessionId);
    words = [clientName(session?.clientId ?? assignment.clientId), session ? sessionLabel(session) : assignment.sessionId].filter(Boolean).join(', ');
  } else if (assignment.scopeType === 'period') words = `All clients, ${dayWords(assignment.periodFrom)} to ${dayWords(assignment.periodTo)}`;
  else words = 'All clients';
  return assignment.validUntil ? `${words}, until ${dayWords(assignment.validUntil)}` : words;
}

/**
 * One row of the list per person: { key, name, email, status, roles, reach, assignments }, in the order of the users read. `roles` and `reach` come
 * from the assignments that count now (an ended one is shown on the person's own screen, not here). The roles are in the order of ROLES.
 * @param {any[]} users PMSUsers records @param {any[]} assignments PMSRoleAssignments records
 * @param {{ clients?: any[], sessions?: any[], now?: Date }} [options]
 */
export function peopleRows(users, assignments, { clients = [], sessions = [], now = new Date() } = {}) {
  const byUser = new Map();
  for (const assignment of assignments) byUser.set(assignment.userKey, [...(byUser.get(assignment.userKey) ?? []), assignment]);
  return users.map((user) => {
    const mine = byUser.get(user.id) ?? [];
    // (grantsOf with no person's key asks about every row given: it only judges the role, its place and its end date.)
    const current = grantsOf({ person: null, owner: false, legacy: false, user: { status: 'Active' }, assignments: mine }, { now });
    return {
      key: user.id, name: user.fullName || user.email || user.id, email: user.email || user.id, status: user.status ?? 'Active',
      roles: ROLES.filter((role) => current.some((grant) => grant.role === role)),
      reach: current.map((grant) => reachWords(grant, { clients, sessions })),
      assignments: mine,
    };
  });
}

/** Whether a current assignment reaches a client (and a session, when one is picked): all-client roles reach every one. */
function reaches(assignment, { clientId, sessionId }, sessions) {
  if (assignment.scopeType === 'global' || assignment.scopeType === 'period') return true;
  if (assignment.scopeType === 'client') return assignment.clientId === clientId;
  const session = sessions.find((entry) => entry.id === assignment.sessionId);
  return sessionId ? assignment.sessionId === sessionId : (session?.clientId ?? assignment.clientId) === clientId;
}

/**
 * The people a set of filters keeps: `chip` (a role, or 'all'), `search` (a name or an email, any case), `status` ('all', 'Active', 'Disabled'), and
 * `clientId` and `sessionId` (who has a current role that reaches them).
 * @param {ReturnType<typeof peopleRows>} rows
 * @param {{ chip?: string, search?: string, status?: string, clientId?: string, sessionId?: string, sessions?: any[], now?: Date }} [filters]
 */
export function filterPeople(rows, { chip = 'all', search = '', status = 'all', clientId = '', sessionId = '', sessions = [], now = new Date() } = {}) {
  const needle = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (status !== 'all' && row.status !== status) return false;
    if (needle && !`${row.name} ${row.email}`.toLowerCase().includes(needle)) return false;
    const current = grantsOf({ person: null, owner: false, legacy: false, user: { status: 'Active' }, assignments: row.assignments }, { now });
    if (chip !== 'all' && !current.some((grant) => grant.role === chip)) return false;
    if (clientId && !current.some((grant) => reaches(grant, { clientId, sessionId }, sessions))) return false;
    return true;
  });
}

/** One page of a list: { items, page, pages, total }; a page past the end is the last, and an empty list is one empty page. */
export function pageOf(list, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const at = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  return { items: list.slice((at - 1) * size, at * size), page: at, pages, total: list.length };
}
