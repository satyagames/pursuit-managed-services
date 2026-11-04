// Who should be in which PMS group of the site (Prompt 27), worked out from the app's own people and roles, and the read-only comparison with who is. The
// group model: Super admin and Admin belong in PMS staff and PMS access managers, Producer and Designer in PMS staff, Leadership in PMS leadership. The
// groups' ids live in one row of the settings list (AppId `site-groups`, as JSON in its built-in Title), which Setup writes; no page names a group's id.
// Its Part 4 half (below) changes who is in the three managed groups, for a Super admin, with Setup's switch on: only the difference. Plain JS with
// no DOM; the admin page and Setup import it, the participant page never does (`npm run test:bundle`).
import { selectOf } from '../schema/pms-schema.js';
import { can, grantsOf } from './can.js';
import { writeAudit } from './audit.js';

/** The three groups the app changes the members of (Part 4, behind Setup's switch), by the key the row and desiredGroups use. PMS super admins and PMS participants are never here. */
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
/** @returns {('staff' | 'managers' | 'leadership')[]} */
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
    return Object.keys(MANAGED_GROUPS).every((key) => Number.isInteger(groups?.[key]?.id)) ? { ...groups, sync: groups.sync === true } : null;
  } catch { return null; }
}

/** The text the row's Title holds: under the column's 255 characters for any three ids. */
/** `sync` is Setup's switch: whether a Super admin's actions on the admin page change the groups' members (off unless a site owner turns it on). */
export const groupsRowTitle = (ids, sync = false, titles = MANAGED_GROUPS) => JSON.stringify({ ...Object.fromEntries(Object.keys(MANAGED_GROUPS).map((key) => [key, { id: ids[key], title: titles[key] }])), sync });

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
  for (const key of Object.keys(MANAGED_GROUPS)) {
    const title = groups[key].title ?? MANAGED_GROUPS[key];
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

// ---- Part 4: the app changes who is in the three managed groups (a Super admin's, behind Setup's switch) --------------------------------------------

let reading = null;
const learned = new Set();
/** The ids of the three managed groups once groupIds has read them: the write guard refuses any other group (lib/access/guard.js). */
export const knownGroupIds = () => learned;
/** Forgets what was read (a test; or a page that must read the row again). */
export function forgetGroupIds() { reading = null; learned.clear(); }

/**
 * The groups' row, read on the first people action of the page and kept: { staff, managers, leadership, sync }, or null when Setup has not made the
 * groups (or on the local server). Never at sign-in: the sign-in's requests are pinned.
 * @param {any} dataService
 */
/** @returns {Promise<any>} */
export function groupIds(dataService) {
  reading ??= (async () => {
    const answer = await dataService.probeSharePointRead(null, siteGroupsAddress(dataService.sharePointListTitles())).catch(() => ({ ok: false }));
    const groups = answer.ok ? groupsOfRow(results(answer.data)[0]) : null;
    // (Read again next time: a refusal is not an answer, and a switch that is off may be turned on in Setup while this page is open.)
    if (!answer.ok || !groups?.sync) reading = null;
    for (const key of Object.keys(MANAGED_GROUPS)) if (groups) learned.add(groups[key].id);
    return groups;
  })();
  return reading;
}

const quotedEmail = (email) => encodeURIComponent(String(email).replace(/'/g, "''"));
const listOf = (data) => (Array.isArray(data) ? data : results(data));

/**
 * A person's place on the site: { id, loginName, groups: Set of group ids }, or null when they are not on it yet (404). Throws on any other refusal.
 * @param {any} dataService @param {{ id: string, email?: string }} user
 */
export async function membership(dataService, user) {
  const answer = await dataService.probeSharePointRead(null, `/web/siteusers/getbyemail('${quotedEmail(user.email || user.id)}')?$select=Id,LoginName,Groups/Id&$expand=Groups`);
  // (PCOE, 4 Nov 2026: a person not on the site yet is answered "User cannot be found.", not always with 404.)
  if (!answer.ok && (answer.status === 404 || /User cannot be found/i.test(String(answer.message)))) return null;
  if (!answer.ok) throw Object.assign(new Error(answer.message), { status: answer.status });
  return { id: answer.data.Id, loginName: answer.data.LoginName, groups: new Set(listOf(answer.data.Groups).map((group) => group.Id)) };
}

/** The groups' titles as this copy names them (its row says; a copy with a list prefix has its own), else the plain names. */
const titleOf = (key, groups) => groups?.[key]?.title ?? MANAGED_GROUPS[key];
const named = (keys, groups) => (keys.length ? keys.map((key) => titleOf(key, groups)).join(' and ') : 'None');
/** What a person waiting for a Super admin is told, by the groups they need. */
export const waitingWords = (wanted, groups = null) => (wanted.length ? `A Super admin adds them to ${named(wanted, groups)}, so that the pages open for them.` : 'They need no site group.');

/**
 * Makes the person's membership of the three managed groups what their roles ask: reads, compares and changes only the difference, so a second run
 * changes nothing. Never throws: { status: 'done' | 'same' | 'manual' | 'failed', words, groups }. Only a Super admin's call does anything (the guard
 * holds it too), and only with Setup's switch on; the groups the app does not manage are never read for a change, let alone written.
 * @param {any} dataService @param {any} access @param {string} userKey @param {{ now?: Date }} [options]
 */
export async function syncSiteAccess(dataService, access, userKey, { now = new Date() } = {}) {
  let wanted = [];
  try {
    const { user, assignments } = await dataService.readAccessRows(userKey);
    if (!user) return { status: 'manual', words: 'This person is not in People.', groups: [] };
    wanted = desiredGroups(user, assignments, now);
    if (!can(access, 'roles.global', {}, { now })) return { status: 'manual', words: waitingWords(wanted), groups: wanted };
    const groups = await groupIds(dataService);
    if (!groups) return { status: 'manual', words: `Setup has not made the site groups yet. ${waitingWords(wanted)}`, groups: wanted };
    if (!groups.sync) return { status: 'manual', words: waitingWords(wanted, groups), groups: wanted };
    const found = await membership(dataService, user);
    const actual = Object.keys(MANAGED_GROUPS).filter((key) => found?.groups.has(groups[key].id));
    const add = wanted.filter((key) => !actual.includes(key));
    const remove = actual.filter((key) => !wanted.includes(key));
    if (!add.length && !remove.length) return { status: 'same', words: `Site access: ${named(wanted, groups)}.`, groups: wanted };
    for (const key of [...add, ...remove]) {
      const group = await dataService.probeSharePointRead(null, `/web/sitegroups/getbyid(${groups[key].id})?$select=CanCurrentUserEditMembership`);
      if (!group.ok || !group.data?.CanCurrentUserEditMembership) {
        return { status: 'manual', words: `SharePoint does not let you change ${titleOf(key, groups)}. ${waitingWords(wanted, groups)}`, groups: wanted };
      }
    }
    let id = found?.id;
    if (add.length) {
      let login = found?.loginName || user.loginName;
      if (!login) login = (await dataService.searchDirectory(user.email || user.id, { max: 1 }).catch(() => null))?.find((entry) => entry.email === (user.email || user.id))?.loginName;
      if (!login) return { status: 'manual', words: `This person could not be found in the directory. ${waitingWords(wanted, groups)}`, groups: wanted };
      // (A stored claim SharePoint will not resolve is tried once more by the email, which PCOE resolved, 4 Nov 2026.)
      const email = user.email || user.id;
      const made = await dataService.sendToSharePoint('POST', '/web/ensureuser', { logonName: login }).catch((cause) => {
        if (login === email || !/User cannot be found|could not be found/i.test(String(cause?.message))) throw cause;
        return dataService.sendToSharePoint('POST', '/web/ensureuser', { logonName: email });
      });
      id = made?.Id ?? id;
      for (const key of add) {
        await dataService.sendToSharePoint('POST', `/web/sitegroups/getbyid(${groups[key].id})/users`, { __metadata: { type: 'SP.User' }, LoginName: made?.LoginName ?? login });
        await writeAudit(dataService, access, { action: 'site-add', targetUser: user.id, detail: key }, { now });
      }
    }
    for (const key of remove) {
      await dataService.sendToSharePoint('POST', `/web/sitegroups/getbyid(${groups[key].id})/users/removebyid(${id})`);
      await writeAudit(dataService, access, { action: 'site-remove', targetUser: user.id, detail: key }, { now });
    }
    const changes = [add.length ? `added to ${named(add, groups)}` : '', remove.length ? `taken out of ${named(remove, groups)}` : ''].filter(Boolean).join('; ');
    return { status: 'done', words: `Site access: ${named(wanted, groups)} (${changes}).`, groups: wanted };
  } catch (cause) {
    const guid = dataService.sessionEvidence?.().at(-1)?.requestGuid;
    const said = String(cause?.message ?? cause).replace(/^SharePoint \(\d+\):\s*/, '');
    return { status: 'failed', words: `Could not change site access: ${said}${guid ? ` (SPRequestGuid ${guid})` : ''}`, groups: wanted };
  }
}
