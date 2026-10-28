// The one check of access (Prompt 21, Phase 1): can(access, action, target) reads the role matrix (access-matrix.js) and the person's assignment rows,
// with ValidUntil honoured at the moment of the call. Pure: the access it is given is what resolve.js read (or legacyAccess for a PIN), and nothing
// here reads or writes. Plain JS with no DOM; the admin page and Setup import it. A client-side check is a guardrail, not a security boundary
// (decision K): Phase 7 hardens the lists themselves.
//
// An access is { person, owner, legacy, user, assignments }: `person` the signed-in account ({ key, email, name, loginName }, null on the local
// server), `owner` whether they own the site (decision I: always a Super admin), `legacy` whether they unlocked with a PIN, `user` their PMSUsers row
// or null, `assignments` their PMSRoleAssignments rows as records.
import { LEGACY_ACTIONS, LEGACY_ADMIN, MATRIX, ROLES, ROLE_SCOPES } from './access-matrix.js';

const DAY_MS = 86_400_000;
/** The day of a date or ISO time as YYYY-MM-DD, or '' when there is none. */
const dayOf = (value) => (typeof value === 'string' ? value.slice(0, 10) : value instanceof Date ? value.toISOString().slice(0, 10) : '');
/** An assignment's Extras as a list of words ('content.edit,users.manage'). */
export const extrasOf = (value) => (Array.isArray(value) ? value : String(value ?? '').split(/[\s,]+/)).filter(Boolean);

/**
 * The key a signed-in account is known by: its email in lower case, or the email at the end of its login name (i:0#.f|membership|<email>), or null.
 * @param {{ Email?: string, LoginName?: string }} raw what SharePoint's /web/currentuser says
 */
export function userKeyOf(raw) {
  const email = String(raw?.Email ?? '').trim();
  if (email.includes('@')) return email.toLowerCase();
  const tail = String(raw?.LoginName ?? '').split('|').at(-1)?.trim() ?? '';
  return tail.includes('@') ? tail.toLowerCase() : null;
}

/** The access of an admin who unlocked with a PIN (PMSAdminUsers, before the switch-over): the Phase 20 admin page, whoever is signed in. */
export const legacyAccess = (person) => ({ person: person ?? null, owner: false, legacy: true, user: null, assignments: [] });

/**
 * Whether an assignment still works at `now`: ValidUntil is the last day of access, the whole of it (ASSUMED: the day as SharePoint stores a date,
 * midnight UTC, to the next midnight).
 */
const current = (assignment, now) => !assignment.validUntil || now.getTime() < Date.parse(dayOf(assignment.validUntil)) + DAY_MS;

/**
 * The grants that count now: the site owner's Super admin, the PIN's legacy admin, and every assignment of the person's that is theirs, of a known
 * role, for a place that role may have, complete, and current, when their row is Active. A disabled person has none of their own.
 * @param {{ person: any, owner: boolean, legacy: boolean, user: any, assignments: any[] }} access
 * @param {{ now?: Date }} [options]
 */
export function grantsOf(access, { now = new Date() } = {}) {
  const grants = [];
  if (access?.owner) grants.push({ role: 'Super admin', scopeType: 'global', extras: [], implicit: 'owner' });
  if (access?.legacy) grants.push({ role: LEGACY_ADMIN, scopeType: 'global', extras: [], implicit: 'pin' });
  const active = access?.user && (access.user.status ?? 'Active') !== 'Disabled';
  if (!active) return grants;
  for (const assignment of access.assignments ?? []) {
    if (access.person?.key && assignment.userKey !== access.person.key) continue;
    if (!ROLES.includes(assignment.role) || !ROLE_SCOPES[assignment.role].includes(assignment.scopeType)) continue;
    if (assignment.scopeType === 'client' && !assignment.clientId) continue;
    if (assignment.scopeType === 'session' && !assignment.sessionId) continue;
    if (assignment.scopeType === 'period' && !(assignment.periodFrom && assignment.periodTo)) continue;
    if (!current(assignment, now)) continue;
    grants.push({ ...assignment, extras: extrasOf(assignment.extras) });
  }
  return grants;
}

/**
 * Whether a grant's place covers the target ({ clientId?, sessionId?, date? }). An empty target asks "anywhere" (a menu, a module). A client's role
 * covers the target's client; a session's role the target's session, and not its whole client; a period's role every client's sessions dated inside
 * it, so a target without a date is not covered. ASSUMED until Phase 4 names the client of every write: a client's role covers a target that names
 * only a session.
 */
function covers(grant, target) {
  const { clientId, sessionId, date } = target ?? {};
  if (grant.scopeType === 'global') return true;
  if (!clientId && !sessionId && !date) return true;
  if (grant.scopeType === 'client') return !clientId || clientId === grant.clientId;
  if (grant.scopeType === 'session') return sessionId ? sessionId === grant.sessionId : !clientId;
  if (grant.scopeType === 'period') return Boolean(date) && dayOf(date) >= dayOf(grant.periodFrom) && dayOf(date) <= dayOf(grant.periodTo);
  return false;
}

/** Whether one grant's role has `action` in a cell among `cells` ('option' only with the extra of the same code). */
function allowsIn(grant, action, cells) {
  if (grant.role === LEGACY_ADMIN) return LEGACY_ACTIONS.includes(action);
  const cell = MATRIX[action]?.[grant.role];
  return cells.includes(cell) || (cell === 'option' && grant.extras.includes(action));
}

/**
 * The one check: may this access do `action` to `target` now?
 * @param {any} access @param {string} action an action of the role matrix @param {{ clientId?: string, sessionId?: string, date?: string }} [target]
 * @param {{ now?: Date }} [options]
 */
export const can = (access, action, target = {}, options = {}) => grantsOf(access, options).some((grant) => allowsIn(grant, action, ['yes']) && covers(grant, target));
/** Whether it may at least look (a View cell, or anything can() allows). */
export const canView = (access, action, target = {}, options = {}) => grantsOf(access, options).some((grant) => allowsIn(grant, action, ['yes', 'view']) && covers(grant, target));
