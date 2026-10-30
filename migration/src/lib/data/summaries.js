// Section 15 (Prompt 21, Phase 5): the sessions' summaries, PMSSessionSummary, one item for each session keyed by its id. saveSessionSummary() writes one
// (when a session ends, and by the dashboard's Rebuild), making it the first time and writing it again after: a summary is the session's totals as they are
// now, never added up. readSessionSummaries() is the Leadership dashboard's one read: every summary for a role that holds every client, else those of the
// clients, sessions or fiscal periods it holds, fifteen to an address (the read check of core.js holds a scoped role to them). The rules are
// lib/results/session-summary.js's and lib/results/index-math.js's, which only the admin page imports: every page carries this part, so it holds the
// requests alone. Built on the generic calls of core.js and today-clients.js's readLists; keeps nothing.

import { createItem, updateItem } from './core.js';
import { readLists } from './today-clients.js';

/** How many places go to one address (lib/access/scope.js PLACES_PER_READ: room for a session id of 58 characters). */
const PER_READ = 15;
const groups = (values) => Array.from({ length: Math.ceil(values.length / PER_READ) }, (_unused, at) => values.slice(at * PER_READ, (at + 1) * PER_READ));

/**
 * Writes a session's summary (lib/results/session-summary.js summaryRecord): made the first time; written over when SharePoint answers that the id is
 * taken (a duplicate is 409). Resolves to the summary as written.
 * @param {{ id: string, [key: string]: unknown }} record
 */
export async function saveSessionSummary(record) {
  try {
    return await createItem('sessionsummary', record);
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error)?.status !== 409) throw error;
    const { id, ...fields } = record;
    return updateItem('sessionsummary', id, fields);
  }
}

/**
 * The summaries a dashboard may read. Nothing named: every summary (a role that holds every client). Else those of `clientIds`, of `sessionIds` and of
 * `periods` (FY27-Q2), each fifteen to an address; a summary named twice comes back once.
 * @param {{ clientIds?: string[], sessionIds?: string[], periods?: string[] }} [places]
 */
export async function readSessionSummaries({ clientIds, sessionIds, periods } = {}) {
  if (!clientIds && !sessionIds && !periods) return (await readLists([{ list: 'sessionsummary' }]))[0];
  const queries = [
    ...groups([...new Set(clientIds ?? [])]).map((group) => ({ list: 'sessionsummary', where: { clientId: group } })),
    ...groups([...new Set(sessionIds ?? [])]).map((group) => ({ list: 'sessionsummary', where: { id: group } })),
    ...groups([...new Set(periods ?? [])]).map((group) => ({ list: 'sessionsummary', where: { period: group } })),
  ];
  if (!queries.length) return [];
  const seen = new Map();
  for (const row of (await readLists(queries)).flat()) seen.set(row.id, row);
  return [...seen.values()];
}
