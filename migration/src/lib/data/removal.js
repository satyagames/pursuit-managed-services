// Removing a visit that has no answers, and deleting by key (dataService.js section 9; Phase 17 cut it out unchanged): removeEmptyVisit
// for Results, and the two generic calls of Delete session (listItemKeys, deleteByKey), whose rules are lib/admin/session-delete.js's.
// Deletes items; keeps nothing.

import { ID } from '../schema/pms-schema.js';
import { deleteItem, getItem, itemPath, request, sharePoint, spHttp, spListPath, spPages, spTitle } from './core.js';
import { localFilter, spItemsAddress } from './common.js';
import { failure } from './records.js';
import { answerRecords, participants } from './responses.js';

// ============================================================================
// 9. Removing a visit that has no answers (Phase 9b, DI-9)
// ============================================================================
// Added for Phase 9b (Admin → Results, through migration/src/lib/admin/adminData.ts). No new SharePoint column. A visit nobody uses stayed in
// Results and the report for ever (a guest whose first scan was cut off,
// a visit made while testing): this takes it away, and only it. (deleteClientTrack(), which also unlinked the QR code and no page called, left in Phase 10c-2b.)

/**
 * Removes a visit that has no answers: its Tracks item and, when it exists and is empty, its own Responses item. Resolves to
 * { removed: true, leftovers } (`leftovers` is 1 when the empty answer item could not be removed after the visit was: harmless, it counts for nobody).
 *
 * It first READS the visit's answers again, in the item of its own, and refuses (code 'visit-has-answers') if there is any, so an
 * answer that arrived after the screen was drawn is never lost. It refuses on a session that has ended
 * ('session-ended': a past report must not change silently), on a visit whose saved answers cannot be read ('visit-unreadable') and on a visit that
 * is already gone ('visit-missing'). It never touches a QR code (which stays used: a guest who needs to start again is given a replacement code)
 * or the guest roster.
 * @param {string} trackId
 */
export async function removeEmptyVisit(trackId) {
  const track = await getItem('tracks', trackId);
  if (!track) throw failure('visit-missing', 'That visit is already gone.');
  const session = await getItem('sessions', track.sessionId);
  if (session?.status === 'completed') throw failure('session-ended', 'This session has ended, so its visits are not changed.');
  const unreadable = () => failure('visit-unreadable', `This visit's saved answers cannot be read, so it was not removed. Correct or delete the damaged item in the ${spTitle('responses')} list first.`);
  const store = participants();
  let own;
  try {
    [own] = await store.findAll(trackId);
    if (own && !Array.isArray(own.item.responses ?? [])) throw unreadable(); // (the local server holds the value as it was written)
  } catch (error) {
    if (error.code === 'responses-unreadable') throw unreadable();
    throw error;
  }
  if (own && answerRecords(own.item.responses).length > 0) throw failure('visit-has-answers', 'This visit now has answers, so it was not removed.');
  await deleteItem('tracks', trackId); // the visit first, so the participant page sees it gone at once
  let leftovers = 0;
  if (own) {
    try { await store.remove(own.ref); } catch (error) { if (error.status !== 404) leftovers = 1; }
  }
  return { removed: true, leftovers };
}

/**
 * Admin (Phase 16, lib/admin/session-delete.js, which holds the rules): the items of `list` that readLists() would find with `where`, as
 * [{ id, key }]: `id` is the item's AppId and `key` what deleteByKey() takes. The answers list too, and an item whose saved answers cannot be
 * read: nothing of an item is decoded.
 */
export async function listItemKeys(list, where) {
  if (!sharePoint) return (await request('GET', `/${localName(list)}${localFilter(where)}`)).map((item) => ({ id: String(item.id), key: item.id }));
  return (await spPages(spItemsAddress(list, where))).map((row) => ({ id: String(row[ID]), key: row.Id }));
}

/** Admin (Phase 16): deletes an item listItemKeys() found, in one request. An item that is already gone counts as deleted. */
export async function deleteByKey(list, key) {
  try {
    await (sharePoint
      ? spHttp('POST', `${spListPath(list)}/items(${key})`, { headers: { 'X-HTTP-Method': 'DELETE', 'If-Match': '*' } })
      : request('DELETE', itemPath(localName(list), key)));
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}
/** The local server keeps the answers in participantresponses (server/api.js). */
const localName = (list) => (list === 'responses' ? 'participantresponses' : list);
