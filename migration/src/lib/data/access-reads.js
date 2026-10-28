// Section 12 (Prompt 21, Phase 1): roles and access, as the data layer reads and writes them. Who is signed in (and whether they own the site), their
// PMSUsers row and their PMSRoleAssignments rows in two indexed reads sent together, however many people the site has; the three access lists
// read whole (Setup's list of Super admins, and its copy of the old admins list), and a new row added to one of them. The rules (the role matrix,
// can(), the write guard, the grants and the audit) are lib/access's, which only the admin page and Setup import: every page carries this part, so
// it holds the requests and nothing else. Built on the generic calls of core.js; keeps nothing.

import { createItem, getItem, listItems, queryItems, sharePoint, spByAppId, spDecode, spHttp, spItems, spReadTogether } from './core.js';
import { spLiteral } from './encoding.js';

/** The lists of section 12. */
const ACCESS_LISTS = Object.freeze(['users', 'roleassignments', 'auditlog']);
const accessList = (key) => {
  if (!ACCESS_LISTS.includes(key)) throw new Error(`Not an access list: ${key}.`);
  return key;
};
const rowsOf = (payload) => payload?.results ?? [];

/**
 * Reads `resources` in one $batch where the site batches, and one by one where it does not (or for a part that did not come back). A read whose
 * index is in `optional` resolves to undefined when it fails; any other failure is thrown.
 */
async function together(resources, optional = []) {
  const parts = await spReadTogether(resources);
  return Promise.all(resources.map(async (resource, index) => {
    if (parts[index] !== undefined) return parts[index];
    try {
      return (await spHttp('GET', resource)).data;
    } catch (error) {
      if (optional.includes(index)) return undefined;
      throw error;
    }
  }));
}

/**
 * The signed-in account, and whether it owns the site: a site collection administrator, or a member of the site's owners group (ASSUMED: what
 * "site owner" means on PCOE; QA-TESTING.md). One request, the two reads in a $batch. On the local server nobody is signed in: null.
 * @returns {Promise<{ Id: number, Title: string, Email: string, LoginName: string, owner: boolean } | null>}
 */
export async function readSignedInPerson() {
  if (!sharePoint) return null;
  const [me, owners] = await together(['/web/currentuser?$select=Id,Title,Email,LoginName,IsSiteAdmin,Groups/Id&$expand=Groups', '/web/AssociatedOwnerGroup?$select=Id'], [1]);
  const groups = rowsOf(me?.Groups).map((group) => group.Id);
  const inOwners = owners?.Id !== undefined && groups.includes(owners.Id);
  return { Id: me.Id, Title: String(me.Title ?? '').trim(), Email: me.Email ?? '', LoginName: me.LoginName ?? '', owner: me.IsSiteAdmin === true || inOwners };
}

/**
 * A person's PMSUsers row (or null) and PMSRoleAssignments rows, by their key: two indexed reads (AppId, UserKey), in one $batch where the site
 * batches. A person has a handful of assignments: one page of 500 holds them.
 * @param {string} userKey
 */
export async function readAccessRows(userKey) {
  if (!sharePoint) {
    const [user, assignments] = await Promise.all([getItem('users', userKey), queryItems('roleassignments', { userKey })]);
    return { user, assignments };
  }
  const [users, roles] = await together([spByAppId('users', userKey), spItems('roleassignments', `$filter=UserKey eq ${spLiteral(userKey)}&$top=500`)]);
  return {
    user: rowsOf(users).map((row) => spDecode('users', row).item)[0] ?? null,
    assignments: rowsOf(roles).map((row) => spDecode('roleassignments', row).item),
  };
}

/** Every row of one access list (`users`, `roleassignments` or `auditlog`), page by page: Setup's, which reads them whole. */
export const listAccessRecords = (key) => listItems(accessList(key));

/** Adds a row to one access list. A row whose AppId is there already is refused with status 409 (a grant given twice). */
export const addAccessRecord = (key, fields) => createItem(accessList(key), fields);
