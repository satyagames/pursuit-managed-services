// The schema's lists and columns as the data layer reads and writes them, and the small helpers that hold no state (Phase 17: cut out of
// dataService.js section 1 and 6 unchanged). Reads lib/schema/pms-schema.js; sends nothing, keeps nothing, and imports no other part of
// lib/data, so every part may use it. A helper that needs the page's settings (a list's title on this site) belongs in core.js.

import { LIBRARY, LISTS } from '../schema/pms-schema.js';

const indexById = (items) => new Map(items.map((item) => [String(item.id), item]));
const pick = (index, ids = []) => ids.map((id) => index.get(String(id))).filter(Boolean);

// The lists and their columns are migration/src/lib/schema/pms-schema.js's (Phase 10c-2b): a list's title before any prefix, and for each field of a
// record the column that holds it and its kind. Nothing below spells a list or a column. Every column must exist (schema v2): a list
// that lacks one is refused before anything is written to it (spMetadata).
const fieldsOf = (list) => LISTS[list].fields;
/** list -> { field: column }, made once. */
const columnMaps = Object.fromEntries(Object.entries(LISTS).map(([list, { fields }]) => [list,
  Object.fromEntries(Object.entries(fields).map(([key, { column }]) => [key, column]))]));
/** Every field of a list the adapter can read or write, and its column. */
const columnsOf = (list) => columnMaps[list];
const kindOf = (list, key) => LISTS[list].fields[key]?.kind;
/** The columns of a participant's own Responses item, which the fast paths below read and write by hand. */
const RESPONSE = columnsOf('responses');
const spError = (status, message) => Object.assign(new Error(message), { status });
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const spLiteral = (value) => `'${encodeURIComponent(String(value).replace(/'/g, "''"))}'`;
// A list's title on this site (Phase 10b). Several copies of the app can share a site, each with lists of its own: the settings
// may put a prefix in front of every title (`listPrefix`) and may name any one list outright (`lists`, by key). A page whose
// settings have neither gets the usual title, so its requests are character for character what they were before Phase 10b.
const spTitleIn = (settings, list) => settings?.lists?.[list] ?? (settings?.listPrefix ?? '') + LISTS[list].title;
/** The picture library's title: the one the settings name, else the prefix and its usual name. */
const spLibraryIn = (settings) => settings?.logoLibrary ?? `${settings?.listPrefix ?? ''}${LIBRARY}`;

/** A Retry-After header (seconds, or an HTTP date) as milliseconds from now: undefined without one, NaN for one that can't be read. */
function retryAfterMs(response) {
  const retry = response.headers.get('Retry-After');
  if (retry === null) return undefined;
  return /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
}

/** A JSON object stored as text. Anything unreadable is null: a damaged theme must not stop its client loading. */
function spParseObject(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function spEncode(list, record) {
  const fields = {};
  const columns = columnsOf(list);
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const column = columns[key];
    if (!column) throw new Error(`Unsupported field ${list}.${key}.`);
    const kind = kindOf(list, key);
    fields[column] = kind === 'array' ? JSON.stringify(value ?? [])
      : kind === 'object' ? value === null ? null : JSON.stringify(value)
      : kind === 'yesno' ? value === true
      : kind === 'date' ? value ? key === 'date' ? `${value.slice(0, 10)}T00:00:00Z` : value : null
      : key === 'value' && value !== null ? String(value) : value;
    if (typeof fields[column] === 'string' && fields[column].length > 60_000) {
      throw new Error(`${column} exceeds the supported text size. Start a new session before collecting more answers.`);
    }
  }
  return fields;
}

const chunked = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
const distinct = (list) => [...new Set(list)];
/** Ids per read, so one read's address stays well under 2,000 characters. */
const READ_CHUNK = 20;

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export { READ_CHUNK, RESPONSE, chunked, columnsOf, distinct, fieldsOf, indexById, kindOf, pause, pick, retryAfterMs, spEncode, spError, spLibraryIn, spLiteral, spParseObject, spTitleIn };
