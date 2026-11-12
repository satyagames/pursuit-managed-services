// Setup's plan (Phase 10c-3): what Create would add to the site, list by list and column by column, worked out from the schema and the site
// as read, with its words for Show the plan. Moved out of provision.js unchanged (Prompt 44), which passes these names on. It sends nothing.

import { LISTS } from '../schema/pms-schema.js';
import { LIBRARY_META, META, columnsOf, retiredColumn } from '../schema/pms-schema-meta.js';
import { typeLabel } from './setup-checks.js';
import { LIBRARY_KEY, BUSY_LISTS, MADE_BY, SETTINGS_PENDING, TEMPLATE, BUILT_IN, lower } from './provision-site.js';

// ---- The plan --------------------------------------------------------------------------------------------------------------------

const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A column's definition, as SharePoint's createfieldasxml takes it: the internal name asked for three times (Name, StaticName and the display
 * name: the app reads a column by its internal name, and a person sees the same word), required for AppId alone, single-line text up to
 * SharePoint's 255 characters (the app keeps its own lower limits), plain text with no history for several lines, Date & Time for a date, and
 * a Yes/No that starts as No. No index and no uniqueness: those are later steps, the index first (ARCHITECTURE-10.md 6.3, in git history at 7347c72).
 * @param {ReturnType<typeof columnsOf>[number]} column
 */
export function definition(column) {
  const name = xml(column.name);
  const common = `Name="${name}" StaticName="${name}" DisplayName="${name}" Required="${column.required ? 'TRUE' : 'FALSE'}"`;
  switch (column.type) {
    case 'Text': return `<Field Type="Text" ${common} MaxLength="255" />`;
    case 'Note': return `<Field Type="Note" ${common} RichText="FALSE" AppendOnly="FALSE" NumLines="6" />`;
    case 'Number': return `<Field Type="Number" ${common} />`;
    case 'DateTime': return `<Field Type="DateTime" ${common} Format="DateTime" />`;
    case 'Boolean': return `<Field Type="Boolean" ${common}><Default>${column.default === 'Yes' ? 1 : 0}</Default></Field>`;
    default: throw new Error(`No definition for a column of type ${column.type}.`);
  }
}

/** The settings a list Setup makes is given: attachments off, content approval off, and version history off when asked for (a busy list only). */
export function listSettings(key, { versioning = false } = {}) {
  return { EnableAttachments: false, EnableModeration: false, ...(versioning && BUSY_LISTS.includes(key) ? { EnableVersioning: false } : {}) };
}

/** A list's description: what it is for, then that Setup made it (and, until its settings are made, that they are still to come). */
export const descriptionOf = (key, pending = true) => `${key === LIBRARY_KEY ? LIBRARY_META.purpose : META[key].purpose} ${pending && key !== LIBRARY_KEY ? SETTINGS_PENDING : MADE_BY}`;

const SETTING_WORDS = { EnableAttachments: 'attachments off', EnableModeration: 'content approval off', EnableVersioning: 'version history off' };
export const count = (number, one, many = `${one}s`) => `${number} ${number === 1 ? one : many}`;
/** A name as a person compares two: no case, no spaces or other signs, and SharePoint's `_x0020_` read as the space it stands for. */
const plain = (name) => lower(String(name ?? '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))).replace(/[^a-z0-9]/g, '');

/**
 * A column on the list that looks meant to be `wanted` but is not: called the same, spelled with a space (`Session_x0020_Id`), or the same
 * name with a digit after it (`SortOrder0`, a taken name). Columns SharePoint makes itself, hidden ones and the schema's own are never it.
 */
function lookAlike(fields, wanted, ours) {
  const target = plain(wanted);
  return fields.find((field) => !ours.has(field.InternalName) && field.InternalName !== 'Title' && !field.Hidden && !field.FromBaseType && !field.ReadOnlyField
    && (plain(field.InternalName) === target || plain(field.Title) === target || new RegExp(`^${wanted}\\d+$`).test(field.InternalName)));
}

/**
 * What would make `titles`' lists match the schema, from the site as `readSite` found it. Pure: the same site gives the same plan.
 * @param {{ lists: Map<string, any>, fields: Map<string, any[]> }} site
 * @param {Record<string, string>} titles
 * @param {{ versioning?: boolean }} [options] `versioning`: turn version history off on the four busy lists Setup makes
 */
export function makePlan(site, titles, { versioning = false } = {}) {
  /** @type {{ lists: any[], columns: any[], settings: any[], untouched: any[], groups: any[], versioning: boolean, summary: string, toFix: number, empty: boolean }} */
  const plan = { lists: [], columns: [], settings: [], untouched: [], groups: [], versioning, summary: '', toFix: 0, empty: true };
  const group = (key, title, state) => {
    const entry = { key, title, state, purpose: key === LIBRARY_KEY ? LIBRARY_META.purpose : META[key].purpose, lists: [], columns: [], settings: [], untouched: [] };
    plan.groups.push(entry);
    return entry;
  };
  const add = (entry, kind, item) => { entry[kind].push(item); plan[kind].push(item); };
  const keep = (entry, column, found, fix, harmless = false) => add(entry, 'untouched', { key: entry.key, list: entry.title, column, found, fix, harmless });
  const createColumn = (entry, column) => add(entry, 'columns', {
    key: entry.key, list: entry.title, name: column.name, type: column.type, label: typeLabel(column), xml: definition(column),
    words: `${column.name}: ${typeLabel({ ...column, indexed: false, unique: false })}`,
  });
  const indexOn = (entry, column) => add(entry, 'settings', { kind: 'index', key: entry.key, list: entry.title, column: column.name, changes: { Indexed: true }, words: `Index ${column.name}.` });
  const uniqueOn = (entry, column) => add(entry, 'settings', { kind: 'unique', key: entry.key, list: entry.title, column: column.name, changes: { EnforceUniqueValues: true }, words: `Enforce unique values on ${column.name} (after its index).` });
  const settingsOf = (entry) => {
    const changes = listSettings(entry.key, { versioning });
    add(entry, 'settings', { kind: 'list', key: entry.key, list: entry.title, changes, words: `Turn ${Object.keys(changes).map((name) => SETTING_WORDS[name]).join(', ')}.` });
  };

  for (const key of Object.keys(LISTS)) {
    const title = titles[key];
    const columns = columnsOf(key);
    const found = site.lists.get(lower(title));
    if (!found) {
      const entry = group(key, title, 'new');
      add(entry, 'lists', { key, title, template: TEMPLATE.list, description: descriptionOf(key), words: `Create the list ${title}.` });
      for (const column of columns) if (column.name !== BUILT_IN) createColumn(entry, column);
      for (const column of columns) if (column.indexed) indexOn(entry, column);
      for (const column of columns) if (column.unique) uniqueOn(entry, column);
      settingsOf(entry);
      continue;
    }
    const entry = group(key, found.Title, 'exists');
    if (found.BaseTemplate !== TEMPLATE.list) {
      keep(entry, null, `${found.Title} is a ${found.BaseTemplate === TEMPLATE.library ? 'document library' : `site item of template ${found.BaseTemplate}`}, not a list.`,
        `Give it another title or delete it (if it holds nothing you need), then press Show the plan again: Create will then make the list ${title}.`);
      continue;
    }
    const fields = site.fields.get(key) ?? [];
    const byName = new Map(fields.map((field) => [field.InternalName, field]));
    const ours = new Set(columns.map((column) => column.name));
    const indexes = [];
    const uniques = [];
    for (const column of columns) {
      const field = byName.get(column.name);
      const wanted = typeLabel({ ...column, indexed: false, unique: false, required: false });
      if (!field && column.name === BUILT_IN) continue; // (SharePoint's own: every real list has it)
      if (!field) {
        const alike = lookAlike(fields, column.name, ours);
        if (alike) {
          keep(entry, column.name, `A column called "${alike.Title ?? alike.InternalName}" has the internal name ${alike.InternalName}; the app looks for ${column.name}.`,
            `A column's internal name is fixed when it is made. Delete "${alike.Title ?? alike.InternalName}" (on a new list it holds nothing), then press Show the plan again: Create will make ${column.name} (${wanted}).`);
          continue;
        }
        createColumn(entry, column);
        if (column.indexed) indexes.push(column);
        if (column.unique) uniques.push(column);
        continue;
      }
      const accepts = column.type === 'Number' ? ['Number', 'Integer'] : [column.type];
      if (!accepts.includes(field.TypeAsString)) {
        keep(entry, column.name, `${column.name} is of type ${field.TypeAsString}; the app needs ${wanted}.`,
          `A column's type is not changed here. In the list's settings, change ${column.name} to ${wanted}, or delete it (on a new list it holds nothing) and press Show the plan again: Create will make it.`);
        continue;
      }
      if (column.type === 'Note' && (field.RichText || field.AppendOnly)) {
        keep(entry, column.name, `${column.name} is ${field.RichText ? 'rich text' : ''}${field.RichText && field.AppendOnly ? ' and ' : ''}${field.AppendOnly ? 'set to append changes' : ''}; the app keeps plain text in it.`,
          `In the list's settings, edit ${column.name}: choose Plain text, and set "Append Changes to Existing Text" to No.`);
      }
      if (column.format === 'Date & Time' && field.DisplayFormat === 0) {
        keep(entry, column.name, `${column.name} shows the date only, which can bring a date back as the day before.`, `In the list's settings, edit ${column.name}: set "Date and Time Format" to Date & Time.`);
      }
      if (column.required && !field.Required) {
        keep(entry, column.name, `${column.name} is not required; every item must have one.`, `In the list's settings, edit ${column.name}: set "Require that this column contains information" to Yes.`);
      }
      if (!column.required && field.Required && column.name !== BUILT_IN) {
        keep(entry, column.name, `${column.name} is required, and the app leaves it empty in some items.`, `In the list's settings, edit ${column.name}: set "Require that this column contains information" to No.`);
      }
      if (column.indexed && !field.Indexed) indexes.push(column);
      if (!column.indexed && field.Indexed) {
        keep(entry, column.name, `${column.name} is indexed, though the app never filters on it.`, 'Harmless: leave it as it is, or remove the index if you like.', true);
      }
      if (column.unique && !field.EnforceUniqueValues) uniques.push(column);
    }
    for (const field of fields) {
      // (A column of an earlier version that this one no longer uses: never deleted here, and harmless. Phase 10i.)
      const old = retiredColumn(key, field.InternalName);
      if (old && !ours.has(field.InternalName)) {
        keep(entry, field.InternalName, `${field.InternalName} is no longer used since version ${old.lastIn + 1}: ${old.now} holds ${old.holds} now. (SharePoint gives every list item a property called ${old.name}, and would not return a column of that name when a read named it.)`,
          'Harmless: nothing reads or writes it. Leave it as it is, or a site owner may delete it by hand.', true);
      }
      if (field.Required && !field.ReadOnlyField && !field.FromBaseType && field.InternalName !== 'Title' && !ours.has(field.InternalName)) {
        keep(entry, field.InternalName, `${field.InternalName} is a required column the app does not know, so it never fills it in: every save would be refused.`,
          `In the list's settings, edit ${field.Title ?? field.InternalName}: set "Require that this column contains information" to No, or delete the column.`);
      }
    }
    for (const column of indexes) indexOn(entry, column);
    for (const column of uniques) uniqueOn(entry, column);
    // A list Setup made whose settings a stopped run never made: this run makes them. A list made by hand is never given settings.
    if (String(found.Description ?? '').endsWith(SETTINGS_PENDING)) settingsOf(entry);
  }

  const library = titles[LIBRARY_KEY];
  const shelf = site.lists.get(lower(library));
  if (!shelf) {
    const entry = group(LIBRARY_KEY, library, 'new');
    add(entry, 'lists', { key: LIBRARY_KEY, title: library, template: TEMPLATE.library, description: descriptionOf(LIBRARY_KEY), words: `Create the picture library ${library}.` });
  } else if (shelf.BaseTemplate !== TEMPLATE.library) {
    const entry = group(LIBRARY_KEY, shelf.Title, 'exists');
    keep(entry, null, `${shelf.Title} is a list, not a document library.`, `Give it another title or delete it (if it holds nothing you need), then press Show the plan again: Create will then make the picture library ${library}.`);
  } else {
    group(LIBRARY_KEY, shelf.Title, 'exists');
  }

  const toFix = plan.untouched.filter((item) => !item.harmless).length;
  const total = plan.lists.length + plan.columns.length + plan.settings.length;
  plan.summary = total === 0 ? 'Nothing to create'
    : `${count(plan.lists.length, 'list')}, ${count(plan.columns.length, 'column')}, ${count(plan.settings.length, 'setting')} to create`;
  plan.toFix = toFix;
  plan.empty = total === 0;
  return plan;
}
