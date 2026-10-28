// The data layer's write guard (Prompt 21, Phase 1): what lib/data/core.js asks before every write it sends, once a page has installed one
// (dataService.setAccessGuard). It reads the change from the request itself (SharePoint's REST address and X-HTTP-Method, or the local server's
// method and path), finds the list's row of LIST_WRITES in the role matrix, and throws AccessDenied unless can() allows one of its actions for the
// client or session the written item names. Nothing refused is sent. A change it cannot name is refused too (a guardrail allows only what it
// knows). Plain JS with no DOM; the admin page installs it after sign-in. The participant page and Setup install none.
import { LIST_WRITES } from './access-matrix.js';
import { AccessDenied } from './access-denied.js';
import { can } from './can.js';
import { disableProblem, revokeProblem } from './grants.js';

/** The local server's file names that are not a list's key. */
const LOCAL_NAMES = Object.freeze({ participantresponses: 'responses', uploads: 'library' });
const OPS = Object.freeze({ MERGE: 'update', PATCH: 'update', DELETE: 'delete', POST: 'create' });

const header = (headers, name) => Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
/** A title as a REST address spells it: getbytitle('<title, quotes doubled, maybe encoded>'). */
const titleIn = (resource) => {
  const quoted = /getbytitle\('((?:''|[^'])+)'\)/.exec(resource)?.[1];
  if (quoted === undefined) return null;
  try { return decodeURIComponent(quoted).replace(/''/g, '\''); } catch { return quoted.replace(/''/g, '\''); }
};

/**
 * What a write request changes: { key, op, id } (key a list's key or `library`), 'none' for a request that changes nothing of the app's (the write
 * token, a search of the directory), or null when it cannot be told.
 */
export function changeOf(method, resource, headers, keyOfTitle) {
  const path = String(resource).split('?')[0];
  if (path === '/contextinfo') return 'none';
  if (/clientPeoplePickerSearchUser$/.test(path)) return 'none'; // (a search of the directory: it changes nothing)
  if (/\/Files\/add\(/.test(path)) return { key: 'library', op: 'create', id: null };
  if (/\/recycle\(\)$/.test(path)) return { key: 'library', op: 'delete', id: null };
  const title = titleIn(path);
  if (title !== null) {
    const key = keyOfTitle.get(title);
    if (!key || !/\/items(\(\d+\))?$/.test(path)) return null;
    const verb = String(header(headers, 'x-http-method') ?? method).toUpperCase();
    return { key, op: OPS[verb] ?? null, id: null };
  }
  const [name, id] = path.replace(/^\/+/, '').split('/');
  const key = LOCAL_NAMES[name] ?? name;
  return keyOfTitle.has(key) || key === 'library' ? { key, op: OPS[String(method).toUpperCase()] ?? null, id: id ? decodeURIComponent(id) : null } : null;
}

/**
 * The client or session the written item names, from its columns (SharePoint) or fields (local): a client's own id on the clients list, a
 * session's on the sessions list.
 */
function targetOf({ key, id }, body) {
  const item = body && typeof body === 'object' && !(typeof Blob !== 'undefined' && body instanceof Blob) ? body : {};
  const own = item.AppId ?? item.id ?? id ?? undefined;
  const clientId = (key === 'clients' ? own : undefined) ?? item.ClientId ?? item.clientId ?? undefined;
  const sessionId = (key === 'sessions' ? own : undefined) ?? item.SessionId ?? item.sessionId ?? undefined;
  return { ...(clientId ? { clientId } : {}), ...(sessionId ? { sessionId } : {}) };
}

/**
 * The guard for one access. Its `record(change)` is the check that needs rows (Phase 2: never the last Super admin, never your own roles, an Admin
 * never touches a Super admin or Admin row): the data layer's people calls (lib/data/access-people.js) hand it the row and both lists before a change. `titles` are the list titles by key under this page's settings (dataService.sharePointListTitles()).
 * @param {any} access @param {Record<string, string>} titles @param {{ now?: () => Date }} [options]
 * @returns {(method: string, resource: string, headers?: Record<string, string>, body?: unknown) => void}
 */
export function writeGuard(access, titles, { now = () => new Date() } = {}) {
  const keyOfTitle = new Map(Object.entries(titles).map(([key, title]) => [title, key === 'logoLibrary' ? 'library' : key]));
  for (const key of Object.keys(LIST_WRITES)) if (key !== 'library') keyOfTitle.set(key, key); // (the local server's paths name the key)
  const guard = (method, resource, headers = {}, body = undefined) => {
    const change = changeOf(method, resource, headers, keyOfTitle);
    if (change === 'none') return;
    const allowed = change?.op ? LIST_WRITES[change.key]?.[change.op] : undefined;
    if (allowed === 'anyone' && access) return;
    if (Array.isArray(allowed) && allowed.some((action) => can(access, action, targetOf(change, body), { now: now() }))) return;
    throw new AccessDenied(Array.isArray(allowed) && allowed.length ? allowed[0] : 'unknown');
  };
  /** @param {{ key: string, op: string, row: any, changes?: any, users: any[], assignments: any[] }} change */
  guard.record = ({ key, op, row, changes, users, assignments }) => {
    if (!row) return;
    const options = { now: now() };
    let words = null;
    if (key === 'roleassignments') words = revokeProblem(access, row, assignments, options);
    else if (key === 'users' && op === 'update' && changes?.status === 'Disabled') words = disableProblem(access, row.id, assignments, users, options);
    if (words) throw new AccessDenied(key === 'users' ? 'users.manage' : 'roles.global', words);
  };
  return guard;
}
