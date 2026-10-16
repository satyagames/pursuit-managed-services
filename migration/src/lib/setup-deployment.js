// What Setup says about this copy of the app (Phase 10b). Plain JS with JSDoc and no DOM, and ONLY the Setup page imports it (the
// participant and admin pages have a size to keep to: scripts/test-bundle-budget.js fails if it is in either).
//
// Three things, none of which changes anything on the site:
//   copyRows()            the rows of "This copy of the app": what the page is really using and where each value came from. They are
//                         made from the answer of lib/deploy-settings.js itself, so they cannot disagree with what the page does.
//   waysToFix()           for a page that could not be set up: the two ways to name this copy's lists.
//   readListAddresses()   asks SharePoint, for each list by its title, what its address and its id are; sameListByAddress() then
//                         asks for one of them by that address (web/GetList) and says whether it is the same list. A title can be
//                         changed by anyone who may manage lists and an address cannot, so the address may one day be what the
//                         app asks by (ARCHITECTURE-10.md 3.4, in git history at 7347c72): this is how it is first seen on a real site. Reads only.

const FILE = 'pms-config.txt';
/** Where a value came from, in the words the panel prints beside it. */
const FROM = { file: `from ${FILE}`, 'built in': 'built in', derived: "from this page's address", default: 'default' };
const LIBRARY = 'logoLibrary';

/** The folder a page is in, as a person reads it: the address without the page's own name, a space as a space. */
export function folderOf(pageUrl) {
  const page = new URL(pageUrl);
  const folder = `${page.origin}${page.pathname.replace(/[^/]*$/, '')}`;
  try { return decodeURI(folder); } catch { return folder; }
}

/**
 * The rows of "This copy of the app".
 * @param {{ sources?: Record<string, string>, known?: Record<string, any>, problems?: { id: string }[] }} deployment what lib/start.ts found
 * @param {{ pageUrl: string, local: boolean, titles: Record<string, string> | null, build: string }} context
 *   `titles` is dataService.sharePointListTitles(deployment.known): the title of every list and of the picture library under the
 *   values that were worked out; null on the local server. `build` names the build these pages came from.
 * @returns {{ label: string, value: string, source: string }[]}
 */
export function copyRows({ sources = {}, known = {} }, { pageUrl, local, titles, build }) {
  const rows = [{ label: 'Opened from', value: folderOf(pageUrl), source: '' }];
  if (local) {
    rows.push({ label: 'Site', value: 'None: this is the local server', source: 'plain http, or this computer' });
    rows.push({ label: 'Lists', value: "The local server's own files", source: 'no settings file is read here' });
  } else {
    const listKeys = Object.keys(titles ?? {}).filter((key) => key !== LIBRARY);
    const named = Object.keys(known.lists ?? {});
    const prefixed = known.listPrefix !== undefined;
    const prefixSource = !prefixed ? '' : `${known.listPrefix === '' ? 'no prefix' : `prefix "${known.listPrefix}"`} ${FROM[sources.listPrefix]}`;
    const namedSource = named.length ? `${named.length} named on ${named.length === 1 ? 'its' : 'their'} own ${FROM[sources.lists]}: ${named.map((key) => `${key} is ${known.lists[key]}`).join(', ')}` : '';
    rows.push({ label: 'Site', value: known.siteUrl ?? 'Not known', source: FROM[sources.siteUrl] ?? '' });
    rows.push(prefixed
      ? { label: 'Lists', value: `${listKeys.slice(0, 2).map((key) => titles[key]).join(', ')}, ... (${listKeys.length})`, source: [prefixSource, namedSource].filter(Boolean).join('; ') }
      : { label: 'Lists', value: 'Not named yet', source: 'nothing gives a list prefix' });
    rows.push(prefixed || known[LIBRARY] !== undefined
      ? { label: 'Picture library', value: titles[LIBRARY], source: sources[LIBRARY] === 'default' ? (known.listPrefix === '' ? 'default' : 'default for this prefix') : FROM[sources[LIBRARY]] }
      : { label: 'Picture library', value: 'Not named yet', source: 'it follows the list prefix' });
    rows.push({ label: 'Grouped reads', value: known.batch === false ? 'off' : 'on', source: FROM[sources.batch] ?? 'default' });
    const support = [known.support?.name, known.support?.contact].filter(Boolean).join(', ');
    rows.push({ label: 'Support', value: support || 'Not set', source: support ? FROM[sources.support] : '' });
    rows.push({ label: 'Label', value: known.label ?? 'Not set', source: known.label ? FROM[sources.label] : '' });
  }
  rows.push({ label: 'Build', value: build, source: 'built in' });
  return rows;
}

/**
 * For a page that could not be set up: the two ways to say which lists are this copy's, as two short paragraphs.
 * @param {string} prefix an example prefix to show (the one already known, when there is one)
 */
export const waysToFix = (prefix = 'PMS3') => [
  `Put a file called ${FILE} in the same folder as these three pages. The smallest one that works is { "configVersion": 1, "listPrefix": "${prefix}" }: every list this copy uses then has ${prefix} in front of its name (${prefix}Clients, ${prefix}Sessions and so on). To use the lists that have nothing in front of their names, say so on purpose with "listPrefix": "". Then reload this page.`,
  `Or build the pages with the prefix inside them (PMS_LIST_PREFIX=${prefix} npm run build:svelte:release) and upload them again. A settings file, when there is one, still wins over what is built in.`,
];

// ---- Where the lists are (read-only) ------------------------------------------------------------------------------------------------

const quoted = (text) => `'${encodeURIComponent(String(text).replace(/'/g, "''"))}'`;
const byTitle = (title) => `/web/lists/getbytitle(${quoted(title)})?$select=Id,Title,RootFolder/ServerRelativeUrl&$expand=RootFolder`;
const byAddress = (address) => `/web/GetList(${quoted(address)})?$select=Id,Title`;
const refusal = (read) => `${read.status ?? 'no answer'}${read.message ? `: ${read.message}` : ''}`;
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** One row for each list and one for the picture library, before anything has been asked of the site. */
export const listRows = (titles) => Object.entries(titles).map(([key, title]) => ({ key, title, library: key === LIBRARY, asked: false, found: false, address: '', id: '', note: '' }));

/**
 * @typedef {(resource: string) => Promise<{ ok: true, data: any } | { ok: false, status?: number, message: string }>} Read
 *   one GET of the site's REST API, never throwing: dataService.probeSharePointRead(null, resource)
 */

/**
 * Asks SharePoint, for each title, which list that is: its address and its id. A list that is not there says so. For a list (not
 * the library) the note says whether its address is the one its title suggests: a list that was created under another name and
 * renamed since keeps its first address.
 * @param {Read} read
 * @param {Record<string, string>} titles by key, with `logoLibrary`
 * @param {string} siteUrl
 * @param {(row: any) => void} [onRow] called as each answer arrives
 */
export async function readListAddresses(read, titles, siteUrl, onRow = () => {}) {
  const sitePath = new URL(siteUrl).pathname.replace(/\/+$/, '');
  const rows = [];
  for (const row of listRows(titles)) {
    const answer = await read(byTitle(row.title));
    const address = answer.ok ? String(answer.data?.RootFolder?.ServerRelativeUrl ?? '') : '';
    const found = answer.ok && Boolean(answer.data?.Id);
    const usual = `${sitePath}/${row.library ? '' : 'Lists/'}${row.title}`;
    const next = {
      ...row, asked: true, found, address, id: found ? String(answer.data.Id) : '',
      note: !answer.ok ? (answer.status === 404 ? 'There is no list with this title.' : `Could not be read (${refusal(answer)}).`)
        : !found ? 'SharePoint answered without an id.'
          : !address ? 'SharePoint did not say where it is.'
            : same(decoded(address), usual) ? 'At the address its title suggests.'
              : `At another address than its title suggests (${usual}): it was made under another name.`,
    };
    rows.push(next);
    onRow(next);
  }
  return rows;
}

function decoded(address) {
  try { return decodeURIComponent(address); } catch { return address; }
}

/**
 * The probe: asks for one list by its address (web/GetList) and says whether SharePoint hands back the list its title gave.
 * @param {Read} read
 * @param {{ title: string, address: string, id: string }[]} rows what readListAddresses() found
 * @returns {Promise<{ asked: boolean, same: boolean, words: string }>}
 */
export async function sameListByAddress(read, rows) {
  const row = rows.find((each) => each.found && each.address && !each.library);
  if (!row) return { asked: false, same: false, words: 'Not asked: no list was found by its title, so there is no address to ask by.' };
  const answer = await read(byAddress(row.address));
  if (!answer.ok) return { asked: true, same: false, words: `Asked for ${row.title} by its address (${row.address}): SharePoint did not answer it that way (${refusal(answer)}). The app asks by title, so nothing is wrong today.` };
  const alike = same(answer.data?.Id, row.id);
  return {
    asked: true, same: alike,
    words: alike
      ? `Asked for ${row.title} by its title and by its address (${row.address}): the same list both ways (id ${row.id}).`
      : `Asked for ${row.title} by its title and by its address (${row.address}): NOT the same list (by title ${row.id}, by address ${answer.data?.Id ?? 'no id'}). Tell the developer before anything is changed.`,
  };
}
