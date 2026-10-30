// Who is signed in, and what that lets them do (Prompt 21, Phase 1). resolveAccess() asks the data layer who the account is and whether it owns the
// site (one request), then reads their PMSUsers row and PMSRoleAssignments rows (two indexed reads, sent together): the cost stays the same whatever the
// number of people. The answer is kept for the page until it is asked again with `refresh`. signInStep() is the admin page's decision, in the
// order of board 2: the site owner enters as a Super admin (decision I; a banner until they have a Super admin row of their own); a listed,
// active person with a current role enters; a listed person who is disabled, or has no current role, sees No access; anyone not listed tries a
// PIN from PMSAdminUsers, as before the switch-over. Plain JS with no DOM; the admin page and Setup import it.
import { grantsOf, userKeyOf } from './can.js';

/** The access of each data service (a page has one; a test may have several), once read. */
let kept = new WeakMap();
/** Forgets every access read so far: the next resolveAccess() reads again. */
export const forgetAccess = () => { kept = new WeakMap(); };

/**
 * The signed-in person's access: { person, owner, legacy: false, user, assignments }. `person` is null on the local server, where nobody is signed
 * in. A person whose account names no email has no key, and so no row.
 * @param {{ readSignedInPerson: () => Promise<any>, readAccessRows: (key: string) => Promise<{ user: any, assignments: any[] }> }} dataService
 * @param {{ refresh?: boolean }} [options]
 */
export async function resolveAccess(dataService, { refresh = false } = {}) {
  if (!refresh && kept.has(dataService)) return kept.get(dataService);
  const reading = (async () => {
    const raw = await dataService.readSignedInPerson();
    if (!raw) return { person: null, owner: false, legacy: false, user: null, assignments: [] };
    const key = userKeyOf(raw);
    const person = { key, email: key ?? '', name: raw.Title ?? '', loginName: raw.LoginName ?? '', id: raw.Id ?? null };
    const rows = key ? await dataService.readAccessRows(key) : { user: null, assignments: [] };
    return { person, owner: raw.owner === true, legacy: false, user: rows.user ?? null, assignments: rows.assignments ?? [] };
  })();
  kept.set(dataService, reading);
  try {
    return await reading;
  } catch (error) {
    kept.delete(dataService);
    throw error;
  }
}

/**
 * What the admin page does with an access: { step: 'enter' | 'pin' | 'no-access', banner: 'owner' | null, reason }. `reason` says why there is no
 * entry yet: 'local' (nobody signed in, the local server), 'not-listed' (no row: the PIN, as before), 'disabled', 'no-roles'.
 * @param {any} access @param {{ now?: Date }} [options]
 */
export function signInStep(access, { now = new Date() } = {}) {
  if (!access?.person) return { step: 'pin', banner: null, reason: 'local' };
  const own = grantsOf({ ...access, owner: false, legacy: false }, { now });
  if (access.owner) return { step: 'enter', banner: own.some((grant) => grant.role === 'Super admin') ? null : 'owner', reason: null };
  if (!access.user) return { step: 'pin', banner: null, reason: 'not-listed' };
  if ((access.user.status ?? 'Active') === 'Disabled') return { step: 'no-access', banner: null, reason: 'disabled' };
  if (!own.length) return { step: 'no-access', banner: null, reason: 'no-roles' };
  return { step: 'enter', banner: null, reason: null };
}

// ---- Turned off while the page is open (Prompt 21, Phase 6) -------------------------------------------------------------------------
// The access is read once, at sign-in. The admin page reads it again when the person opens a tab or comes back to the page, at most once every
// RECHECK_AFTER_MS, so a normal visit sends no more requests than before (ASSUMED five minutes: a Super admin's change reaches an open page within that
// long of its next use; Phase 7's list permissions are the boundary). When the new answer would not let the person in, the page stops.

/** The least time between two reads of the same person's access while the page is open. */
export const RECHECK_AFTER_MS = 5 * 60_000;

/** Whether the access is due to be read again. @param {number} lastReadAt @param {number} now */
export const recheckDue = (lastReadAt, now) => now - lastReadAt >= RECHECK_AFTER_MS;

/**
 * What a person who was in has lost, from their access read again: 'turned-off' (disabled), 'role-removed' (no current role, an end date passed, or
 * their row has gone), or null while they may still enter. The site owner is always a Super admin (decision I), so never loses it.
 * @param {any} access @param {{ now?: Date }} [options]
 */
export function lostAccess(access, options = {}) {
  const step = signInStep(access, options);
  if (step.step === 'enter') return null;
  return step.reason === 'disabled' ? 'turned-off' : 'role-removed';
}

/** The access of a page that has stopped: the person, with no role at all, so the write guard refuses every write. @param {any} access */
export const withoutGrants = (access) => ({ ...access, owner: false, legacy: false, assignments: [] });
