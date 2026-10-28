// Section 13 (Prompt 21, Phase 2): the people screens' calls. A search of the firm's directory (the people picker web service of SharePoint), a change
// to a PMSUsers or PMSRoleAssignments row, and the removal of an assignment. Before it changes or removes a row it reads both lists and hands them to
// the page's write guard (`guard.record`, lib/access/guard.js), which holds the rules that need the rows: never the last Super admin, never your own
// roles, an Admin never touches a Super admin or Admin row. So the rules are also here, in the data layer, and a refusal sends nothing. The rules are
// lib/access's; this part holds the requests and keeps nothing. Built on the generic calls of core.js.

import { currentAccessGuard, deleteItem, listItems, sharePoint, spHttp, updateItem } from './core.js';

const PEOPLE_LISTS = Object.freeze(['users', 'roleassignments']);
const peopleList = (key) => {
  if (!PEOPLE_LISTS.includes(key)) throw new Error(`Not an access list a row can be changed in: ${key}.`);
  return key;
};
const PICKER = '/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser';

/**
 * Searches the firm's directory for people whose name or email holds `text`: at most `max` of { key (the email in lower case), name, email,
 * loginName, jobTitle }. ASSUMED until QA-TESTING.md's item is answered: the real PCOE site allows the call; a refusal throws with its status (the
 * screen then asks for a full email and says "unverified"). It changes nothing, and so passes the write guard. The sign-in ladder does not run for it:
 * a refused search is not a lost sign-in. On the local server there is no directory: null. `signal` aborts the request (a newer search overtook it).
 * @param {string} text @param {{ signal?: AbortSignal, max?: number }} [options]
 * @returns {Promise<{ key: string, name: string, email: string, loginName: string, jobTitle: string }[] | null>}
 */
export async function searchDirectory(text, { signal, max = 8 } = {}) {
  if (!sharePoint) return null;
  const { data } = await spHttp('POST', PICKER, {
    signal, ladder: false, idempotent: true,
    body: { queryParams: {
      __metadata: { type: 'SP.UI.ApplicationPages.ClientPeoplePickerQueryParameters' },
      QueryString: text, MaximumEntitySuggestions: max, AllowEmailAddresses: false, AllowOnlyEmailAddresses: false, AllowMultipleEntities: false,
      PrincipalSource: 15, PrincipalType: 1, SharePointGroupID: 0,
    } },
  });
  // (verbose JSON puts the answer under d, a string of JSON: the web service's own shape)
  const raw = data?.ClientPeoplePickerSearchUser ?? data?.d?.ClientPeoplePickerSearchUser ?? data?.value ?? '[]';
  let found = [];
  try { found = JSON.parse(raw); } catch { /* an answer that is not a list: no one */ }
  return (Array.isArray(found) ? found : []).slice(0, max).map((entry) => ({
    key: String(entry.EntityData?.Email ?? '').trim().toLowerCase(), name: String(entry.DisplayText ?? '').trim(), email: String(entry.EntityData?.Email ?? '').trim().toLowerCase(),
    loginName: String(entry.Key ?? ''), jobTitle: String(entry.EntityData?.Title ?? '').trim(),
  })).filter((person) => person.email.includes('@'));
}

/** The guard's check of one change, with the rows it needs (both lists, in full pages): throws AccessDenied, or returns the row it concerns. */
async function checked(op, key, id, changes) {
  const [users, assignments] = await Promise.all([listItems('users'), listItems('roleassignments')]);
  const row = (key === 'users' ? users : assignments).find((entry) => entry.id === id) ?? null;
  currentAccessGuard()?.record?.({ key, op, id, row, changes, users, assignments });
  return row;
}

/** Changes a row of PMSUsers or PMSRoleAssignments (a status, an extra); refused, in words, by the guard's rules. A row that is not there is a 404. */
export async function updateAccessRecord(key, id, changes) {
  peopleList(key);
  await checked('update', key, id, changes);
  return updateItem(key, id, changes);
}

/** Removes one assignment. Resolves to true, or false when it was not there (removed already). A person is never removed: disable them. */
export async function removeAccessRecord(key, id) {
  if (peopleList(key) !== 'roleassignments') throw new Error('A person is turned off, never removed.');
  if (!(await checked('delete', key, id))) return false;
  await deleteItem(key, id);
  return true;
}
