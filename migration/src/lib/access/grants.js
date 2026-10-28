// Giving and removing roles (Prompt 21, Phase 1): an assignment's id, who may give or remove which role (a Super admin gives Super admin, Admin and
// Leadership for all clients in a period; an Admin gives a client's or a session's team roles), the guards (never the last Super admin, never your
// own roles), and the Super admins now. grantRole() writes the row and its audit line; a grant given twice is "already granted" (the unique AppId:
// SharePoint answers 500, the data layer says 409). Removing and turning a person off are Phase 2's screens: revokeProblem() and disableProblem() are
// their rules, here so that the data layer and the screens share them. Plain JS with no DOM; the admin page and Setup import it.
import { EXTRAS, ROLES, ROLE_SCOPES } from './access-matrix.js';
import { AccessDenied } from './access-denied.js';
import { can, extrasOf, grantsOf } from './can.js';
import { writeAudit } from './audit.js';

const GLOBAL_ROLES = Object.freeze(['Super admin', 'Admin']);
const dayOf = (value) => String(value ?? '').slice(0, 10);

/** The place of an assignment as its id spells it: empty when global, the client, the session, or the period's first and last day. */
export const placeOf = ({ scopeType, clientId, sessionId, periodFrom, periodTo }) => (
  scopeType === 'client' ? clientId ?? '' : scopeType === 'session' ? sessionId ?? '' : scopeType === 'period' ? `${dayOf(periodFrom)}..${dayOf(periodTo)}` : '');
/** An assignment's AppId: user|role|scope|place. The same grant twice is the same id, so SharePoint refuses the second. */
export const assignmentId = (assignment) => `${assignment.userKey}|${assignment.role}|${assignment.scopeType}|${placeOf(assignment)}`;

/** What is wrong with a grant `access` asks for: { words, denied } (denied: a matter of access, not of what was typed), or null. */
function problemOf(access, wanted, now) {
  const { userKey, role, scopeType } = wanted;
  const no = (words, denied = false) => ({ words, denied });
  if (!userKey) return no('Choose the person.');
  if (!ROLES.includes(role)) return no('Choose a role.');
  if (!ROLE_SCOPES[role].includes(scopeType)) {
    return no(GLOBAL_ROLES.includes(role) ? `${role} is for all clients.` : `${role} is for ${ROLE_SCOPES[role].filter((scope) => scope !== 'global').join(', a ')}.`);
  }
  if (scopeType === 'client' && !wanted.clientId) return no('Pick the client.');
  if (scopeType === 'session' && !wanted.sessionId) return no('Pick the session.');
  if (scopeType === 'period' && !(wanted.periodFrom && wanted.periodTo)) return no('Pick the first and the last day of the period.');
  for (const extra of extrasOf(wanted.extras)) if (EXTRAS[extra]?.role !== role) return no(`That extra is not for a ${role}.`);
  // (Decision I: the site owner may give themself a Super admin row, which ends the owner's banner.)
  const ownSuperAdmin = access?.owner && role === 'Super admin';
  if (userKey === access?.person?.key && !ownSuperAdmin) return no('You cannot change your own roles.', true);
  const global = GLOBAL_ROLES.includes(role) || scopeType === 'global' || scopeType === 'period';
  if (global && !can(access, 'roles.global', {}, { now })) {
    return no(role === 'Leadership' ? 'Only a Super admin can give Leadership for all clients.' : `Only a Super admin can give ${role} for all clients.`, true);
  }
  if (!global && !can(access, 'team.assign', { clientId: wanted.clientId, sessionId: wanted.sessionId }, { now })) {
    return no('Your access does not allow giving roles here. Ask an admin if you need it.', true);
  }
  return null;
}

/** The words of what is wrong with a grant, or null. @param {any} access @param {any} wanted @param {{ now?: Date }} [options] */
export const grantProblem = (access, wanted, { now = new Date() } = {}) => problemOf(access, wanted, now)?.words ?? null;

/**
 * Gives a role: checks it, writes the row (GrantedBy: the person giving it) and one audit line. Resolves to { granted, already, id }.
 * @param {{ addAccessRecord: (key: string, fields: object) => Promise<unknown> }} dataService
 * @param {any} access
 * @param {{ userKey: string, role: string, scopeType: string, clientId?: string, sessionId?: string, periodFrom?: string, periodTo?: string, validUntil?: string, extras?: string | string[] }} wanted
 * @param {{ now?: Date }} [options]
 */
export async function grantRole(dataService, access, wanted, { now = new Date() } = {}) {
  const problem = problemOf(access, wanted, now);
  if (problem) throw problem.denied ? new AccessDenied('roles.global', problem.words) : new Error(problem.words);
  const id = assignmentId(wanted);
  const { userKey, role, scopeType, clientId, sessionId, periodFrom, periodTo, validUntil } = wanted;
  const record = Object.fromEntries(Object.entries({
    id, userKey, role, scopeType, clientId: clientId ?? '', sessionId: sessionId ?? '', periodFrom, periodTo, validUntil,
    extras: extrasOf(wanted.extras).join(','), grantedBy: access?.person?.key ?? '',
  }).filter(([, value]) => value !== undefined && value !== null));
  try {
    await dataService.addAccessRecord('roleassignments', record);
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error)?.status === 409) return { granted: false, already: true, id };
    throw error;
  }
  await writeAudit(dataService, access, { action: 'grant', targetUser: userKey, role, clientId: clientId ?? '', sessionId: sessionId ?? '', detail: `${role}, ${scopeType}${placeOf(wanted) ? ` ${placeOf(wanted)}` : ''}${validUntil ? `, until ${dayOf(validUntil)}` : ''}` }, { now });
  return { granted: true, already: false, id };
}

/** Whether a row is a current, global Super admin row. */
const superAdminRow = (row, now) => row.role === 'Super admin' && row.scopeType === 'global' && grantsOf({ person: { key: row.userKey }, user: { status: 'Active' }, assignments: [row] }, { now }).length > 0;

/**
 * What stops `access` removing `assignment` (one of `all`, every assignment on the site), in words, or null: your own roles; Super admin and
 * Admin rows are a Super admin's; a team row needs team.assign there; and at least one Super admin must remain.
 * @param {any} access @param {any} assignment @param {any[]} all @param {{ now?: Date }} [options]
 */
export function revokeProblem(access, assignment, all, { now = new Date() } = {}) {
  if (assignment.userKey === access?.person?.key) return 'You cannot change your own roles.';
  if (GLOBAL_ROLES.includes(assignment.role) || assignment.scopeType === 'global' || assignment.scopeType === 'period') {
    if (!can(access, 'roles.global', {}, { now })) return `Only a Super admin can remove ${assignment.role} for all clients.`;
  } else if (!can(access, 'team.assign', { clientId: assignment.clientId, sessionId: assignment.sessionId }, { now })) {
    return 'Your access does not allow removing roles here. Ask an admin if you need it.';
  }
  if (superAdminRow(assignment, now) && !all.some((row) => row.userKey !== assignment.userKey && superAdminRow(row, now))) return 'At least one Super admin must remain.';
  return null;
}

/**
 * The Super admins now: the active people with a current, global Super admin row (Setup lists them, so that a surprise shows up).
 * @param {any[]} users PMSUsers records @param {any[]} assignments PMSRoleAssignments records @param {{ now?: Date }} [options]
 */
export function superAdmins(users, assignments, { now = new Date() } = {}) {
  return users.filter((user) => (user.status ?? 'Active') !== 'Disabled'
    && grantsOf({ person: { key: user.id }, user, assignments: assignments.filter((row) => row.userKey === user.id) }, { now }).some((grant) => grant.role === 'Super admin'));
}

/**
 * What stops `access` turning a person off (Phase 2; decision J: disabled, never deleted), in words, or null: yourself; a person with a current
 * Super admin or Admin row is a Super admin's to turn off; and at least one active Super admin must remain.
 * @param {any} access @param {string} userKey @param {any[]} assignments every assignment on the site @param {any[]} users every PMSUsers record
 * @param {{ now?: Date }} [options]
 */
export function disableProblem(access, userKey, assignments, users, { now = new Date() } = {}) {
  if (userKey === access?.person?.key) return 'You cannot turn off your own access.';
  const theirs = assignments.filter((row) => row.userKey === userKey);
  const global = theirs.some((row) => GLOBAL_ROLES.includes(row.role) && grantsOf({ person: { key: userKey }, user: { status: 'Active' }, assignments: [row] }, { now }).length > 0);
  if (global && !can(access, 'roles.global', {}, { now })) return 'Only a Super admin can turn off a Super admin or an Admin.';
  const active = superAdmins(users, assignments, { now });
  if (active.some((user) => user.id === userKey) && !active.some((user) => user.id !== userKey)) return 'At least one Super admin must remain.';
  return null;
}
