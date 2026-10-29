// The data layer's write guard (Prompt 21, Phase 1): what lib/data/core.js asks before every write it sends, once a page has installed one
// (dataService.setAccessGuard). It reads the change from the request itself (SharePoint's REST address and X-HTTP-Method, or the local server's
// method and path), finds the list's row of LIST_WRITES in the role matrix, and throws AccessDenied unless can() allows one of its actions for the
// client or session the written item names. Nothing refused is sent. A change it cannot name is refused too (a guardrail allows only what it
// knows). Plain JS with no DOM; the admin page installs it after sign-in. The participant page and Setup install none.
import { LIST_WRITES } from './access-matrix.js';
import { AccessDenied } from './access-denied.js';
import { can } from './can.js';
import { disableProblem, revokeProblem } from './grants.js';
import { UNKNOWN_OWNER, mayRead, newOwners } from './owners.js';

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
 * session's on the sessions list. An item that names only its owner's id (a question's activity, an option's question, a session's start) gets
 * the client from what the page has read (owners.js, Phase 4); an owner not known is the client no assignment names (UNKNOWN_OWNER), so a
 * scoped role is held to a real client, and a global role is not asked for one.
 */
function targetOf({ key, id }, body, owners) {
  const item = body && typeof body === 'object' && !(typeof Blob !== 'undefined' && body instanceof Blob) ? body : {};
  const own = item.AppId ?? item.id ?? id ?? undefined;
  const sessionId = (key === 'sessions' ? own : undefined) ?? item.SessionId ?? item.sessionId ?? undefined;
  const sectionId = (key === 'sections' ? own : undefined) ?? item.SectionId ?? item.sectionId ?? undefined;
  const questionId = (key === 'questions' ? own : undefined) ?? item.QuestionId ?? item.questionId ?? undefined;
  let clientId = (key === 'clients' ? own : undefined) ?? item.ClientId ?? item.clientId ?? undefined;
  // (A write with no body, a SharePoint delete, names nothing: it is held to the list, as before; Phase 7 hardens the lists themselves.)
  if (!clientId && body !== undefined) {
    if (key === 'options') clientId = owners.clientOfQuestion(questionId) ?? UNKNOWN_OWNER;
    else if (key === 'questions') clientId = owners.clientOfQuestion(questionId) ?? owners.clientOfSection(sectionId) ?? UNKNOWN_OWNER;
    else if (key === 'sections') clientId = owners.clientOfSection(sectionId) ?? UNKNOWN_OWNER;
    else if (sessionId && (key === 'sessions' || BY_SESSION_WRITES.has(key))) clientId = owners.clientOfSession(sessionId) ?? UNKNOWN_OWNER;
  }
  return { ...(clientId ? { clientId } : {}), ...(sessionId ? { sessionId } : {}) };
}
/** Lists whose items belong to a session: a write that names one is held to the session's client. */
const BY_SESSION_WRITES = new Set(['tracks', 'uservisitlogs', 'qrtokens', 'visitorroster']);

/** What an allowed write tells the page about owners: a session's, an activity's and a question's, so that what it makes next is held to them. */
function noteWrite(owners, { key, op }, body) {
  if (op !== 'create' || !body || typeof body !== 'object') return;
  const id = body.AppId ?? body.id;
  if (!id) return;
  if (key === 'sessions' && (body.ClientId ?? body.clientId)) owners.sessions.set(id, { clientId: body.ClientId ?? body.clientId, date: body.date ?? String(body.SessionDate ?? '').slice(0, 10) });
  else if (key === 'sections' && (body.ClientId ?? body.clientId)) owners.sections.set(id, body.ClientId ?? body.clientId);
  else if (key === 'questions' && (body.SectionId ?? body.sectionId)) owners.questions.set(id, body.SectionId ?? body.sectionId);
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
  const owners = newOwners();
  const guard = (method, resource, headers = {}, body = undefined) => {
    const change = changeOf(method, resource, headers, keyOfTitle);
    if (change === 'none') return;
    const allowed = change?.op ? LIST_WRITES[change.key]?.[change.op] : undefined;
    if (allowed === 'anyone' && access) return;
    if (Array.isArray(allowed) && allowed.some((action) => can(access, action, targetOf(change, body, owners), { now: now() }))) {
      noteWrite(owners, change, body);
      return;
    }
    throw new AccessDenied(Array.isArray(allowed) && allowed.length ? allowed[0] : 'unknown');
  };
  /** Phase 4: asked before a read of a list that belongs to places (the data layer's readLists, queryItems and listItems); throws AccessDenied for a scoped role that would fetch a place it does not hold. */
  guard.read = (list, where) => {
    if (!mayRead(owners, access, list, where, { now: now() })) throw new AccessDenied('results.view', 'You can open only the clients and sessions you have been given. Ask an admin if you need more.');
  };
  /** Phase 4: told what a read found, so that the owners of sessions, activities and questions are known to later reads and writes. */
  guard.learn = (list, rows) => owners.learn(list, rows);
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
