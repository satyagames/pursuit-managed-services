// The backend adapter (dataService.js section 1; Phase 17 cut it out of that file unchanged): ALL of the data layer's state, and the only
// code of the app that sends a request to the backend. It holds which backend this page uses (configure(), requireConfiguration()), the
// SharePoint write token, the lists' item types and columns once read, whether $batch works here, the request count and a QR scan not
// yet known to have landed; it makes every request (one SharePoint REST call with its retries, a $batch of reads, the local server's
// fetch) and offers the generic item calls both backends implement. No other part keeps state or calls fetch(); this part imports
// nothing of the parts that use it (scripts/test-data-modules.js holds both).

import { ID, LISTS, selectOf } from '../schema/pms-schema.js';
import {
  columnsOf, fieldsOf, indexById, kindOf, pause, pick, retryAfterMs, spEncode, spError, spLiteral, spParseObject, spTitleIn,
} from './encoding.js';

// ============================================================================
// 1. Backend adapter
// ============================================================================

let baseUrl = globalThis.CEC_API_BASE || '/api';
let sharePoint = globalThis.CEC_SHAREPOINT ?? null;
let digestPromise;
const listMetadata = new Map();
const listTypes = new Map(); // list -> its item entity type, learnt from any item read or asked for once
const typeReads = new Map(); // list -> the request for its item type that prepareWrites() made, while it is on its way
const listColumns = new Map(); // list -> the internal column names it has, once its fields were read
let batchOff = false; // this page load found $batch unusable, so reads that would share a request go one by one
let unfinishedScan = null; // a QR scan whose track is written but whose claim is not known to have landed (openQrScan); never stored
let requestTotal = 0;
let mustConfigure = false; // requireConfiguration() was called and configure() has not been since: nothing may be sent (Phase 10b)
let onStop = null; // what the page does when the site's lists are not this build's (lib/settings/start.ts: its stop screen); none for Setup or a test

/**
 * Points the service at the API. Only needed when the page isn't served by the
 * Express server itself, e.g. configure({ baseUrl: 'http://192.168.1.20:3000/api' }).
 */
export function configure({ baseUrl: url, sharePoint: settings, onStop: stop } = {}) {
  if (url !== undefined) {
    baseUrl = url.replace(/\/+$/, '');
    sharePoint = null;
  }
  if (settings !== undefined) sharePoint = settings;
  digestPromise = undefined;
  listMetadata.clear();
  listTypes.clear();
  typeReads.clear();
  listColumns.clear();
  batchOff = false;
  unfinishedScan = null;
  mustConfigure = false;
  onStop = stop ?? null;
}

/**
 * Opt-in, for a page that works out its settings as it starts (Phase 10b; the three Svelte entries call it before anything else):
 * from now until configure() is called, anything that would send a request throws PMS-CFG-003 and sends nothing, and so does
 * isSharePointMode(), which has no answer yet. It turns "a module asked too early" into an error a test sees, where it used to be a
 * request to wherever the defaults pointed. A caller that never opts in (every test that configures the service itself) is as it was.
 */
export function requireConfiguration() {
  mustConfigure = true;
}
function assertConfigured() {
  // (The code is the whole message: its words, like every problem's, are in migration/src/lib/settings/deploy-problems.js.)
  if (mustConfigure) throw Object.assign(new Error('PMS-CFG-003'), { code: 'PMS-CFG-003' });
}
const spTitle = (list) => spTitleIn(sharePoint, list);
const spListPath = (list) => `/web/lists/getbytitle(${spLiteral(spTitle(list))})`;
// Every item read names its columns (Phase 10h): the real site left ClientId out of a read that did not, and returned it to one that did.
/** The address of an item read of `list` with the query `query`, naming the list's columns. */
const spItems = (list, query) => `${spListPath(list)}/items?${query}&${selectOf(list)}`;
/** The read of the item whose AppId is `id`. */
const spByAppId = (list, id) => spItems(list, `$filter=${ID} eq ${spLiteral(id)}&$top=2`);

function spSite() {
  const site = new URL(sharePoint.siteUrl);
  if (site.protocol !== 'https:' || (globalThis.location && site.origin !== location.origin)) {
    throw new Error('SharePoint mode requires an HTTPS site on the same origin as this page.');
  }
  return site.href.replace(/\/+$/, '');
}

// `idempotent` marks a write that is safe to send twice (it replaces a whole value, or a repeat is
// caught by the unique AppId), so a 503/504 is retried for it the way it always was for a GET.
async function spHttp(method, resource, { body, headers = {}, digest = true, idempotent = false } = {}) {
  assertConfigured();
  const root = `${spSite()}/_api`;
  const url = resource.startsWith('https://') ? resource : `${root}${resource}`;
  if (!url.startsWith(`${root}/`)) throw new Error('Unexpected SharePoint pagination URL.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const writeHeaders = method === 'GET' || !digest ? {} : { 'X-RequestDigest': await spDigest() };
    requestTotal += 1;
    const response = await fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json;odata=verbose', ...writeHeaders,
        ...(body === undefined ? {} : { 'Content-Type': body instanceof Blob ? body.type : 'application/json;odata=verbose' }), ...headers },
      body: body === undefined || body instanceof Blob ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const asked = [429, 503, 504].includes(response.status) ? retryAfterMs(response) : undefined;
    const retryAfter = Number.isFinite(asked) ? asked : undefined; // handed to the caller if every try fails
    if (response.status === 429 || ((method === 'GET' || idempotent) && [503, 504].includes(response.status))) {
      if (attempt < 3) {
        const delay = asked ?? 300 * 2 ** attempt;
        if (Number.isFinite(delay) && delay <= 30_000) {
          await pause(delay);
          continue;
        }
      }
    }
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch {
      throw spError(response.ok ? 401 : response.status, 'SharePoint returned a sign-in page or non-JSON response. Open the site, sign in, then reload this app.');
    }
    if (!response.ok) {
      const detail = payload?.error?.message;
      const message = typeof detail === 'string' ? detail : detail?.value;
      if (response.status === 403 && digest && attempt === 0 && /security validation|request digest/i.test(message ?? '')) {
        digestPromise = undefined;
        continue;
      }
      // A value a unique column holds already (AppId) is 409, "it is there already", to every caller, however SharePoint says it: 400 as it is
      // documented, 500 as the real site did (Phase 10h), by its error code or by its words. Any other refusal keeps its status. `sharePointStatus`
      // is what SharePoint said, for a Details line.
      const duplicate = [400, 409, 500].includes(response.status)
        && (/SPDuplicateValuesFoundException/.test(payload?.error?.code) || /duplicate|unique value/i.test(message ?? ''));
      throw Object.assign(spError(duplicate ? 409 : response.status, `SharePoint (${response.status}): ${message ?? response.statusText}`),
        { sharePointStatus: response.status }, retryAfter === undefined ? {} : { retryAfter });
    }
    return { data: payload?.d ?? payload, etag: response.headers.get('ETag') };
  }
}

async function spDigest() {
  if (digestPromise) {
    const cached = await digestPromise;
    if (cached.expires > Date.now()) return cached.value;
  }
  digestPromise = (async () => {
    const { data } = await spHttp('POST', '/contextinfo', { digest: false });
    const info = data.GetContextWebInformation ?? data;
    if (!info.FormDigestValue) throw new Error('SharePoint did not return a write-validation token.');
    return { value: info.FormDigestValue, expires: Date.now() + Math.max(1, Number(info.FormDigestTimeoutSeconds) - 30) * 1000 };
  })();
  try { return (await digestPromise).value; } catch (error) {
    digestPromise = undefined;
    throw error;
  }
}

async function spPages(resource) {
  const items = [];
  while (resource) {
    const { data } = await spHttp('GET', resource);
    items.push(...(data.results ?? data.value ?? []));
    resource = data.__next ?? data['@odata.nextLink'] ?? data['odata.nextLink'];
  }
  return items;
}

function spDecode(list, raw) {
  if (!raw[ID]) throw new Error(`${spTitle(list)} contains an item without ${ID}.`);
  const item = {};
  for (const [key, column] of Object.entries(columnsOf(list))) {
    let value = raw[column];
    const kind = kindOf(list, key);
    if (kind === 'array') {
      try { value = value ? JSON.parse(value) : []; } catch { throw new Error(`${spTitle(list)}.${column} contains invalid JSON (${raw[ID]}).`); }
      if (!Array.isArray(value)) throw new Error(`${column} must contain a JSON array (${raw[ID]}).`);
    } else if (kind === 'object') { if (value !== undefined) value = spParseObject(value); }
    else if (key === 'date' && value) value = value.slice(0, 10);
    else if (key === 'value' && value !== null && value !== '' && value !== undefined && String(Number(value)) === value) value = Number(value);
    if (value !== undefined) item[key] = value;
  }
  const type = raw.__metadata?.type;
  if (type) listTypes.set(list, type);
  return { item, numericId: raw.Id, etag: raw.__metadata?.etag ?? raw['@odata.etag'] ?? raw['odata.etag'], type };
}

// The properties of a column the check below reads, and only those (Phase 10j): a real list answers a read of its columns that names none
// with every field it has, hidden ones too, each with all its properties and its whole definition.
const FIELD_CHECK = '$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,RichText,AppendOnly,Required,ReadOnlyField';

async function spMetadata(list) {
  if (!listMetadata.has(list)) {
    const pending = (async () => {
      const path = spListPath(list);
      const [{ data }, fields] = await Promise.all([
        spHttp('GET', `${path}?$select=ListItemEntityTypeFullName`),
        spPages(`${path}/fields?${FIELD_CHECK}`),
      ]);
      const columns = new Map(fields.map((field) => [field.InternalName, field]));
      const required = Object.values(fieldsOf(list));
      for (const column of new Set([ID, ...required.map((field) => field.column)])) {
        if (!columns.has(column)) throw new Error(`${spTitle(list)} is missing the internal column ${column}. See SHAREPOINT-LISTS.md.`);
      }
      const appId = columns.get(ID);
      if (appId.TypeAsString !== 'Text' || !appId.Indexed || !appId.EnforceUniqueValues) {
        throw new Error(`${spTitle(list)}.${ID} must be Single line of text, indexed, with Enforce unique values = Yes.`);
      }
      for (const { column, kind } of required) {
        const field = columns.get(column);
        if ((kind === 'array' || kind === 'object') && (field.TypeAsString !== 'Note' || field.RichText || field.AppendOnly)) {
          throw new Error(`${spTitle(list)}.${column} must be Multiple lines of plain text, with append-only disabled.`);
        }
      }
      const mapped = new Set([ID, 'Title', ...required.map((field) => field.column)]);
      const extra = fields.find((field) => field.Required && !field.ReadOnlyField && !mapped.has(field.InternalName));
      if (extra) throw new Error(`${spTitle(list)} has an unsupported required column: ${extra.InternalName}.`);
      listColumns.set(list, new Set(columns.keys()));
      listTypes.set(list, data.ListItemEntityTypeFullName);
      return data.ListItemEntityTypeFullName;
    })();
    listMetadata.set(list, pending);
    pending.catch(() => listMetadata.delete(list));
  }
  return listMetadata.get(list);
}

/**
 * A list's item entity type (needed in every write body), with one small request the first time and none afterwards. A write that asks while
 * prepareWrites() is fetching it waits for that request (Phase 10j), and asks itself if it failed.
 */
async function spEntityType(list) {
  if (!listTypes.has(list)) {
    const ahead = typeReads.get(list);
    if (ahead) { try { return await ahead; } catch { /* forgotten: asked for as always, below */ } }
    const { data } = await spHttp('GET', `${spListPath(list)}?$select=ListItemEntityTypeFullName`);
    listTypes.set(list, data.ListItemEntityTypeFullName);
  }
  return listTypes.get(list);
}

/** spEntityType() for prepareWrites(): the same request, held while it is on its way so that a write meanwhile waits for it. */
function spEntityTypeAhead(list) {
  if (listTypes.has(list)) return Promise.resolve(listTypes.get(list));
  if (!typeReads.has(list)) {
    const pending = spHttp('GET', `${spListPath(list)}?$select=ListItemEntityTypeFullName`).then(({ data }) => {
      listTypes.set(list, data.ListItemEntityTypeFullName);
      return data.ListItemEntityTypeFullName;
    });
    typeReads.set(list, pending);
    pending.then(() => typeReads.delete(list), () => typeReads.delete(list));
  }
  return typeReads.get(list);
}

async function spFind(list, id) {
  const rows = await spPages(spByAppId(list, id));
  if (rows.length > 1) throw new Error(`Duplicate ${ID} ${id} in ${spTitle(list)}.`);
  return rows.length ? spDecode(list, rows[0]) : null;
}

/** The item a create returned, with any column the reply left out taken from what was written (Phase 10h: see spItems). */
function spMade(list, data, record) {
  const { item } = spDecode(list, data);
  for (const [key, value] of Object.entries(record)) if (!(key in item) && value !== undefined) item[key] = value;
  return item;
}

async function spCreate(list, id, record) {
  const type = await spMetadata(list);
  const fields = spEncode(list, record);
  const { data } = await spHttp('POST', `${spListPath(list)}/items`, {
    body: { __metadata: { type }, Title: record.title ?? record.name ?? id, ...fields, [ID]: id },
  });
  return spMade(list, data, record);
}

async function spMerge(list, found, changes, etag = found.etag) {
  if (!etag) throw new Error(`SharePoint did not return an ETag for ${spTitle(list)}.`);
  const type = await spMetadata(list);
  await spHttp('POST', `${spListPath(list)}/items(${found.numericId})`, {
    headers: { 'X-HTTP-Method': 'MERGE', 'If-Match': etag },
    body: { __metadata: { type }, ...spEncode(list, changes) },
  });
  return { ...found.item, ...changes };
}

async function spMutate(list, id, initial, change, allowCreate = true) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = await spFind(list, id);
    if (!found && !allowCreate) throw Object.assign(spError(404, `No ${list} item with ${ID} ${id}.`), { code: 'item-missing' });
    const item = found?.item ?? structuredClone(initial);
    const value = change(item);
    try {
      if (found) await spMerge(list, found, item);
      else await spCreate(list, id, item);
      return value;
    } catch (error) {
      if (![409, 412].includes(error.status) || attempt === 4) throw error;
      await pause(30 * (attempt + 1));
    }
  }
}

async function spSend(method, path, { body, headers = {} }) {
  const route = new URL(path, 'https://cec.invalid');
  const [list, encodedId] = route.pathname.slice(1).split('/');
  const id = encodedId === undefined ? undefined : decodeURIComponent(encodedId);
  if (list === 'host') return { data: { lanUrls: [] } };
  if (!LISTS[list]) throw new Error(`Unknown list: ${list}`);
  if (id === undefined && method === 'GET') {
    const clauses = [];
    const columns = columnsOf(list);
    for (const key of new Set(route.searchParams.keys())) {
      const column = columns[key];
      if (!column) throw new Error(`Unsupported filter: ${key}`);
      clauses.push(`(${route.searchParams.getAll(key).map((value) => `${column} eq ${spLiteral(value)}`).join(' or ')})`);
    }
    const rows = await spPages(spItems(list, `$top=200${clauses.length ? `&$filter=${clauses.join(' and ')}` : ''}`));
    return { data: rows.map((row) => spDecode(list, row).item) };
  }
  if (method === 'POST') {
    const appId = String(body.id ?? crypto.randomUUID());
    return { data: await spCreate(list, appId, { ...body, id: appId }) };
  }
  if (method === 'PATCH' && !headers['If-Match']) {
    return { data: await spMutate(list, id, {}, (item) => Object.assign(item, body), false) };
  }
  const found = await spFind(list, id);
  if (!found) throw Object.assign(spError(404, `No ${list} item with ${ID} ${id}.`), { code: 'item-missing' });
  if (method === 'GET') {
    spRefs.set(found.item, { id: found.numericId, type: found.type });
    return { data: found.item, etag: found.etag };
  }
  if (method === 'DELETE') {
    if (!found.etag) throw new Error('SharePoint did not return an ETag for deletion.');
    await spHttp('POST', `${spListPath(list)}/items(${found.numericId})`, { headers: { 'X-HTTP-Method': 'DELETE', 'If-Match': found.etag } });
    return { data: null };
  }
  return { data: await spMerge(list, found, body, headers['If-Match']) };
}

/**
 * One HTTP call. Resolves to { data, etag }; `etag` is the item's version, when the backend sends one.
 * `body` is sent as JSON, unless it is a Blob/File (an upload), which goes as it is.
 */
async function send(method, path, { body, headers } = {}) {
  assertConfigured();
  if (sharePoint) return spSend(method, path, { body, headers });
  const upload = body instanceof Blob;
  requestTotal += 1;
  const response = await fetch(baseUrl + path, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': upload ? body.type : 'application/json', ...headers },
    body: body === undefined || upload ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000), // fail rather than hang on flaky Wi-Fi
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => null))?.error;
    const retryAfter = retryAfterMs(response);
    throw Object.assign(new Error(message ?? `${method} ${path} failed (${response.status})`), {
      status: response.status,
      ...(Number.isFinite(retryAfter) ? { retryAfter } : {}),
    });
  }
  const text = await response.text();
  return { data: text ? JSON.parse(text) : null, etag: response.headers.get('ETag') };
}

const request = async (method, path, body) => (await send(method, path, { body })).data;

/**
 * True when `error` means the backend couldn't be reached or failed on its side (offline,
 * timed out, 5xx), as opposed to it answering "no" (404, 409 and the like). Screens use it
 * to offer a retry instead of a dead end. Part of the adapter: the SharePoint version
 * decides what a connection failure looks like there.
 */
export const isUnreachable = (error) =>
  error instanceof TypeError || // fetch() rejects with this when there is no connection
  ['TimeoutError', 'AbortError'].includes(error?.name) ||
  (typeof error?.status === 'number' && (error.status === 429 || error.status >= 500));

export const isSharePointMode = () => { assertConfigured(); return Boolean(sharePoint); };

// List operations: the same set a SharePoint list offers. `list` is a logical
// name (a JSON file here; a SharePoint list after the migration).

const itemPath = (list, id) => `/${list}/${encodeURIComponent(id)}`;

async function getItem(list, id) {
  try {
    return await request('GET', itemPath(list, id));
  } catch (error) {
    if (error.status === 404 && (!sharePoint || error.code === 'item-missing')) return null;
    throw error;
  }
}

/** Several items by ID in one request, in the order given. Unknown IDs are skipped. */
async function getItems(list, ids = []) {
  if (ids.length === 0) return [];
  const query = new URLSearchParams([...new Set(ids)].map((id) => ['id', id]));
  const index = indexById(await request('GET', `/${list}?${query}`));
  const missing = ids.filter((id) => !index.has(String(id)));
  if (missing.length > 0) console.warn(`dataService: no ${list} with id`, missing);
  return pick(index, ids);
}

/**
 * A single line of text holds 255 characters on SharePoint: a longer one is refused here, in words, before anything is sent, on both adapters
 * (Phase 10c-3; text kept in several lines is marked `long` in pms-schema.js).
 */
function fits(list, record) {
  for (const [key, value] of Object.entries(record)) {
    const field = LISTS[list].fields[key];
    if (field?.kind === 'text' && !field.long && value?.length > 255) {
      throw Object.assign(new Error(`${field.column} can hold 255 characters at most; this is ${value.length}. Nothing was saved.`), { status: 400, code: 'too-long' });
    }
  }
  return record;
}
const listItems = (list) => request('GET', `/${list}`);
const createItem = async (list, fields) => request('POST', `/${list}`, fits(list, fields));
const updateItem = async (list, id, changes) => request('PATCH', itemPath(list, id), fits(list, changes));
const deleteItem = (list, id) => request('DELETE', itemPath(list, id));

/** Items whose fields equal the given values, e.g. queryItems('tracks', { sessionId }). */
const queryItems = (list, filters) => request('GET', `/${list}?${new URLSearchParams(filters)}`);

// Optimistic concurrency, for read-check-write sequences that several iPads can
// race on (claiming a QR token). Read an item with its version, then write only if
// nobody changed it meanwhile. Locally the version is an ETag checked through
// If-Match; SharePoint list items use the same ETag / If-Match pair.

/** { item, etag } for an item, or null if it doesn't exist. */
async function getItemWithVersion(list, id) {
  try {
    const { data, etag } = await send('GET', itemPath(list, id));
    return { item: data, etag };
  } catch (error) {
    if (error.status === 404 && (!sharePoint || error.code === 'item-missing')) return null;
    throw error;
  }
}

/** Merge-update that applies only if the item is still at `etag`; otherwise throws with status 412. */
const updateItemIfUnchanged = async (list, id, changes, etag) =>
  (await send('PATCH', itemPath(list, id), { body: changes, headers: { 'If-Match': etag } })).data;

// Where other devices on the network can reach the app (for QR codes; a dev-server extra).
const readLanUrls = async () => (await request('GET', '/host')).lanUrls;

// A read hands out plain records; this remembers, per record object, where its item is, so a
// later one-field write to that same record can go straight to it.
const spRefs = new WeakMap();

// ---- Several reads in one request -------------------------------------------------------------

/**
 * Several GETs as ONE request to the site's $batch endpoint (OData multipart: one application/http
 * part per read). Resolves to each read's payload, in order, with `undefined` for a part that did
 * not come back 2xx with JSON. Throws when the reply as a whole is not a batch reply.
 */
async function spBatch(resources) {
  assertConfigured();
  const root = `${spSite()}/_api`;
  const boundary = `batch_${crypto.randomUUID()}`;
  const body = [
    ...resources.flatMap((resource) => [
      `--${boundary}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '',
      // An absolute, fully encoded address: a request line is split on its spaces. Without the
      // Accept line SharePoint answers a part in Atom XML.
      `GET ${new URL(`${root}${resource}`).href} HTTP/1.1`, 'Accept: application/json;odata=verbose', '',
    ]),
    `--${boundary}--`, '',
  ].join('\r\n');
  const digest = await spDigest();
  requestTotal += 1;
  const response = await fetch(`${root}/$batch`, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json;odata=verbose', 'Content-Type': `multipart/mixed; boundary=${boundary}`, 'X-RequestDigest': digest },
    body, signal: AbortSignal.timeout(20_000),
  });
  const mark = /boundary="?([^";]+)"?/i.exec(response.headers.get('Content-Type') ?? '')?.[1];
  const text = await response.text();
  if (!response.ok) {
    const retryAfter = retryAfterMs(response);
    throw Object.assign(spError(response.status, `SharePoint refused the batch request (${response.status}).`), Number.isFinite(retryAfter) ? { retryAfter } : {});
  }
  const parts = mark ? text.split(`--${mark}`).slice(1, -1) : [];
  if (parts.length !== resources.length) {
    throw Object.assign(spError(502, `SharePoint answered ${parts.length} of ${resources.length} batched reads.`), { code: 'batch-unusable' });
  }
  return parts.map((part) => {
    const lines = part.split(/\r?\n/);
    const status = lines.findIndex((line) => /^HTTP\/[\d.]+ \d{3}/.test(line));
    const blank = status === -1 ? -1 : lines.indexOf('', status);
    if (blank === -1 || !/^HTTP\/[\d.]+ 2\d\d/.test(lines[status])) return undefined;
    try {
      const payload = JSON.parse(lines.slice(blank + 1).join('\n'));
      return payload?.d ?? payload ?? undefined;
    } catch { return undefined; }
  });
}

/**
 * The payloads of `resources`, in order, where they could be read in one request; an empty list,
 * or a hole, where they could not, for the caller to read with a plain GET instead. A site or a
 * moment in which $batch can't be used must only ever cost requests, never a page that fails.
 * A page that is refused a batch does not ask for another; `batch: false` in the page's SharePoint
 * settings (pms-config.txt, or PMS_BATCH=false on the build) stops it asking at all, which saves that
 * one refused request per load.
 */
async function spReadTogether(resources) {
  if (batchOff || sharePoint.batch === false || resources.length < 2) return [];
  try {
    return await spBatch(resources);
  } catch (error) {
    if ([429, 503, 504].includes(error.status)) await pause(Math.min(error.retryAfter ?? 300, 30_000)); // busy, not unsupported: wait before the plain reads
    else if (error.status === 403) digestPromise = undefined; // most likely a stale write token; the plain reads need none
    else if (error.code === 'batch-unusable' || (error.status >= 400 && error.status < 500)) batchOff = true;
    return [];
  }
}
const logoFolders = new WeakMap(); // the SharePoint settings object -> the library folder's server-relative address

/**
 * The payloads of `asked` ({ name: address }), in one $batch where possible and plain reads where not.
 * Resolves to { data, requests }: `requests` is what the reads cost (1 for a batch, one each otherwise).
 */
async function spReadOrBatch(asked) {
  const names = Object.keys(asked);
  let parts = [];
  if (names.length > 1 && !batchOff && sharePoint.batch !== false) {
    try {
      parts = await spBatch(Object.values(asked));
    } catch (error) {
      if ([429, 503, 504].includes(error.status)) throw error; // busy: the caller backs off, nothing is read twice now
      if (error.status === 403) digestPromise = undefined; // most likely a stale write token; the plain reads need none, and the next check asks again
      else if (error.code === 'batch-unusable' || (error.status >= 400 && error.status < 500)) batchOff = true; // this site cannot batch: read one by one from now on
      else throw error; // no connection, a timeout, a 5xx: that is not a reason to read three things one by one, it is a reason to wait
      parts = [];
    }
  }
  const batched = parts.length === names.length && names.length > 1;
  const data = {};
  let requests = batched ? 1 : 0;
  await Promise.all(names.map(async (name, index) => {
    if (batched && parts[index] !== undefined) { data[name] = parts[index]; return; }
    requests += 1;
    data[name] = (await spHttp('GET', asked[name])).data;
  }));
  return { data, requests };
}

/** openQrScan()'s note of a scan whose claim is not known to have landed (qr-scan.js): written through here, so that it is part of this
 * module's state and configure() forgets it with the rest. */
const holdScan = (scan) => { unfinishedScan = scan; };

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export {
  baseUrl, createItem, deleteItem, fits, getItem, getItemWithVersion, getItems, holdScan, itemPath, listColumns, listItems, listMetadata, listTypes,
  logoFolders, onStop, queryItems, readLanUrls, request, requestTotal, send, sharePoint, spBatch, spByAppId, spCreate, spDecode, spDigest,
  spEntityType, spEntityTypeAhead, spFind, spHttp, spItems, spListPath, spMade, spMerge, spMetadata, spPages, spReadOrBatch, spReadTogether, spRefs,
  spSite, spTitle, unfinishedScan, updateItem, updateItemIfUnchanged,
};
