// What the Setup page adds to its list check and its self-test: what it expects of every column, in full (Phase 10c-2b), two
// read-only probes of the tenant (Phase 9b, G), a third (Phase 10h: which columns it leaves out of a read that names none) and a fourth (Phase 10i:
// which columns it will not return by name). Plain JS with JSDoc and no DOM, and ONLY the Setup page imports it: what it expects comes
// from migration/src/lib/schema/pms-schema-meta.js, which the participant and admin pages must not carry (`npm run test:bundle` holds that).
// dataService.js keeps two small primitives: checkSharePointSchema({ specs }) checks what it is handed, and probeSharePointRead() asks
// one question and says what came back. Nothing here writes, and nothing here ever changes a row's Ready.
//
// (Until Phase 10c-2b Setup also listed, under "Please check by eye", the type of every original column and the indexes PROVISIONING.md
// asked for, as warnings, and two notes about a column called Order. Since schema v2 every column's type is checked strictly here, the
// order is `SortOrder`, and the lists are made by Setup, not by hand: there is nothing left to check by eye.)
import { ID, LISTS, selectOf } from '../schema/pms-schema.js';
import { columnsOf, retiredColumn } from '../schema/pms-schema-meta.js';

// ---- What the check expects of each column ---------------------------------------------------------------------------------------------

const TYPE_NAMES = { Text: 'Single line of text', Note: 'Multiple lines of text, plain text', Number: 'Number', DateTime: 'Date and Time', Boolean: 'Yes/No' };
/** How to create a column, in the words SharePoint's own "Add column" dialog uses (Setup's plan, lib/setup/provision.js, says it the same way). */
export const typeLabel = ({ type, format, indexed, unique, required }) =>
  `${TYPE_NAMES[type] ?? type}${format ? `, shown as ${format}` : ''}${indexed ? ', indexed' : ''}${unique ? ', enforce unique values' : ''}${required ? ', required' : ''}`;

/**
 * What Setup's check expects of each column of the list `key`, from pms-schema-meta.js alone, for dataService.checkSharePointSchema({ specs }):
 * every column there, of exactly its type (a number may come back as Integer), a date shown as Date & Time, indexed where the schema says,
 * AppId unique and required and no other column required.
 * @param {string} key
 */
export function schemaSpecs(key) {
  return columnsOf(key).map((column) => ({
    column: column.name, accepts: column.type === 'Number' ? ['Number', 'Integer'] : [column.type], type: typeLabel(column),
    indexed: column.indexed, unique: column.unique, required: column.required, dateAndTime: column.format === 'Date & Time',
  }));
}

// ---- What this tenant does with a Yes/No filter and with a long $filter (the self-test's two probes, G) ------------------------------------------------
// Until Phase 10c-2a everything that looked for codes nobody scanned filtered QRTokens on `Used eq 'false'`, which only the mocked REST (it compares
// strings) had ever answered. No request filters on a Yes/No column now: a session's codes are read by SessionId and `used` is tested in the browser.
// The probe of the three spellings stays because it is informative: whoever defines the lists next can see how this tenant compares a Yes/No column.
// Nothing depends on what it finds, and it says so. And a few reads put many ids in one address. Neither has been seen on the real tenant. These read,
// on a small read each, and print what came back. Read-only, and never a failure.

export const PROBE_YESNO = 'Probe (read-only): a Yes/No filter on the guest QR codes\' Used column, written three ways';
export const PROBE_LENGTH = 'Probe (read-only): how long a $filter this site accepts';
export const PROBE_LENGTHS = Object.freeze([1_000, 1_500, 2_000, 2_500, 3_000, 4_000]);
const formatted = (number) => number.toLocaleString('en-US');
const refused = (read) => `refused (${read.status ?? 'no answer'}: ${read.message})`;

/** @typedef {(list: string | null, query: string) => Promise<{ ok: true, rows: number, length: number, data?: any } | { ok: false, status?: number, message: string }>} Probe dataService.probeSharePointRead */

/** @param {Probe} probe */
async function yesNoFilter(probe) {
  const reads = [];
  for (const text of ["'false'", '0', 'false']) {
    reads.push({ text, read: await probe('qrtokens', `$select=Id&$top=100&$filter=${encodeURIComponent(`Used eq ${text}`)}`) });
  }
  const said = reads.map(({ text, read }) => `Used eq ${text}: ${read.ok ? `accepted, ${read.rows} row${read.rows === 1 ? '' : 's'}` : refused(read)}.`);
  const counts = new Set(reads.filter(({ read }) => read.ok).map(({ read }) => /** @type {{ rows: number }} */ (read).rows));
  return `${said.join(' ')}${counts.size > 1 ? ' The accepted spellings returned different numbers of rows: the filter is not read the way it is written.' : ''} The app does not filter on a Yes/No column (it reads a session's codes and tests them itself), so nothing depends on these answers.`;
}

/** @param {Probe} probe */
async function filterLength(probe) {
  let accepted = 0;
  let widest = 0;
  let refusal = null;
  for (const target of PROBE_LENGTHS) {
    // Harmless terms on the one-item AppSettings list: `Id eq 1 or Id eq 2 ...`, until the filter, as sent, is the length asked for.
    let plain = '';
    let filter = '';
    for (let id = 1; filter.length < target; id += 1) {
      plain = `${plain ? `${plain} or ` : ''}Id eq ${id}`;
      filter = encodeURIComponent(plain);
    }
    const read = await probe('appsettings', `$select=Id&$top=1&$filter=${filter}`);
    if (!read.ok) { refusal = { length: filter.length, read }; break; }
    accepted = filter.length;
    widest = read.length;
  }
  if (!refusal) return `This site accepted a $filter of up to ${formatted(accepted)} characters (the six lengths ${formatted(PROBE_LENGTHS[0])} to ${formatted(PROBE_LENGTHS.at(-1) ?? 0)} were all accepted); the longest address it answered was ${formatted(widest)} characters.`;
  return `This site accepted a $filter of up to ${accepted ? `${formatted(accepted)} characters` : `no length it was asked (the shortest was ${formatted(PROBE_LENGTHS[0])})`}; it refused one of ${formatted(refusal.length)} (${refusal.read.status ?? 'no answer'}: ${refusal.read.message}). The app's longest read is under 1,900 characters (Phase 10h: every read names its columns).`;
}

// ---- What this site leaves out of an item read that names no columns (Phase 10h) -----------------------------------------------------------------------
// The real site (PCOE, 14 Oct 2026) left ClientId out of every PMSActivities item read that did not say which columns to return, and returned it to a
// read that did; why, and which other lists and columns it does it to, is not known. Every item read of the app names its columns now (pms-schema.js
// selectOf), so nothing depends on the answer; this asks the site, list by list, so that whoever reads the self-test can see what it leaves out. One item
// of each list, read twice: without $select (the one read of the app that names no columns, on purpose) and with it. Read-only, and never a failure.

export const PROBE_LEFT_OUT = 'Probe (read-only): columns this site leaves out of a read that names no columns';
const itemsOf = (title) => `/web/lists/getbytitle('${encodeURIComponent(String(title).replace(/'/g, "''"))}')/items`;
const firstRow = (read) => (read.data?.results ?? read.data?.value ?? [])[0];
const unreadable = (title, read) => `${title} (${read.status ?? 'no answer'}: ${read.message})`;

/** @param {Probe} probe @param {Record<string, string>} titles the title of each list on this site, by key (dataService.sharePointListTitles()) */
async function columnsLeftOut(probe, titles) {
  const leaves = [];
  const empty = [];
  const unread = [];
  let read = 0;
  for (const key of Object.keys(LISTS)) {
    const title = titles[key];
    const plain = await probe(null, `${itemsOf(title)}?$top=1`);
    if (!plain.ok) { unread.push(unreadable(title, plain)); continue; }
    const first = firstRow(plain);
    if (!first) { empty.push(title); continue; }
    const named = await probe(key, `$top=1&${selectOf(key)}`);
    if (!named.ok) { unread.push(unreadable(title, named)); continue; }
    read += 1;
    const second = firstRow(named) ?? {};
    const missing = Object.keys(second).filter((column) => !['__metadata', 'Id', 'ID'].includes(column) && !(column in first));
    if (missing.length || second.Id !== first.Id) leaves.push(`${title}: ${missing.length ? missing.join(', ') : 'nothing'}${second.Id === first.Id ? '' : ' (the two reads returned different items)'}`);
  }
  return `${leaves.length ? `Left out of a read that names no columns: ${leaves.join('; ')}.` : 'No list left a column out of a read that names no columns.'} Read one item of ${read} list${read === 1 ? '' : 's'}${empty.length ? `; empty, so not read again: ${empty.join(', ')}` : ''}${unread.length ? `; could not be read: ${unread.join('; ')}` : ''}. The app names its columns in every read (Phase 10h), so nothing depends on this answer.`;
}

// ---- Which columns this site will not return by name (Phase 10i) -----------------------------------------------------------------------------------------
// The real site (PCOE, 15 Oct 2026) refused every PMSVisitLog item read whose $select named DisplayName (400, "Value does not fall within the expected
// range."), and answered the same read of PMSGuestList, which had no item: SharePoint gives every list item a property called DisplayName, and a column of that
// name can be written and not read back. Version 3 has no such column (scripts/test-schema.js holds every column's name to that), so nothing of the app depends
// on the answer; this asks the site, list by list, whether it returns every column the list has. For each list with at least one item: its own columns (read
// from its fields: the app's, and any other, such as the DisplayName a list of version 2 keeps), one item read naming all of them, and, only when that is
// refused, one read for each column alone, to find which. A list with no item is not tested: the site answered such a read whatever it named. Read-only, and
// never a failure.

export const PROBE_REFUSED = 'Probe (read-only): columns this site will not return by name';
/** What the probe reads of a list's fields: enough to tell the list's own columns from SharePoint's. */
const OWN_FIELDS = '$select=InternalName,Hidden,ReadOnlyField,FromBaseType';
const fieldsOf = (title) => `/web/lists/getbytitle('${encodeURIComponent(String(title).replace(/'/g, "''"))}')/fields`;
const named = (columns) => `$top=1&$select=${['Id', ...columns].join(',')}`;

/** @param {Probe} probe @param {Record<string, string>} titles the title of each list on this site, by key (dataService.sharePointListTitles()) */
async function columnsRefused(probe, titles) {
  const refused = [];
  const together = [];
  const empty = [];
  const unread = [];
  let read = 0;
  for (const key of Object.keys(LISTS)) {
    const title = titles[key];
    const first = await probe(null, `${itemsOf(title)}?$select=Id&$top=1`);
    if (!first.ok) { unread.push(unreadable(title, first)); continue; }
    if (!firstRow(first)) { empty.push(title); continue; }
    const fields = await probe(null, `${fieldsOf(title)}?${OWN_FIELDS}`);
    if (!fields.ok) { unread.push(unreadable(title, fields)); continue; }
    const columns = [...new Set((fields.data?.results ?? fields.data?.value ?? []).filter((field) => !field.Hidden && !field.ReadOnlyField && !field.FromBaseType).map((field) => String(field.InternalName)))];
    read += 1;
    const all = await probe(null, `${itemsOf(title)}?${named(columns)}`);
    if (all.ok) continue;
    const alone = [];
    for (const column of columns) {
      const one = await probe(null, `${itemsOf(title)}?${named([column])}`);
      if (!one.ok) alone.push(column);
      if (!one.ok) refused.push({ key, title, column, read: one });
    }
    if (!alone.length) together.push(`${title} (${all.status ?? 'no answer'}: ${all.message})`);
  }
  const used = refused.filter(({ key, column }) => !retiredColumn(key, column) && Object.values(LISTS[key].fields).some((field) => field.column === column));
  const which = refused.map(({ key, title, column, read: one }) => {
    const old = retiredColumn(key, column);
    const note = old ? `no longer used since version ${old.lastIn + 1}; ` : used.some((each) => each.key === key && each.column === column) ? 'which the app reads; ' : '';
    return `${title}.${column} (${note}${one.status ?? 'no answer'}: ${one.message})`;
  });
  return `${which.length ? `Refused when named: ${which.join('; ')}.` : 'Every column of the lists it read came back when named.'}`
    + `${together.length ? ` Refused when every column was named together, but no column alone: ${together.join('; ')}.` : ''}`
    + ` Read one item of ${read} list${read === 1 ? '' : 's'}, naming every column${empty.length ? `; empty, so not tested: ${empty.join(', ')}` : ''}${unread.length ? `; could not be read: ${unread.join('; ')}` : ''}.`
    + (used.length ? ` The app reads ${used.map(({ title, column }) => `${title}.${column}`).join(', ')}: its reads of ${used.length === 1 ? 'that list' : 'those lists'} will fail on this site.`
      : ' No column of the app is among them (since version 3 no column is named like a property SharePoint gives every list item), so nothing depends on this answer.');
}

/**
 * The probes as self-test steps ({ name, run }), for dataService.runParticipantSelfTest(onStep, extraSteps): the two of Phase 9b and, given the lists'
 * titles (`titles`), the one of Phase 10h and the one of Phase 10i. SharePoint only: the local server has none of these questions, so the page passes none there.
 * @param {Probe} probe
 * @param {Record<string, string> | null} [titles]
 */
export const selfTestProbes = (probe, titles = null) => [
  { name: PROBE_YESNO, run: () => yesNoFilter(probe) },
  { name: PROBE_LENGTH, run: () => filterLength(probe) },
  ...(titles ? [{ name: PROBE_LEFT_OUT, run: () => columnsLeftOut(probe, titles) }, { name: PROBE_REFUSED, run: () => columnsRefused(probe, titles) }] : []),
];
