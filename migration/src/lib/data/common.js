// What several parts of the data layer share (Phase 17: cut out of dataService.js sections 4, 5, 6 and 8 unchanged): an item from an
// AppId read, a write to an item a read has already found, a list address with equality filters, every page of a list read, and
// paced bulk work (runPaced). Built on core.js; keeps no state of its own.

import { ID } from '../schema/pms-schema.js';
import { columnsOf, pause, spEncode, spLiteral } from './encoding.js';
import { sharePoint, spDecode, spEntityType, spHttp, spItems, spListPath, spPages, spTitle } from './core.js';

/** The one item in an AppId query's payload as { item, etag, ref }, or null: what spFind() makes of the same read. */
function spOne(list, id, data) {
  const rows = data?.results ?? data?.value ?? [];
  if (rows.length > 1) throw new Error(`Duplicate ${ID} ${id} in ${spTitle(list)}.`);
  if (rows.length === 0) return null;
  const found = spDecode(list, rows[0]);
  return { item: found.item, etag: found.etag, ref: { id: found.numericId, type: found.type } };
}

/** A write to an item whose numeric id, type and (where it matters) version a read has already given. */
const spWrite = async (list, found, method, etag, changes) => spHttp('POST', `${spListPath(list)}/items(${found.ref.id})`, {
  idempotent: true,
  headers: { 'X-HTTP-Method': method, 'If-Match': etag },
  ...(changes ? { body: { __metadata: { type: found.ref.type ?? await spEntityType(list) }, ...spEncode(list, changes) } } : {}),
});

/** The address of a list read with equality filters, as spSend() builds it for a plain list GET (`top` items to a page). */
function spItemsAddress(list, where = {}, top = 200) {
  const columns = columnsOf(list);
  const clauses = Object.entries(where).map(([key, values]) => {
    if (!columns[key]) throw new Error(`Unsupported filter: ${key}`);
    return `(${[values].flat().map((value) => `${columns[key]} eq ${spLiteral(value)}`).join(' or ')})`;
  });
  return spItems(list, `$top=${top}${clauses.length ? `&$filter=${clauses.join(' and ')}` : ''}`);
}

const localFilter = (where = {}) => {
  const query = new URLSearchParams(Object.entries(where).flatMap(([key, values]) => [values].flat().map((value) => [key, String(value)]))).toString();
  return query ? `?${query}` : '';
};

/** @typedef {{ concurrency?: number, gapMs?: number | null, signal?: AbortSignal | null }} PaceOptions */
/** How many writes are in flight at once, and the pause between one lane's writes on SharePoint. */
const PACE = { concurrency: 3, sharePointGapMs: 120 };

/**
 * Runs `worker(item, index)` over `items`, `concurrency` at a time. A failure is recorded, not
 * thrown: the result for each item is `{ ok: true, value }`, `{ ok: false, error }`, or undefined
 * for an item that was never started (the run stopped first). The run stops starting new items
 * after `stopAfterFailures` failures in a row, or when `signal` is aborted; items already started
 * finish. On SharePoint each lane waits `gapMs` (default 120) between its items.
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<any> | any} worker
 * @param {PaceOptions & { stopAfterFailures?: number }} [settings]
 * @returns {Promise<{ results: ({ ok: true, value: any } | { ok: false, error: any } | undefined)[], stopped: 'failures' | 'aborted' | null }>}
 */
export async function runPaced(items, worker, { concurrency = PACE.concurrency, gapMs = null, stopAfterFailures = 3, signal = null } = {}) {
  const gap = gapMs ?? (sharePoint ? PACE.sharePointGapMs : 0);
  const results = Array.from({ length: items.length }, () => undefined); // not a sparse array: some() and find() must see the gaps
  let next = 0;
  let streak = 0;
  let stopped = null;
  const lane = async () => {
    while (next < items.length && !stopped) {
      if (signal?.aborted) { stopped = 'aborted'; return; }
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
        streak = 0;
      } catch (error) {
        results[index] = { ok: false, error };
        streak += 1;
        if (streak >= stopAfterFailures) stopped = 'failures';
      }
      if (gap && next < items.length) await pause(gap);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
  return { results, stopped };
}

/** The rows of a list read (its first page's payload), with any further pages read after it. */
async function spAllRows(payload) {
  const next = payload.__next ?? payload['@odata.nextLink'] ?? payload['odata.nextLink'];
  return [...(payload.results ?? payload.value ?? []), ...(next ? await spPages(next) : [])];
}

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export { PACE, localFilter, spAllRows, spItemsAddress, spOne, spWrite };
