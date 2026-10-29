// What the Users screens do to people and their access (Prompt 21, Phase 2; boards 3 and 4): add a person (and give them no access), turn one off or
// on, remove a role, switch an extra, read a person's history. Each change checks what the role matrix allows, goes through the data layer (whose
// write guard asks again, with the rows: lib/data/access-people.js) and writes one line to the audit list (decision J). Giving a role is grants.js's
// grantRole(). The words a person reads (what they lose, their history) are here, so that `node --test` holds them. Plain JS with no DOM.
import { EXTRAS } from './access-matrix.js';
import { AccessDenied } from './access-denied.js';
import { can, extrasOf } from './can.js';
import { disableProblem, placeOf, revokeProblem } from './grants.js';
import { writeAudit } from './audit.js';
import { dayWords, reachWords } from './people.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** What is wrong with an email as typed, in words, or null. */
export const emailProblem = (email) => (EMAIL.test(String(email ?? '').trim()) ? null : 'Type the full email address, like name@deloitte.com.');

/**
 * Adds a person: their row (key: the email in lower case) and one audit line. No role comes with it: a person added has no access to any client.
 * Resolves to { added, already, key }; a person who is there already (even a disabled one) is not written again.
 * @param {any} dataService @param {any} access
 * @param {{ email: string, name?: string, loginName?: string, jobTitle?: string, source?: 'Directory' | 'Typed' }} wanted @param {{ now?: Date }} [options]
 */
export async function addPerson(dataService, access, wanted, { now = new Date() } = {}) {
  const problem = emailProblem(wanted.email);
  if (problem) throw new Error(problem);
  if (!can(access, 'users.manage', {}, { now })) throw new AccessDenied('users.manage');
  const key = wanted.email.trim().toLowerCase();
  const source = wanted.source === 'Directory' ? 'Directory' : 'Typed';
  try {
    await dataService.addAccessRecord('users', {
      id: key, fullName: wanted.name ?? '', email: key, loginName: wanted.loginName ?? '', jobTitle: wanted.jobTitle ?? '', status: 'Active', source,
      addedBy: access?.person?.key ?? '',
    });
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error)?.status === 409) return { added: false, already: true, key };
    throw error;
  }
  await writeAudit(dataService, access, { action: 'add-user', targetUser: key, detail: source === 'Directory' ? 'Added from the directory' : 'Typed in by hand' }, { now });
  return { added: true, already: false, key };
}

/**
 * Turns a person's access off ('Disabled') or on again ('Active'), with an audit line; never deleted (decision J). `rows` ({ users, assignments }, the
 * screen's) lets the guards answer before anything is read; the data layer asks them again with the lists as they are.
 * @param {any} dataService @param {any} access @param {string} userKey @param {'Disabled' | 'Active'} status
 * @param {{ now?: Date, rows?: { users: any[], assignments: any[] } }} [options]
 */
export async function setStatus(dataService, access, userKey, status, { now = new Date(), rows } = {}) {
  if (!can(access, 'users.manage', {}, { now })) throw new AccessDenied('users.manage');
  if (status === 'Disabled' && rows) {
    const words = disableProblem(access, userKey, rows.assignments, rows.users, { now });
    if (words) throw new AccessDenied('users.manage', words);
  }
  await dataService.updateAccessRecord('users', userKey, { status });
  await writeAudit(dataService, access, { action: status === 'Disabled' ? 'disable' : 'enable', targetUser: userKey, detail: status === 'Disabled' ? 'Access turned off' : 'Access turned on' }, { now });
}

const detailOf = (assignment) => `${assignment.role}, ${assignment.scopeType}${placeOf(assignment) ? ` ${placeOf(assignment)}` : ''}`;

/**
 * Removes one assignment, with an audit line. Resolves to { removed, already }: a role already gone is "already", not an error.
 * @param {any} dataService @param {any} access @param {any} assignment @param {any[]} all every assignment on the site (the screen's)
 * @param {{ now?: Date }} [options]
 */
export async function removeRole(dataService, access, assignment, all, { now = new Date() } = {}) {
  const words = revokeProblem(access, assignment, all, { now });
  if (words) throw new AccessDenied('roles.global', words);
  if (!(await dataService.removeAccessRecord('roleassignments', assignment.id))) return { removed: false, already: true };
  await writeAudit(dataService, access, {
    action: 'revoke', targetUser: assignment.userKey, role: assignment.role, clientId: assignment.clientId ?? '', sessionId: assignment.sessionId ?? '', detail: detailOf(assignment),
  }, { now });
  return { removed: true, already: false };
}

/**
 * Sets the extras of an assignment ('users.manage' on an Admin: may also add people; 'content.edit' on a Designer: may also edit activities).
 * @param {any} dataService @param {any} access @param {any} assignment @param {string | string[]} extras @param {any[]} all @param {{ now?: Date }} [options]
 */
export async function setExtras(dataService, access, assignment, extras, all, { now = new Date() } = {}) {
  const words = revokeProblem(access, assignment, all, { now });
  if (words) throw new AccessDenied('roles.global', words);
  const wanted = extrasOf(extras);
  for (const extra of wanted) if (EXTRAS[extra]?.role !== assignment.role) throw new Error(`That extra is not for a ${assignment.role}.`);
  await dataService.updateAccessRecord('roleassignments', assignment.id, { extras: wanted.join(',') });
  await writeAudit(dataService, access, {
    action: 'grant', targetUser: assignment.userKey, role: assignment.role, clientId: assignment.clientId ?? '', sessionId: assignment.sessionId ?? '',
    detail: `${assignment.role}: ${wanted.length ? wanted.map((extra) => EXTRAS[extra].words).join('; ') : 'no extras'}`,
  }, { now });
}

/** What a role lets a person do, as the end of "they will not be able to ...": `its` is the place's own word. */
const ABILITY = (its) => ({
  'Super admin': 'manage people, clients, sessions, activities and results, or delete a session\'s data',
  Admin: 'create clients and sessions or choose who is on their teams',
  Producer: `run ${its} sessions, edit ${its} activities or see ${its} results`,
  Designer: `edit ${its} brand`,
  Leadership: 'see results or export them',
});
const ARTICLE = { 'Super admin': 'a ', Admin: 'an ', Producer: 'a ', Designer: 'a ', Leadership: '' };

/**
 * What removing an assignment takes away, in plain words, for the confirmation.
 * @param {any} assignment @param {string} name the person's @param {{ clients?: any[], sessions?: any[] }} [at]
 */
export function loseWords(assignment, name, at = {}) {
  const place = reachWords({ ...assignment, validUntil: null }, at).replace(/^All clients/, 'all clients');
  const its = assignment.scopeType === 'client' || assignment.scopeType === 'session' ? 'its' : 'their';
  return `${name} will no longer be ${ARTICLE[assignment.role] ?? ''}${assignment.role} for ${place}: they will not be able to ${ABILITY(its)[assignment.role] ?? 'use what it allowed'}.`;
}

/** What an audit line says was done, in words (a person's history and the audit review: lib/access/audit-review.js). @param {any} line */
export const auditWords = (line) => (DID[line.action] ?? (() => line.action))(line);

const DID = {
  'add-user': (line) => line.detail || 'Added',
  grant: (line) => `Given ${line.detail || line.role}`,
  revoke: (line) => `Removed ${line.detail || line.role}`,
  disable: () => 'Turned off',
  enable: () => 'Turned on',
  migrate: () => 'Copied from the old admins list',
};

/**
 * A person's history from the audit lines: theirs only, newest first, as { id, day, when, words }. `names` are the people's names by key.
 * @param {any[]} lines PMSAuditLog records @param {string} userKey @param {{ names?: Record<string, string> }} [options]
 */
export function historyOf(lines, userKey, { names = {} } = {}) {
  const key = String(userKey).toLowerCase();
  return lines.filter((line) => String(line.targetUser ?? '').toLowerCase() === key)
    .sort((a, b) => String(b.occurredAt ?? '').localeCompare(String(a.occurredAt ?? '')))
    .map((line) => ({
      id: line.id, when: line.occurredAt, day: dayWords(line.occurredAt),
      words: `${auditWords(line)} by ${names[line.actor] ?? line.actor}`,
    }));
}
