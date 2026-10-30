// The access lists' own permissions (Prompt 21, Phase 7): what moves the access check from a guardrail in the page towards a boundary on the site.
// The page's check (lib/access/can.js) holds only what the page sends; a person who knows SharePoint's addresses could write to a list the site lets
// them write. So the two lists that say who may do what (PMSUsers, PMSRoleAssignments) are written only by a small SharePoint group and the site's
// owners, and the audit list (PMSAuditLog) takes new lines from everyone and lets no one but the owners change or delete one (a custom permission level).
//
// ASSUMED until tried on the PCOE site (QA-TESTING.md): the group's and the level's names, that the owners' group's name ends in "Owners" (SharePoint's
// default), and that the site lets its owners break a list's inheritance. Setup does NOT change permissions itself: its plan says what a site owner sets
// by hand (permissionSteps), and its self-test reads what is set and says what differs (permissionProbe, read only, two requests a list). Producers and
// designers keep write access to the content lists (they edit them), so the separation between clients there is the app's alone; a server component
// would be needed for more (docs/SHAREPOINT.md). Plain JS with no DOM; only the Setup page imports it.

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

const results = (data) => data?.results ?? data?.value ?? [];
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
