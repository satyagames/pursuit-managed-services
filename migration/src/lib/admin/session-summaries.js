// The sessions' summaries on the admin page (Prompt 21, Phase 5): which a person may read (placesOf: every one for a role on every client, else those of the
// clients, sessions and fiscal quarters they hold), the Leadership dashboard's read (the summaries and the clients' names and tags, side by side: never an
// answer), and a summary written (when a session ends, and by the dashboard's Rebuild for older sessions). Only the admin page imports it. The requests are
// the data layer's (lib/data/summaries.js); the numbers are lib/results/session-summary.js's from the leader report's model.

import * as dataService from '../data/dataService.js';
import { readLeaderReportRecords } from '../exports/leader-report-data.js';
import { buildLeaderReport } from '../exports/leader-report.js';
import { inPeriod, readQueries, reachOf } from '../access/scope.js';
import { periodsBetween } from '../results/index-math.js';
import { summaryFromItem, summaryOf, summaryRecord } from '../results/session-summary.js';

/**
 * The places a person's summaries are read by: undefined for a role on every client (every summary), else the clients they hold whole, the sessions they
 * hold one by one, and the fiscal quarters their Leadership periods touch.
 * @param {ReturnType<typeof reachOf>} reach @param {number} startMonth
 */
export function placesOf(reach, startMonth) {
  if (reach.all) return undefined;
  return {
    clientIds: [...reach.clientIds], sessionIds: [...reach.sessionIds],
    periods: [...new Set(reach.periods.flatMap((period) => periodsBetween(period.from, period.to, startMonth)))],
  };
}

/**
 * The summaries a person may read, as the dashboard reads them (`summary` from SummaryJson). Of a period's quarters, only the days inside the period.
 * @param {any} access null before there were roles: every summary @param {{ startMonth: number, now?: Date }} options
 */
export async function readSummaries(access, { startMonth, now }) {
  const reach = access ? reachOf(access, { now }) : null;
  const rows = await dataService.readSessionSummaries(reach ? placesOf(reach, startMonth) : undefined);
  const kept = !reach || reach.all ? rows : rows.filter((row) => reach.clientIds.has(row.clientId) || reach.sessionIds.has(row.id) || inPeriod(reach, row.sessionDate));
  return kept.map(summaryFromItem);
}

/**
 * The dashboard's read: the summaries and the clients (names and tags), side by side. A period's Leadership reads the clients whole (names only, as Results
 * always has: lib/access/scope.js readQueries).
 * @param {any} access @param {{ startMonth: number, now?: Date }} options
 */
export async function readDashboard(access, options) {
  const reach = access ? reachOf(access, { now: options.now }) : null;
  const clientReads = reach ? readQueries(reach, 'clients') : [{ list: 'clients' }];
  const [summaries, clients] = await Promise.all([
    readSummaries(access, options),
    clientReads.length ? dataService.readLists(clientReads).then((answers) => answers.flat()) : Promise.resolve([]),
  ]);
  return { summaries, clients };
}

/**
 * Writes one session's summary from its records as they are now (the leader report's reads), and resolves to it. Null when the session no longer exists.
 * @param {string} sessionId @param {{ writtenBy?: string, startMonth?: number, at?: Date }} [options]
 */
export async function writeSummary(sessionId, { writtenBy = '', startMonth, at = new Date() } = {}) {
  const records = await readLeaderReportRecords(sessionId);
  if (!records) return null;
  const made = summaryOf(records, buildLeaderReport(records, { generatedAt: at }), { writtenBy, at, startMonth });
  await dataService.saveSessionSummary(summaryRecord(made));
  return made;
}

/**
 * Rebuild: the summaries of the sessions named, one after another (each costs the leader report's reads of that session and one write). Says how far it has
 * got; a session that fails is counted and the rest carry on.
 * @param {string[]} sessionIds @param {{ writtenBy?: string, startMonth?: number, onProgress?: (done: number, of: number) => void }} [options]
 * @returns {Promise<{ written: number, failed: string[] }>}
 */
export async function rebuildSummaries(sessionIds, { writtenBy = '', startMonth, onProgress } = {}) {
  let written = 0;
  const failed = [];
  for (const [at, id] of sessionIds.entries()) {
    try {
      if (await writeSummary(id, { writtenBy, startMonth })) written += 1;
    } catch {
      failed.push(id);
    }
    onProgress?.(at + 1, sessionIds.length);
  }
  return { written, failed };
}
