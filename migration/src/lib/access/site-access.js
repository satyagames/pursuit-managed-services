// Who should be in which PMS group of the site (Prompt 27), worked out from the app's own people and roles, and the read-only comparison with who is. The
// group model: Super admin and Admin belong in PMS staff and PMS access managers, Producer and Designer in PMS staff, Leadership in PMS leadership. The
// groups' ids live in one row of the settings list (AppId `site-groups`, as JSON in its built-in Title), which Setup writes; no page names a group's id.
// This module changes nothing on the site: changing membership is Part 4 of the brief, not built until the owner's console test has passed. Plain JS with
// no DOM; the admin page and Setup import it, the participant page never does (`npm run test:bundle`).
import { selectOf } from '../schema/pms-schema.js';
import { grantsOf } from './can.js';

/** The three groups the app may one day change the members of, by the key the row and desiredGroups use. PMS super admins and PMS participants are never here. */
export const MANAGED_GROUPS = Object.freeze({ staff: 'PMS staff', managers: 'PMS access managers', leadership: 'PMS leadership' });
/** The AppId of the settings list's row that holds the groups' ids. */
export const SITE_GROUPS_ITEM = 'site-groups';

const TO_GROUPS = Object.freeze({ 'Super admin': ['staff', 'managers'], Admin: ['staff', 'managers'], Producer: ['staff'], Designer: ['staff'], Leadership: ['leadership'] });
const lower = (value) => String(value ?? '').trim().toLowerCase();
const nextOf = (data) => data?.__next ?? data?.['odata.nextLink'] ?? null;
const results = (data) => data?.results ?? data?.value ?? [];

/**
 * The groups a person should be in, in MANAGED_GROUPS' order: turned off, expired or no current role is none; mixed roles are the union.
 * @param {{ id: string, status?: string }} user a PMSUsers record
 * @param {{ userKey: string, role: string }[]} assignments any rows; only the person's own count
 * @param {Date} [now]
 */
export function desiredGroups(user, assignments = [], now = new Date()) {
  const mine = assignments.filter((assignment) => assignment.userKey === user.id);
  const grants = grantsOf({ person: null, owner: false, legacy: false, user, assignments: mine }, { now });
  const wanted = new Set(grants.flatMap((grant) => TO_GROUPS[grant.role] ?? []));
  return Object.keys(MANAGED_GROUPS).filter((key) => wanted.has(key));
}

/** The address that reads the groups' row of the settings list: its own filter, naming its columns. */
export const siteGroupsAddress = (titles) => `/web/lists/getbytitle('${encodeURIComponent(String(titles.appsettings).replace(/'/g, "''"))}')/items?$filter=AppId eq '${SITE_GROUPS_ITEM}'&$top=2&${selectOf('appsettings')},Title`;

/** The groups' row as { staff: { id, title }, managers, leadership }, or null when it is missing or is not all three. */
export function groupsOfRow(row) {
  try {
    const groups = JSON.parse(row?.Title ?? '');
    return Object.keys(MANAGED_GROUPS).every((key) => Number.isInteger(groups?.[key]?.id)) ? groups : null;
  } catch { return null; }
}

/** The text the row's Title holds: under the column's 255 characters for any three ids. */
export const groupsRowTitle = (ids) => JSON.stringify(Object.fromEntries(Object.entries(MANAGED_GROUPS).map(([key, title]) => [key, { id: ids[key], title }])));

/**
 * The comparison, with nothing asked of the site.
 * @param {{ users: any[], assignments: any[], members: Record<string, { Title?: string, Email?: string, LoginName?: string }[]>, now?: Date }} input
 * @returns {{ waiting: any[], more: any[], strangers: any[] }} waiting: a group is missing (the Admin's hand-off queue); more: in a group the roles do not ask for; strangers: in a group, not in People
 */
export function driftOf({ users, assignments, members, now = new Date() }) {
  const namesOf = (member) => [lower(member.LoginName), lower(member.Email)].filter(Boolean);
  const isThem = (user, member) => namesOf(member).some((name) => [lower(user.id), lower(user.email), lower(user.loginName)].includes(name) || name.split('|').at(-1) === lower(user.id));
  const inGroup = (user, key) => (members[key] ?? []).some((member) => isThem(user, member));
  const words = (user) => ({ key: user.id, name: user.fullName || user.email || user.id, email: user.email || user.id });
  const waiting = [];
  const more = [];
  for (const user of users) {
    const wanted = desiredGroups(user, assignments, now);
    const actual = Object.keys(MANAGED_GROUPS).filter((key) => inGroup(user, key));
    const missing = wanted.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !wanted.includes(key));
    if (missing.length) waiting.push({ ...words(user), missing });
    if (extra.length) more.push({ ...words(user), extra });
  }
  const strangers = new Map();
  for (const key of Object.keys(MANAGED_GROUPS)) {
    for (const member of members[key] ?? []) {
      if (users.some((user) => isThem(user, member))) continue;
      const id = namesOf(member)[0] ?? lower(member.Title);
      strangers.set(id, { name: member.Title || member.Email || member.LoginName, groups: [...(strangers.get(id)?.groups ?? []), key] });
    }
  }
  return { waiting, more, strangers: [...strangers.values()] };
}

/**
 * The drift report: one read of the row, then the members of each group, a page at a time by `__next`. Reads only, and never throws: `ready` false says why.
 * @param {(resource: string) => Promise<any>} read one GET of the REST API that throws on a refusal
 * @param {Record<string, string>} titles
 * @param {{ users: any[], assignments: any[], now?: Date }} people
 */
export async function readDrift(read, titles, people) {
  let groups;
  try {
    groups = groupsOfRow(results(await read(siteGroupsAddress(titles)))[0]);
  } catch (cause) {
    return { ready: false, words: `Could not read which groups Setup made (${cause.status ?? 'no answer'}: ${cause.message})` };
  }
  if (!groups) return { ready: false, words: 'Setup has not made the site groups yet. A site owner does that once, with Apply on the Setup page.' };
  const members = {};
  for (const [key, title] of Object.entries(MANAGED_GROUPS)) {
    try {
      members[key] = [];
      for (let address = `/web/sitegroups/getbyid(${groups[key].id})/users?$select=Id,Title,Email,LoginName&$top=500`; address;) {
        const data = await read(address);
        members[key].push(...results(data));
        address = nextOf(data);
      }
    } catch (cause) {
      return { ready: false, words: `Could not read the members of ${title} (${cause.status ?? 'no answer'}: ${cause.message})` };
    }
  }
  return { ready: true, groups, drift: driftOf({ ...people, members }) };
}

/** The drift in one sentence, for Setup's self-test. */
export const driftWords = ({ waiting, more, strangers }) => `${waiting.length} waiting for site access, ${more.length} with more access than the role says, ${strangers.length} in a group but not in People.`;
