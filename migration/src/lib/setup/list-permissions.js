// The access lists' own permissions (Prompt 21, Phase 7): what moves the access check from a guardrail in the page towards a boundary on the site.
// The page's check (lib/access/can.js) holds only what the page sends; a person who knows SharePoint's addresses could write to a list the site lets
// them write. So the two lists that say who may do what (PMSUsers, PMSRoleAssignments) are written only by a small SharePoint group and the site's
// owners, and the audit list (PMSAuditLog) takes new lines from everyone and lets no one but the owners change or delete one (a custom permission level).
//
// ASSUMED until tried on the PCOE site (QA-TESTING.md): the group's and the level's names, that the owners' group's name ends in "Owners" (SharePoint's
// default), and that the site lets its owners break a list's inheritance. The self-test reads what is set and says what differs (permissionProbe, read
// only, two requests a list). Producers and designers keep write access to the content lists (they edit them), so the separation between clients there is
// the app's alone; a server component would be needed for more (docs/SHAREPOINT.md). Plain JS with no DOM; only the Setup page imports it.
//
// The apply half (Prompt 27), pressed by a site owner: readPermissionState, permissionPlan, applyPermissions and, later and apart, removeSiteGroups. Apply
// rehearses on a scratch list and folder, makes the PMS groups and the level, then for each list and the pages' folder breaks inheritance WITH a copy and
// grants; it removes nothing, so the people who reach the app through the site's own groups keep working. Remove the site's groups is the second button,
// for when they have been moved. A list that already has unique permissions is added to (the owner's option 1, 3 Nov 2026), unless a PMS group holds
// another level there: then it Differs and is left alone. Every REST call here other than the reads
// above is ASSUMED: no site has answered one yet (QA-TESTING.md).
import { MANAGED_GROUPS, SITE_GROUPS_ITEM, groupsOfRow, groupsRowTitle, siteGroupsAddress } from '../access/site-access.js';

/** The lists and what each needs: 'managers' (only the access group and the owners write), 'add-only' (everyone adds, no one else changes). */
export const PERMISSION_LISTS = Object.freeze({ users: 'managers', roleassignments: 'managers', auditlog: 'add-only' });
/** The SharePoint group whose members may write the people lists: the Super admins and the Admins, who give team roles (ASSUMED name). */
export const ACCESS_GROUP = 'PMS access managers';
/** The custom permission level the site's members hold on the audit list: View and Add, no Edit, no Delete (ASSUMED name). */
export const ADD_ONLY_LEVEL = 'PMS add only';
/** The self-test step's name. */
export const PROBE_PERMISSIONS = 'Probe (read-only): who may change the access lists';

// SP.PermissionKind: AddListItems is 2, EditListItems 3, DeleteListItems 4; kind k is bit k - 1 of BasePermissions.Low.
const ADD = 1 << 1;
const EDIT = 1 << 2;
const DELETE = 1 << 3;
const OWNERS = /\bowners$/i; // ASSUMED: SharePoint's default "<site> Owners"

// (Prompt 26's plain reads give an expanded collection as an array of its own: the levels of a binding.)
const results = (data) => (Array.isArray(data) ? data : data?.results ?? data?.value ?? []);
const maskOf = (level) => Number(level?.BasePermissions?.Low ?? 0) >>> 0;
const levelsOf = (binding) => results(binding?.RoleDefinitionBindings);
const holds = (binding, bits) => levelsOf(binding).some((level) => (maskOf(level) & bits) !== 0);
const nameOf = (binding) => String(binding?.Member?.Title ?? binding?.Member?.LoginName ?? 'someone');
const joined = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/**
 * What a site owner sets by hand, in plain words, for Setup's plan.
 * @param {Record<string, string>} titles the lists' titles by key (dataService.sharePointListTitles())
 */
export function permissionSteps(titles) {
  return [
    `Make a SharePoint group named "${ACCESS_GROUP}" and put the Super admins and the Admins in it (an Admin gives team roles, and with the extra adds people).`,
    `${titles.users} and ${titles.roleassignments}: stop inheriting permissions; give "${ACCESS_GROUP}" Contribute and the site's members Read.`,
    `Make a permission level named "${ADD_ONLY_LEVEL}": View Items, Add Items and Open, and not Edit Items or Delete Items.`,
    `${titles.auditlog}: stop inheriting permissions; give the site's members "${ADD_ONLY_LEVEL}". Only the owners keep Full Control.`,
  ];
}

/**
 * What differs from the plan, list by list: [{ key, ok, words }].
 * @param {Record<string, { unique: boolean, bindings: any[] } | null>} read each list's HasUniqueRoleAssignments and its role assignments (Member, RoleDefinitionBindings)
 * @param {Record<string, string>} titles
 */
export function permissionFindings(read, titles) {
  return Object.entries(PERMISSION_LISTS).map(([key, kind]) => {
    const title = titles[key];
    const list = read[key];
    if (!list) return { key, ok: false, words: `${title}: not read.` };
    if (!list.unique) return { key, ok: false, words: `${title} still inherits the site's permissions: every member of the site may change it.` };
    const others = list.bindings.filter((binding) => !OWNERS.test(nameOf(binding)));
    if (kind === 'managers') {
      const loose = others.filter((binding) => nameOf(binding) !== ACCESS_GROUP && holds(binding, ADD | EDIT | DELETE)).map(nameOf);
      return loose.length ? { key, ok: false, words: `${joined(loose)} may change ${title}: only "${ACCESS_GROUP}" and the owners should.` } : { key, ok: true, words: `${title}: as planned.` };
    }
    const loose = others.filter((binding) => holds(binding, EDIT | DELETE)).map(nameOf);
    if (loose.length) return { key, ok: false, words: `${joined(loose)} may change or delete lines of ${title}: give them "${ADD_ONLY_LEVEL}" instead.` };
    if (!others.some((binding) => holds(binding, ADD))) return { key, ok: false, words: `No one but the owners can add lines to ${title}: the admin page cannot write its history.` };
    return { key, ok: true, words: `${title}: as planned.` };
  });
}

/** OData quotes a quote by doubling it, and the title is then encoded as part of the address. */
const address = (title) => `/web/lists/getbytitle('${encodeURIComponent(String(title).replace(/'/g, "''"))}')`;

/**
 * The self-test step: reads each access list's permissions (two GETs a list, no item) and says what it found. Never throws: a refused read (another
 * account than an owner's may not read permissions) is said.
 * @param {(list: string | null, query: string) => Promise<any>} probe dataService.probeSharePointRead
 * @param {Record<string, string>} titles
 */
export async function permissionProbe(probe, titles) {
  const read = {};
  const refused = [];
  for (const key of Object.keys(PERMISSION_LISTS)) {
    const unique = await probe(null, `${address(titles[key])}?$select=HasUniqueRoleAssignments`);
    const bindings = await probe(null, `${address(titles[key])}/roleassignments?$expand=Member,RoleDefinitionBindings&$select=Member/Title,Member/LoginName,RoleDefinitionBindings/Name,RoleDefinitionBindings/BasePermissions`);
    const failed = [unique, bindings].find((answer) => !answer.ok);
    if (failed) { refused.push(`Could not read the permissions of ${titles[key]} (${failed.status ?? 'no answer'}: ${failed.message})`); continue; }
    read[key] = { unique: Boolean(unique.data?.HasUniqueRoleAssignments), bindings: results(bindings.data) };
  }
  const found = permissionFindings(read, titles).filter((each) => read[each.key]).map((each) => each.words);
  return `${[...found, ...refused].join(' ')} The page checks every write itself; these permissions are what holds when someone writes to the lists another way. `
    + 'ASSUMED until tried on this site (QA-TESTING.md).';
}

// ---- The apply half (Prompt 27) ---------------------------------------------------------------------------------------------------------------------

/** The five groups, by key. The code changes the members of none of them: Setup makes them and sets their owners. */
export const PMS_GROUPS = Object.freeze({ superadmins: 'PMS super admins', ...MANAGED_GROUPS, participants: 'PMS participants' });
/** The lists a participant account must not be able to read. */
export const SECRET_LISTS = Object.freeze(['adminusers', 'users', 'roleassignments', 'auditlog', 'sessionsummary']);
/** The scratch list and folder of the rehearsal. */
const SCRATCH_LIST = 'PMSPermissionProbe';
const SCRATCH_FOLDER = '_pms-probe';
/** View Items, Add Items, Open, View Pages; no Edit and no Delete. */
const ADD_ONLY_BITS = Object.freeze({ High: '0', Low: '196611' });
const KIND = Object.freeze({ limited: 1, read: 2, contribute: 3, full: 5 });

const content = (participants) => ({ participants, staff: 'contribute', leadership: 'read' });
/** Who holds what, list by list: the owners' group keeps Full Control on all of them and is not named here. (Settled with the owner, Prompt 27.) */
export const GROUP_MATRIX = Object.freeze({
  clients: content('read'),
  sessions: content('contribute'),
  sections: content('read'),
  questions: content('read'),
  options: content('read'),
  tracks: content('contribute'),
  qrtokens: content('contribute'),
  appsettings: content('read'),
  visitorroster: content('read'),
  uservisitlogs: content('contribute'),
  responses: content('contribute'),
  adminusers: { staff: 'read' },
  users: { staff: 'read', managers: 'contribute', leadership: 'read' },
  roleassignments: { staff: 'read', managers: 'contribute', leadership: 'read' },
  auditlog: { staff: 'add-only' },
  sessionsummary: { staff: 'contribute', leadership: 'read' },
  logoLibrary: content('read'),
  // (The folder the pages are in, never its library: the site holds other things. Staff read it too: new pages are a site owner's to upload.)
  pages: { participants: 'read', staff: 'read', leadership: 'read' },
});
const CELL_WORDS = Object.freeze({ read: 'Read', contribute: 'Contribute', 'add-only': ADD_ONLY_LEVEL });
const PAGES_WORDS = "The pages' folder";
const titleOfKey = (titles, key) => (key === 'pages' ? PAGES_WORDS : titles[key] ?? key);

/** The matrix as Setup prints it before Apply. */
export const matrixTable = (titles) => ({
  head: ['List', PMS_GROUPS.participants, PMS_GROUPS.staff, PMS_GROUPS.managers, PMS_GROUPS.leadership],
  rows: Object.entries(GROUP_MATRIX).map(([key, cells]) => [titleOfKey(titles, key), ...['participants', 'staff', 'managers', 'leadership'].map((group) => CELL_WORDS[cells[group]] ?? 'None')]),
});

const quoted = (text) => encodeURIComponent(String(text).replace(/'/g, "''"));
const folderAddress = (folder) => `/web/GetFolderByServerRelativeUrl('${quoted(folder)}')`;
const targetAddress = (key, titles, folder) => (key === 'pages' ? `${folderAddress(folder)}/ListItemAllFields` : address(titles[key]));
const BINDINGS = '/roleassignments?$expand=Member,RoleDefinitionBindings&$select=PrincipalId,Member/Id,Member/Title,Member/LoginName,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind,RoleDefinitionBindings/BasePermissions';
const saidOf = (cause) => String(cause?.message ?? cause).replace(/^SharePoint \(\d+\):\s*/, '');

const bindingOf = (raw) => ({
  principalId: raw.PrincipalId ?? raw.Member?.Id, title: nameOf(raw), levels: levelsOf(raw).filter((level) => level.RoleTypeKind !== KIND.limited), raw,
});

/** One list's or the folder's permissions: { unique, bindings, raw }, { missing: true } when it is not there, { root: true } when the folder is a library's root. */
async function readTarget(read, key, titles, folder) {
  const where = targetAddress(key, titles, folder);
  try {
    const head = await read(`${where}?$select=${key === 'pages' ? 'Id,' : ''}HasUniqueRoleAssignments`);
    if (key === 'pages' && head?.Id === undefined) return { root: true };
    const raw = results(await read(`${where}${BINDINGS}`));
    return { unique: Boolean(head?.HasUniqueRoleAssignments), raw, bindings: raw.map(bindingOf) };
  } catch (cause) {
    if (cause.status === 404) return { missing: true };
    throw cause;
  }
}

/**
 * What the plan needs to know, by reads alone.
 * @param {(resource: string) => Promise<any>} read
 * @param {Record<string, string>} titles
 * @param {string} folder the server-relative address of the folder the pages are in
 */
export async function readPermissionState(read, titles, folder) {
  const [groups, levels, owners, ownerUsers, me] = await Promise.all([
    read('/web/sitegroups?$select=Id,Title,OwnerTitle,AllowMembersEditMembership&$top=5000'),
    read('/web/roledefinitions?$select=Id,Name,RoleTypeKind,BasePermissions'),
    read('/web/AssociatedOwnerGroup?$select=Id,Title'),
    read('/web/AssociatedOwnerGroup/users?$select=Id&$top=5000'),
    read('/web/currentuser?$select=Id,IsSiteAdmin'),
  ]);
  const targets = {};
  for (const key of Object.keys(GROUP_MATRIX)) targets[key] = await readTarget(read, key, titles, folder);
  let row = null;
  try { row = results(await read(siteGroupsAddress(titles)))[0] ?? null; } catch (cause) { if (cause.status !== 404) throw cause; }
  return {
    groups: results(groups), levels: results(levels), owners, targets, row, folder,
    me: me?.Id, keepsFullControl: Boolean(me?.IsSiteAdmin) || results(ownerUsers).some((user) => user.Id === me?.Id),
  };
}

const groupNamed = (state, title) => state.groups.find((group) => group.Title.toLowerCase() === title.toLowerCase());
const levelNamed = (state, name) => state.levels.find((level) => level.Name === name);
const bitsMatch = (level) => String(level?.BasePermissions?.Low) === ADD_ONLY_BITS.Low && String(level?.BasePermissions?.High) === ADD_ONLY_BITS.High;
const ownerOf = (key, state) => (MANAGED_GROUPS[key] ? PMS_GROUPS.superadmins : state.owners.Title);
const holdsFull = (target, ownersId) => target.bindings.some((binding) => binding.principalId === ownersId && binding.levels.some((level) => level.RoleTypeKind === KIND.full));

/** Whether a level is the one a cell of the matrix names. */
const isCell = (level, cell) => (cell === 'add-only' ? level.Name === ADD_ONLY_LEVEL : level.RoleTypeKind === KIND[cell]);
const heldBy = (target, group) => target.bindings.find((binding) => binding.title === PMS_GROUPS[group])?.levels ?? [];
/** Whether the groups the matrix names hold exactly their level on this list. */
const holdsMatrix = (target, key) => Object.entries(GROUP_MATRIX[key]).every(([group, cell]) => {
  const levels = heldBy(target, group);
  return levels.length === 1 && isCell(levels[0], cell);
});
/**
 * (The owner, 3 Nov 2026: option 1.) A list with permissions of its own that Apply may add to: every PMS group the matrix names holds either nothing on
 * it or exactly its level. A group holding another level makes it Differs.
 */
const mayAddTo = (target, key) => Object.entries(GROUP_MATRIX[key]).every(([group, cell]) => {
  const levels = heldBy(target, group);
  return levels.length === 0 || (levels.length === 1 && isCell(levels[0], cell));
});

/**
 * The checklist, from a state as read: every step { id, words, state } with state 'Done', 'To do' or 'Differs'. A 'Differs' is never changed.
 * @param {Awaited<ReturnType<typeof readPermissionState>>} state
 * @param {Record<string, string>} titles
 */
export function permissionPlan(state, titles) {
  const steps = [];
  for (const [key, title] of Object.entries(PMS_GROUPS)) {
    steps.push({ id: `group:${key}`, words: `The group "${title}"`, state: groupNamed(state, title) ? 'Done' : 'To do' });
  }
  const level = levelNamed(state, ADD_ONLY_LEVEL);
  steps.push({ id: 'level', words: `The permission level "${ADD_ONLY_LEVEL}": ${level && !bitsMatch(level) ? 'it exists, with other rights. Setup leaves it alone; a site owner corrects it.' : 'View Items, Add Items and Open, and not Edit Items or Delete Items'}`, state: !level ? 'To do' : bitsMatch(level) ? 'Done' : 'Differs' });
  for (const [key, title] of Object.entries(PMS_GROUPS)) {
    const group = groupNamed(state, title);
    const wanted = ownerOf(key, state);
    steps.push({ id: `owner:${key}`, words: `"${wanted}" owns "${title}", and only the owner may change its members`, state: group?.OwnerTitle === wanted && !group?.AllowMembersEditMembership ? 'Done' : 'To do' });
  }
  for (const key of Object.keys(GROUP_MATRIX)) {
    const target = state.targets[key];
    const title = titleOfKey(titles, key);
    const grants = Object.entries(GROUP_MATRIX[key]).map(([group, cell]) => `${PMS_GROUPS[group]} ${CELL_WORDS[cell]}`).join(', ');
    if (target.missing) steps.push({ id: `list:${key}`, words: `${title} was not found: make the lists first.`, state: 'Differs' });
    else if (target.root) steps.push({ id: `list:${key}`, words: `${title} is the root of a library. Setup changes no whole library: put the pages in a folder of their own.`, state: 'Differs' });
    else if (!target.unique) steps.push({ id: `list:${key}`, words: `${title}: ${grants}`, state: 'To do' });
    else if (holdsMatrix(target, key)) steps.push({ id: `list:${key}`, words: `${title}: ${grants}`, state: 'Done' });
    else if (mayAddTo(target, key)) steps.push({ id: `list:${key}`, words: `${title} adds to its own permissions, removing nothing: ${grants}`, state: 'To do', adds: true });
    else steps.push({ id: `list:${key}`, words: `${title} already has permissions of its own in which a PMS group holds another level. Setup leaves them alone: a site owner corrects that group's level by hand.`, state: 'Differs' });
  }
  const saved = groupsOfRow(state.row);
  const same = saved && Object.entries(MANAGED_GROUPS).every(([key, title]) => saved[key].id === groupNamed(state, title)?.Id);
  steps.push({ id: 'row', words: "The groups' ids, kept in the settings list for the admin page", state: same ? 'Done' : 'To do' });
  return { steps, state, titles, keepsFullControl: state.keepsFullControl };
}

/** Stops Apply with the words given. */
class Mismatch extends Error {}
// (PCOE, 3 Nov 2026: a list or folder DELETE without IF-MATCH is refused, "The request ETag value '' does not match".)
const asDelete = { 'X-HTTP-Method': 'DELETE', 'IF-MATCH': '*' };
const stopWords = (doing, cause) => (cause instanceof Mismatch ? cause.message
  : cause.status === 403 ? `Stopped: your account cannot do this: ${doing}. A site owner must press Apply. (${saidOf(cause)})` : `Stopped at: ${doing}. SharePoint said: ${saidOf(cause)}`);

/** The rehearsal: everything Apply does to a list, on a scratch list and a scratch folder, removed again whatever happens. Throws at the first difference. */
async function rehearse(api, state, { folder, withFolder, step }) {
  const read = state.levels.find((level) => level.RoleTypeKind === KIND.read);
  if (!read) throw new Mismatch('Stopped in the rehearsal: the site has no Read permission level.');
  const scratch = address(SCRATCH_LIST);
  const check = async (what, test) => { if (!test(await api.read(`${scratch}${BINDINGS}`))) throw new Mismatch(`Stopped in the rehearsal, before any real list was touched: ${what}.`); };
  const held = (data) => results(data).some((raw) => (raw.PrincipalId ?? raw.Member?.Id) === state.owners.Id && levelsOf(raw).some((level) => level.Id === read.Id));
  let made = false;
  let madeFolder = false;
  let failure = null;
  // (A rehearsal that stopped before it cleaned up left its scratch list and folder: they are only ever the rehearsal's, so they go first. A delete of one
  // that is not there is refused, and that refusal is not a failure.)
  step('clear what an earlier rehearsal left');
  if (withFolder) await api.write('POST', folderAddress(`${folder}/${SCRATCH_FOLDER}`), undefined, asDelete).catch(() => {});
  await api.write('POST', scratch, undefined, asDelete).catch(() => {});
  try {
    step('create the scratch list');
    await api.write('POST', '/web/lists', { __metadata: { type: 'SP.List' }, BaseTemplate: 100, Title: SCRATCH_LIST, Description: "Setup's rehearsal. It removes this list itself; safe to delete." });
    made = true;
    step('stop its inheritance');
    await api.write('POST', `${scratch}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=false)`);
    step('grant on it');
    await api.write('POST', `${scratch}/roleassignments/addroleassignment(principalid=${state.owners.Id},roledefid=${read.Id})`);
    await check('a grant did not land', held);
    step('remove the grant');
    await api.write('POST', `${scratch}/roleassignments/removeroleassignment(principalid=${state.owners.Id},roledefid=${read.Id})`);
    await check('a removal did not land', (data) => !held(data));
    step('reset it');
    await api.write('POST', `${scratch}/resetroleinheritance`);
    if ((await api.read(`${scratch}?$select=HasUniqueRoleAssignments`))?.HasUniqueRoleAssignments) throw new Mismatch('Stopped in the rehearsal, before any real list was touched: a reset did not land.');
    if (withFolder) {
      const inner = `${folder}/${SCRATCH_FOLDER}`;
      step('the same on a scratch folder');
      await api.write('POST', '/web/folders', { __metadata: { type: 'SP.Folder' }, ServerRelativeUrl: inner });
      madeFolder = true;
      await api.write('POST', `${folderAddress(inner)}/ListItemAllFields/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=false)`);
      await api.write('POST', `${folderAddress(inner)}/ListItemAllFields/resetroleinheritance`);
    }
  } catch (cause) {
    failure = cause;
  }
  // (Cleaning up never hides the first failure; a failure here is its own stop.)
  try {
    if (madeFolder) await api.write('POST', folderAddress(`${folder}/${SCRATCH_FOLDER}`), undefined, asDelete);
    if (made) await api.write('POST', scratch, undefined, asDelete);
  } catch (cause) { failure ??= cause; }
  if (failure) throw failure instanceof Mismatch ? failure : new Mismatch(`Stopped in the rehearsal, before any real list was touched. SharePoint said: ${saidOf(failure)}`);
}

/**
 * Apply: carries out a plan's To do steps, and only adds. Never throws; { ok, words, undo } says what stopped it and how to take back each list it changed.
 * @param {{ read: Function, write: Function }} api siteApi(dataService)
 * @param {ReturnType<typeof permissionPlan>} plan
 * @param {{ titles: Record<string, string>, folder: string, onProgress?: (line: string) => void }} options
 */
export async function applyPermissions(api, plan, { titles, folder, onProgress = () => {} }) {
  const undo = [];
  if (!plan.keepsFullControl) return { ok: false, undo, words: 'Stopped before anything changed: your account is not a site owner, so it would not keep Full Control of these lists. A site owner must press Apply.' };
  const due = (id) => plan.steps.find((step) => step.id === id)?.state === 'To do';
  const differs = plan.steps.filter((step) => step.state === 'Differs');
  const left = differs.length ? ` Left alone: ${differs.length} (${differs.map((step) => step.words.split(':')[0]).join('; ')}).` : '';
  if (!plan.steps.some((step) => step.state === 'To do')) return { ok: true, undo, words: `Nothing to do.${left}` };
  let doing = 'the rehearsal';
  const say = (line) => { doing = line; onProgress(line); };
  const state = { ...plan.state, groups: [...plan.state.groups], levels: [...plan.state.levels] };
  try {
    await rehearse(api, state, { folder, withFolder: due('list:pages'), step: (line) => say(`Rehearsal: ${line}`) });

    for (const [key, title] of Object.entries(PMS_GROUPS)) {
      if (!due(`group:${key}`)) continue;
      say(`Make the group "${title}"`);
      const made = await api.write('POST', '/web/sitegroups', { __metadata: { type: 'SP.Group' }, Title: title, AllowMembersEditMembership: false });
      state.groups.push({ Id: made?.Id, Title: title, OwnerTitle: made?.OwnerTitle, AllowMembersEditMembership: false });
      // (SharePoint makes the group's maker a member of it, as seen on PCOE: the site owner who pressed Apply is taken out again.)
      const members = results(await api.read(`/web/sitegroups/getbyid(${made?.Id})/users?$select=Id&$top=5000`));
      if (members.some((user) => user.Id === state.me)) await api.write('POST', `/web/sitegroups/getbyid(${made?.Id})/users/removebyid(${state.me})`);
    }
    if (due('level')) {
      say(`Make the permission level "${ADD_ONLY_LEVEL}"`);
      await api.write('POST', '/web/roledefinitions', { __metadata: { type: 'SP.RoleDefinition' }, Name: ADD_ONLY_LEVEL, Description: 'View Items, Add Items and Open.', BasePermissions: { __metadata: { type: 'SP.BasePermissions' }, ...ADD_ONLY_BITS } });
    }
    // (The read-back decides, not the sum of the bits.)
    state.levels = results(await api.read('/web/roledefinitions?$select=Id,Name,RoleTypeKind,BasePermissions'));
    if (due('level') && !bitsMatch(levelNamed(state, ADD_ONLY_LEVEL))) throw new Mismatch(`Stopped: SharePoint made "${ADD_ONLY_LEVEL}" with other rights than were asked. A site owner corrects the level, then presses Apply again.`);

    for (const [key, title] of Object.entries(PMS_GROUPS)) {
      if (!due(`owner:${key}`)) continue;
      const group = groupNamed(state, title);
      const wanted = ownerOf(key, state);
      const ownerId = wanted === state.owners.Title ? state.owners.Id : groupNamed(state, wanted)?.Id;
      say(`Set "${wanted}" as the owner of "${title}"`);
      if (group.AllowMembersEditMembership) await api.write('MERGE', `/web/sitegroups/getbyid(${group.Id})`, { __metadata: { type: 'SP.Group' }, AllowMembersEditMembership: false });
      await api.write('POST', `/web/sitegroups/getbyid(${group.Id})/SetUserAsOwner(${ownerId})`);
      const landed = await api.read(`/web/sitegroups/getbyid(${group.Id})?$select=OwnerTitle`);
      if (landed?.OwnerTitle !== wanted) throw new Mismatch(`Stopped: "${title}" still has another owner. Set "${wanted}" as its owner on the group's settings page, then press Apply again.`);
    }

    const levelId = (cell) => (cell === 'add-only' ? levelNamed(state, ADD_ONLY_LEVEL) : state.levels.find((level) => level.RoleTypeKind === KIND[cell]))?.Id;
    for (const key of Object.keys(GROUP_MATRIX)) {
      if (!due(`list:${key}`)) continue;
      const where = targetAddress(key, titles, folder);
      const title = titleOfKey(titles, key);
      const adds = plan.steps.find((step) => step.id === `list:${key}`)?.adds === true;
      if (adds) {
        // (Its own permissions stay as they are: only the grants the PMS groups lack are added, and the undo takes back those alone.)
        say(`${title}: add to its own permissions`);
        const held = await readTarget(api.read, key, titles, folder);
        for (const [group, cell] of Object.entries(GROUP_MATRIX[key])) {
          if (heldBy(held, group).length) continue;
          const grant = `principalid=${groupNamed(state, PMS_GROUPS[group]).Id},roledefid=${levelId(cell)}`;
          await api.write('POST', `${where}/roleassignments/addroleassignment(${grant})`);
          undo.push(`${title}: POST ${where}/roleassignments/removeroleassignment(${grant})`);
        }
      } else {
        say(`${title}: stop inheriting (with a copy) and grant`);
        await api.write('POST', `${where}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=false)`);
        undo.push(`${title}: POST ${where}/resetroleinheritance`);
        for (const [group, cell] of Object.entries(GROUP_MATRIX[key])) {
          await api.write('POST', `${where}/roleassignments/addroleassignment(principalid=${groupNamed(state, PMS_GROUPS[group]).Id},roledefid=${levelId(cell)})`);
        }
      }
      // (A PMS group that the copy brought with another level gives that level up, after its own grant.)
      let target = await readTarget(api.read, key, titles, folder);
      for (const [group, cell] of Object.entries(GROUP_MATRIX[key])) {
        const held = target.bindings.find((binding) => binding.title === PMS_GROUPS[group]);
        for (const level of held?.levels ?? []) {
          if (level.Id !== levelId(cell)) await api.write('POST', `${where}/roleassignments/removeroleassignment(principalid=${held.principalId},roledefid=${level.Id})`);
        }
      }
      target = await readTarget(api.read, key, titles, folder);
      if (!holdsMatrix(target, key)) throw new Mismatch(`Stopped: ${title} does not read back as planned. To take it back, ${undo.at(-1)}, then press Apply again.`);
      if (!holdsFull(target, state.owners.Id)) throw new Mismatch(`Stopped: the site's owners do not hold Full Control of ${title}. To take it back, ${undo.at(-1)}.`);
    }

    if (due('row')) {
      say("Keep the groups' ids in the settings list");
      const ids = Object.fromEntries(Object.entries(MANAGED_GROUPS).map(([key, title]) => [key, groupNamed(state, title).Id]));
      const list = address(titles.appsettings);
      if (plan.state.row) await api.write('MERGE', `${list}/items(${plan.state.row.Id})`, { Title: groupsRowTitle(ids, groupsOfRow(plan.state.row)?.sync ?? false) });
      else await api.write('POST', `${list}/items`, { Title: groupsRowTitle(ids), AppId: SITE_GROUPS_ITEM });
    }
  } catch (cause) {
    return { ok: false, undo, words: stopWords(doing, cause) };
  }
  return { ok: true, undo, words: `Done. Nobody lost anything: the site's own groups keep what they had on these lists until a site owner presses Remove the site's groups.${left}` };
}

/**
 * What Remove the site's groups would take away: for each list and folder already as planned, every principal other than the PMS groups and the site's
 * owners. A principal holding only Limited Access is not a holder.
 */
export function removalPlan(state, titles) {
  const ours = new Set(Object.values(PMS_GROUPS));
  const plan = [];
  for (const key of Object.keys(GROUP_MATRIX)) {
    const target = state.targets[key];
    if (!target?.unique || !holdsMatrix(target, key)) continue;
    const others = target.bindings.filter((binding) => binding.principalId !== state.owners.Id && !ours.has(binding.title) && binding.levels.length > 0);
    if (others.length) plan.push({ key, title: titleOfKey(titles, key), who: others.map((binding) => binding.title), principals: others.map((binding) => binding.principalId) });
  }
  return plan;
}

/**
 * The second button: removes what removalPlan names. Refuses, before anything is sent, when the account is not a site owner or the owners do not hold
 * Full Control of a list it would change. Never throws.
 * @param {{ read: Function, write: Function }} api
 * @param {any} state
 * @param {Record<string, string>} titles
 * @param {{ onProgress?: (line: string) => void }} [options]
 */
export async function removeSiteGroups(api, state, titles, { onProgress = () => {} } = {}) {
  if (!state.keepsFullControl) return { ok: false, words: 'Stopped before anything changed: your account is not a site owner. A site owner must press this.' };
  const plan = removalPlan(state, titles);
  const bare = plan.find(({ key }) => !holdsFull(state.targets[key], state.owners.Id));
  if (bare) return { ok: false, words: `Stopped before anything changed: the site's owners do not hold Full Control of ${bare.title}. Give it back to them first.` };
  let doing = '';
  try {
    for (const { key, title, who, principals } of plan) {
      doing = `${title}: remove ${who.join(', ')}`;
      onProgress(doing);
      const where = targetAddress(key, titles, state.folder);
      for (const id of principals) await api.write('POST', `${where}/roleassignments/getbyprincipalid(${id})`, undefined, asDelete);
    }
  } catch (cause) {
    return { ok: false, words: stopWords(doing, cause).replace('press Apply', 'press this') };
  }
  return { ok: true, words: plan.length ? `Done: removed from ${plan.length} ${plan.length === 1 ? 'list' : 'lists'}.` : 'Nothing to remove.' };
}

/**
 * Setup's switch (Prompt 27, Part 4): whether a Super admin's actions on the admin page change who is in the three managed groups. Off until a site
 * owner turns it on; kept in the groups' row. Never throws: { ok, words }.
 * @param {{ read: Function, write: Function }} api @param {Record<string, string>} titles @param {boolean} on
 */
export async function setSiteGroupsSync(api, titles, on) {
  try {
    const row = results(await api.read(siteGroupsAddress(titles)))[0];
    const groups = groupsOfRow(row);
    if (!groups) return { ok: false, words: 'Press Apply first: the groups are not made yet.' };
    const ids = Object.fromEntries(Object.keys(MANAGED_GROUPS).map((key) => [key, groups[key].id]));
    await api.write('MERGE', `${address(titles.appsettings)}/items(${row.Id})`, { Title: groupsRowTitle(ids, on) });
    return { ok: true, words: on ? 'Super admins now change who is in the PMS groups from the admin page.' : 'The admin page no longer changes who is in the PMS groups.' };
  } catch (cause) {
    return { ok: false, words: `Could not change the switch: ${saidOf(cause)}` };
  }
}
