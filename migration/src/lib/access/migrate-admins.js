// The switch-over (Prompt 21, Phase 1): Setup's one-time copy of PMSAdminUsers into PMSUsers and PMSRoleAssignments. An old admin is a name and the
// hash of a PIN, with no email, so the person running Setup types each one's email; an admin left without one is skipped and keeps the PIN.
// Each admin copied becomes an active person with Admin, and Producer and Designer on all clients: ASSUMED (an open item for the manager), because
// board 10's Admin alone may not run a session, edit content or see results, and an existing admin must keep working. Delete session becomes a
// Super admin's (decision E). Idempotent: a second run finds every row there already and says so in its counts. PMSAdminUsers itself is left as it
// was, read only for one release. Never reads, writes or shows a PIN hash. Plain JS with no DOM; only Setup imports it.
import { AccessDenied } from './access-denied.js';
import { can } from './can.js';
import { assignmentId } from './grants.js';
import { writeAudit } from './audit.js';

/** The roles an old admin is given. */
export const MIGRATED_ROLES = Object.freeze(['Admin', 'Producer', 'Designer']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adds a row; resolves to true when it was added and false when it was there already (409). */
async function added(dataService, key, fields) {
  try {
    await dataService.addAccessRecord(key, fields);
    return true;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error)?.status === 409) return false;
    throw error;
  }
}

/**
 * Copies the old admins given an email in `emails` (by their PMSAdminUsers id). Resolves to the counts: { people, peopleAlready, roles,
 * rolesAlready, skipped } (`skipped`: the names of the admins with no email, who keep their PIN).
 * @param {{ listAdminUsers: () => Promise<{ id: string, name: string }[]>, addAccessRecord: (key: string, fields: object) => Promise<unknown> }} dataService
 * @param {any} access the person running Setup (a Super admin: the site owner is one)
 * @param {Record<string, string>} emails
 * @param {{ now?: Date, admins?: { id: string, name: string }[] }} [options] `admins`: the old admins when already read
 */
export async function migrateAdmins(dataService, access, emails, { now = new Date(), admins } = {}) {
  if (!can(access, 'roles.global', {}, { now }) || !can(access, 'users.manage', {}, { now })) {
    throw new AccessDenied('roles.global', 'Only a Super admin can copy the admins into the new lists.');
  }
  for (const value of Object.values(emails)) {
    const email = String(value ?? '').trim();
    if (email && !EMAIL.test(email)) throw new Error(`"${email}" is not an email address.`);
  }
  const legacy = admins ?? await dataService.listAdminUsers();
  const counts = { people: 0, peopleAlready: 0, roles: 0, rolesAlready: 0, skipped: /** @type {string[]} */ ([]) };
  const by = access?.person?.key ?? '';
  for (const admin of legacy) {
    const email = String(emails[admin.id] ?? '').trim().toLowerCase();
    if (!email) { counts.skipped.push(admin.name); continue; }
    if (await added(dataService, 'users', { id: email, fullName: admin.name, email, status: 'Active', source: 'Typed', addedBy: by })) {
      counts.people += 1;
      await writeAudit(dataService, access, { action: 'add-user', targetUser: email, detail: 'Copied from the old admins list.' }, { now });
    } else counts.peopleAlready += 1;
    for (const role of MIGRATED_ROLES) {
      const id = assignmentId({ userKey: email, role, scopeType: 'global' });
      if (await added(dataService, 'roleassignments', { id, userKey: email, role, scopeType: 'global', clientId: '', sessionId: '', extras: '', grantedBy: by })) {
        counts.roles += 1;
        await writeAudit(dataService, access, { action: 'migrate', targetUser: email, role, detail: `${role}, global: copied from the old admins list.` }, { now });
      } else counts.rolesAlready += 1;
    }
  }
  return counts;
}
