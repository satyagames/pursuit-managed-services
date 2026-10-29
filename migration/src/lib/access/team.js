// A client's team (Prompt 21, Phase 3; wireframe board 6): who has a Producer's, a Designer's or Leadership's role on the client or on its sessions,
// the people the panel offers (registered and active in PMSUsers only), the Add form's rules (a person, a role, the whole client or selected
// sessions, a Designer's "may also edit activities"), and adding (grants.js grantRole: one row for the whole client, or one for each selected session,
// each with its audit line). Removing is people-ops.js removeRole, with loseWords for the confirmation. Plain JS with no DOM
// (scripts/test-sessions-plan.js); the Clients workspace imports it.
import { EXTRAS } from './access-matrix.js';
import { extrasOf } from './can.js';
import { grantRole } from './grants.js';
import { dayWords, sessionLabel } from './people.js';

/** The roles a client's team is made of, in the order the panel offers them. */
export const TEAM_ROLES = Object.freeze(['Producer', 'Designer', 'Leadership']);
/** The extra the Add form may switch on, a Designer's only (decision A). */
const EDIT_ACTIVITIES = 'content.edit';

const nameOf = (users, key) => {
  const user = users.find((entry) => entry.id === key);
  return user?.fullName || user?.email || key;
};

/**
 * The team of one client: its whole-client rows and its sessions' rows of a team role, by name then role, as { id, assignment, userKey, name, role,
 * reach, extras }. `sessions` are the client's (a row of a session of another client is not this team's).
 * @param {any[]} assignments PMSRoleAssignments records @param {any[]} users PMSUsers records @param {{ clientId: string, sessions: any[] }} place
 */
export function teamRows(assignments, users, { clientId, sessions }) {
  const own = sessions.filter((session) => session.clientId === clientId);
  return assignments
    .filter((row) => TEAM_ROLES.includes(row.role) && ((row.scopeType === 'client' && row.clientId === clientId)
      || (row.scopeType === 'session' && own.some((session) => session.id === row.sessionId))))
    .map((row) => {
      const session = own.find((entry) => entry.id === row.sessionId);
      const reach = row.scopeType === 'client' ? 'Whole client' : session ? sessionLabel(session) : String(row.sessionId);
      return {
        id: row.id, assignment: row, userKey: row.userKey, name: nameOf(users, row.userKey), role: row.role,
        reach: row.validUntil ? `${reach}, until ${dayWords(row.validUntil)}` : reach,
        extras: extrasOf(row.extras).map((extra) => EXTRAS[extra]?.words ?? extra).join('; '),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || TEAM_ROLES.indexOf(a.role) - TEAM_ROLES.indexOf(b.role) || a.reach.localeCompare(b.reach));
}

/** The people the panel offers for `query` (a name or an email, any case): registered in PMSUsers and active, nobody else. @param {any[]} users @param {string} query */
export function teamCandidates(users, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  return users.filter((user) => (user.status ?? 'Active') !== 'Disabled' && (!needle || `${user.fullName ?? ''} ${user.email ?? user.id}`.toLowerCase().includes(needle)));
}

/**
 * @typedef {object} TeamForm
 * @property {string} userKey the person (a PMSUsers AppId)
 * @property {string} role one of TEAM_ROLES
 * @property {'client' | 'sessions'} scope the whole client, or the sessions in `sessionIds`
 * @property {string[]} sessionIds
 * @property {boolean} [editActivities] a Designer's "may also edit activities"
 */

/** What is wrong with the Add form, by field; {} when it can be given. @param {TeamForm} form */
export function teamProblems(form) {
  /** @type {Record<string, string>} */
  const problems = {};
  if (!form.userKey) problems.userKey = 'Choose the person.';
  if (!TEAM_ROLES.includes(form.role)) problems.role = 'Choose Producer, Designer or Leadership.';
  if (form.scope === 'sessions' && (form.sessionIds ?? []).length === 0) problems.sessionIds = 'Pick at least one session.';
  if (form.editActivities && form.role !== 'Designer') problems.editActivities = 'Only a Designer can be allowed to edit activities.';
  return problems;
}

/**
 * Adds a person to a client's team: one assignment for the whole client, or one for each selected session (with the client named on it too), each
 * checked by grantRole() and written with its audit line. Resolves to { added, already }: a role given twice is "already", not an error.
 * @param {any} dataService @param {any} access @param {TeamForm & { clientId: string }} form @param {{ now?: Date }} [options]
 */
export async function addToTeam(dataService, access, form, { now = new Date() } = {}) {
  const problems = Object.values(teamProblems(form));
  if (problems.length) throw new Error(problems[0]);
  const extras = form.editActivities && form.role === 'Designer' ? EDIT_ACTIVITIES : '';
  const places = form.scope === 'sessions'
    ? form.sessionIds.map((sessionId) => ({ scopeType: 'session', clientId: form.clientId, sessionId }))
    : [{ scopeType: 'client', clientId: form.clientId }];
  let [added, already] = [0, 0];
  for (const place of places) {
    const result = await grantRole(dataService, access, { userKey: form.userKey, role: form.role, extras, ...place }, { now });
    if (result.granted) added += 1;
    else already += 1;
  }
  return { added, already };
}
