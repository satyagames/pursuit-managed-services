// The admin's Today and Clients screens (dataService.js section 5; Phase 17 cut it out unchanged): several list reads in one request
// (readLists, which the content and guest parts use too) and making a session the live one (activateSession). Reads any list by
// equality filters; writes sessions and the settings item.

import { LISTS } from '../schema/pms-schema.js';
import { currentAccessGuard, getItem, queryItems, request, sharePoint, spDecode, spPages, spReadTogether, updateItem } from './core.js';
import { localFilter, spItemsAddress } from './common.js';
import { failure, getAppSettings, notMade, unscanned, updateAppSettings, versionFirst, versioned } from './records.js';

// ============================================================================
// 5. The admin's Today and Clients screens
// ============================================================================
// Added for Phase 5 (migration/src/admin/AdminToday.svelte and AdminClients.svelte, through
// migration/src/lib/admin/admin-today.js and admin-clients.js). No new SharePoint column is used: every figure the screens
// show (participants, live since, last live date, activity counts) is derived from what exists.

/**
 * Several list reads, answered together. `queries` is [{ list, where? }], where `where` holds the
 * same equality filters queryItems() takes: a value matches itself, an array matches any of its
 * values (readLists([{ list: 'tracks', where: { sessionId: 's1' } }, { list: 'clients' }])).
 * Resolves to one array of records per query, in order. A filter with no values matches nothing and
 * sends nothing.
 *
 * On SharePoint the reads travel as ONE $batch request (reads only; the same envelope as a QR
 * scan's), and one by one, as plain reads, where the site cannot batch: it may cost requests, never
 * a failed screen. Locally they are plain reads side by side. The Responses list is not offered:
 * a participant's answers have readers of their own.
 */
export async function readLists(queries) {
  const wanted = queries.map(({ list, where = {} }) => {
    if (!LISTS[list] || list === 'responses') throw new Error(`Unsupported list: ${list}`);
    return { list, where, none: Object.values(where).some((values) => [values].flat().length === 0) };
  });
  const sent = wanted.filter((query) => !query.none);
  const guard = currentAccessGuard(); // (Phase 4: a scoped role may name only the places it holds, and the guard learns whose they are)
  for (const { list, where } of sent) guard?.read?.(list, where);
  let answers;
  if (!sharePoint) {
    answers = await Promise.all(sent.map(({ list, where }) => request('GET', `/${list}${localFilter(where)}`)));
  } else {
    const addresses = sent.map(({ list, where }) => spItemsAddress(list, where));
    const together = await spReadTogether(addresses);
    answers = await Promise.all(sent.map(async ({ list }, position) => {
      const first = together[position];
      let rows;
      if (first) {
        const next = first.__next ?? first['@odata.nextLink'] ?? first['odata.nextLink'];
        rows = [...(first.results ?? first.value ?? []), ...(next ? await spPages(next) : [])];
      } else {
        rows = await spPages(addresses[position]).catch(list === 'appsettings' ? notMade : (error) => { throw error; });
      }
      return rows.map((row) => spDecode(list, row).item);
    })).catch(sent.some(({ list }) => list === 'appsettings') ? versionFirst : (error) => { throw error; });
    // (Phase 20: a read refused for a column an older site lacks says the version's stop first, as before the column existed.)
    // The lists' version comes with the AppSettings item: a read of it checks it (above).
    sent.forEach(({ list }, at) => { if (list === 'appsettings') versioned(answers[at].find((row) => row.id === 'default') ?? null); });
  }
  sent.forEach(({ list }, at) => guard?.learn?.(list, answers[at]));
  let position = 0;
  return wanted.map((query) => (query.none ? [] : answers[position++]));
}

/**
 * Admin: makes a session that already exists today's, whatever its id (a session made before ids
 * were `<slug>-<date>`, for one). activateClient() is the way to go live with a client and a date;
 * this is for the sessions it would not find. Points AppSettings at the session AND its client, and
 * retires the codes nobody scanned for the session it replaces, as activateClient() does.
 * Resolves to { session, client, settings }.
 */
export async function activateSession(sessionId) {
  const before = await getAppSettings(); // (first: on lists of another version nothing is done)
  const session = await getItem('sessions', sessionId);
  if (!session) throw failure('session-missing', 'That session no longer exists.');
  const client = await getItem('clients', session.clientId);
  if (!client) throw failure('client-missing', 'That session\'s client no longer exists.');
  if (client.status === 'archived') throw failure('client-archived', `${client.name} is archived. Restore it before going live.`);
  if (session.status === 'completed') throw failure('session-ended', `That session has ended. Reopen it before going live.`);
  if (before?.activeSessionId && before.activeSessionId !== session.id) {
    const stale = unscanned(await queryItems('qrtokens', { sessionId: before.activeSessionId }));
    const expiredAt = new Date().toISOString();
    await Promise.all(stale.map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt })));
  }
  const settings = await updateAppSettings({ activeSessionId: session.id, activeClientId: client.id, activatedAt: new Date().toISOString() });
  return { session, client, settings };
}
