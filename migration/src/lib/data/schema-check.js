// The check of a site's lists and columns (dataService.js section 1's end; Phase 17 cut it out unchanged): checkSharePointLists() for
// Setup's list of lists, checkSharePointSchema() for the admin's Today screen and Setup. Read-only: it reads every list's columns, in
// one $batch where the site allows, and writes nothing. SharePoint only.

import { ID, LISTS } from '../schema/pms-schema.js';
import { columnsOf, fieldsOf } from './encoding.js';
import { listColumns, listMetadata, sharePoint, spListPath, spMetadata, spPages, spReadTogether, spTitle } from './core.js';

/** A column's type in the words SharePoint's own "Add column" dialog uses. */
const spTypeNames = { Text: 'Single line of text', Note: 'Multiple lines of text, plain text', Number: 'Number', DateTime: 'Date and Time', Boolean: 'Yes/No' };

export async function checkSharePointLists() {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  listMetadata.clear();
  const results = [];
  for (const list of Object.keys(LISTS)) {
    try {
      await spMetadata(list);
      results.push({ list: spTitle(list), status: 'Ready' });
    } catch (error) {
      results.push({ list: spTitle(list), status: error.message });
    }
  }
  return results;
}

// What the schema check expects of a column whose kind is all it knows (the admin's Today screen): text is a single line or several;
// a number may come back as Integer; JSON is plain text of several lines.
const KIND_TYPES = { text: ['Text', 'Note'], number: ['Number', 'Integer'], yesno: ['Boolean'], date: ['DateTime'], array: ['Note'], object: ['Note'] };
/**
 * What the schema check expects of each column of a list, from pms-schema.js alone: every column present and of a type its kind
 * allows, indexed where the data layer filters on it, and none but AppId required to hold a value; AppId required, indexed and unique.
 * [{ column, accepts, type, indexed, unique, required }], where `type` is how to create the column in words (none here: Setup hands in
 * its own, from pms-schema-meta.js).
 */
const spSpecs = (list) => [
  { column: ID, accepts: ['Text'], indexed: true, unique: true, required: true },
  ...Object.values(fieldsOf(list)).filter(({ column }) => column !== ID)
    .map(({ column, kind, indexed = false }) => ({ column, accepts: KIND_TYPES[kind], indexed })),
];

/**
 * The schema check. Read-only. For every list it names each thing that is wrong, with the internal column name and, where it is
 * given one, the type to create it as:
 *   [{ list, ready, problems: [{ column, type, problem }] }]
 * `column` is null when the list itself can't be read. Every column must exist and be of its type (schema v2: there is no column
 * that may be left out). Unlike checkSharePointLists(), which stops at a list's first problem, this reports all of them.
 *
 * What it expects of each column is `specs(listKey)`: by default what pms-schema.js alone says (spSpecs), which is what the admin's
 * Today screen checks, with no column's type in words; the Setup page hands in its own, made from pms-schema-meta.js (types, indexes,
 * choices, the words for each type), which no other page carries.
 *
 * With `{ batch: true }` the lists' columns are read together in ONE $batch request where the site
 * allows it (the admin's Today screen), and one by one otherwise. The report is the same either way.
 */
export async function checkSharePointSchema({ batch = false, specs = spSpecs } = {}) {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  listMetadata.clear();
  listColumns.clear();
  const report = [];
  const names = Object.keys(LISTS);
  const together = batch ? await spReadTogether(names.map((list) => `${spListPath(list)}/fields`)) : [];
  for (const [position, list] of names.entries()) {
    const title = spTitle(list);
    const problems = [];
    let fields;
    try {
      const read = together[position];
      if (read) {
        const next = read.__next ?? read['@odata.nextLink'] ?? read['odata.nextLink'];
        fields = [...(read.results ?? read.value ?? []), ...(next ? await spPages(next) : [])];
      } else {
        fields = await spPages(`${spListPath(list)}/fields`);
      }
    } catch (error) {
      report.push({ list: title, ready: false, problems: [{ column: null, type: null,
        problem: error.status === 404 ? `The list "${title}" does not exist.` : `The list could not be read: ${error.message}` }] });
      continue;
    }
    const byName = new Map(fields.map((field) => [field.InternalName, field]));
    const check = ({ column, accepts, type = null, indexed = false, unique = false, required = false, dateAndTime = false }) => {
      const field = byName.get(column);
      const flag = (problem) => problems.push({ column, type, problem });
      if (!field) return flag('Missing.');
      const actual = field.TypeAsString;
      if (!accepts.includes(actual)) flag(`Wrong type: it is ${spTypeNames[actual] ?? actual}.`);
      else if (actual === 'Note' && (field.RichText || field.AppendOnly)) flag('Must be plain text with append-only disabled.');
      if (indexed && !field.Indexed) flag('Not indexed.');
      if (unique && !field.EnforceUniqueValues) flag('Enforce unique values is off.');
      if (required && !field.Required) flag('Not required: every item must have one.');
      // (SharePoint's own Title is required on every list it makes, and every item the app makes has one: Phase 10c-3.)
      if (!required && field.Required && column !== 'Title') flag('Must not be required.');
      // (A date shown as Date Only can be read back as the day before, by the site's time zone. SharePoint says 0 for Date Only.)
      if (dateAndTime && field.DisplayFormat === 0) flag('Shows the date only: make it Date & Time.');
      return undefined;
    };
    for (const spec of specs(list)) check(spec);
    const mapped = new Set([ID, 'Title', ...Object.values(columnsOf(list))]);
    for (const field of fields) {
      if (field.Required && !field.ReadOnlyField && !mapped.has(field.InternalName)) {
        problems.push({ column: field.InternalName, type: null, problem: 'Unsupported required column: make it optional or remove it.' });
      }
    }
    report.push({ list: title, ready: problems.length === 0, problems });
  }
  return report;
}
