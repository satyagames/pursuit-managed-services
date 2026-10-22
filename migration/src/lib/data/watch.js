// What a page that stays open reads on a timer (dataService.js section 8; Phase 17 cut it out unchanged): the participant page's one
// look (readParticipantWatch) and the Live display's feed (readLiveFeed), each one request where the site can batch, saying what it
// cost. Read-only; a busy answer is thrown for the caller's timer to back off.

import { READ_CHUNK, RESPONSE, chunked, indexById, pick, spLiteral } from './encoding.js';
import { getItem, getItems, queryItems, sharePoint, spByAppId, spDecode, spListPath, spReadOrBatch } from './core.js';
import { spAllRows, spItemsAddress, spOne } from './common.js';
import { getAppSettings, notMade, versioned } from './records.js';
import { inOrder } from './today.js';
import { PARTICIPANT_SELECT, combineAnswers, decodeResponsesRow, readAnswers, spParticipants } from './responses.js';

// ============================================================================
// 8. Pages that stay open: what a timer reads, in one request
// ============================================================================
// Added for Phase 7 (migration/src/lib/common/page-watch.ts, App.svelte's check, and the facilitator's Live display).
// (readSessionResponses had its merge step moved into combineAnswers, which this section shares.) No new SharePoint column
// is used. A page that stays open reads on a timer, so what it reads is what it costs: each function sends ONE
// request where the site can batch (a $batch of reads, the same envelope as a QR scan's) and says how many
// requests it used, so its caller can wait longer where a site cannot batch (three reads are three requests).
// A busy answer (429, 503, 504) is not retried here and is not turned into plain reads: it throws, with
// `retryAfter` when SharePoint gave one, so the caller's timer can back off for as long as it was asked.

/**
 * What an open participant page checks on its timer: AppSettings (did the facilitator change what is
 * live?), the session (has it ended? did its flow change?), the page's own track (was it restarted?) and,
 * for the hub, the client's activities. One request on SharePoint, however many of them are asked for.
 *
 *   readParticipantWatch({ sessionId, trackId, clientId })
 *   -> { settings, session, track, sections, requests }
 *
 * Leave out what the page has no use for: with no `sessionId` there is no session read, with no `trackId`
 * no track, and `sections` is null unless a `clientId` is given. A record that does not exist reads as null.
 * `sections` are the client's activities as getSessionActivities() gives them (enabled or not, in order).
 * @param {{ sessionId?: string | null, trackId?: string | null, clientId?: string | null }} [options]
 */
export async function readParticipantWatch({ sessionId = null, trackId = null, clientId = null } = {}) {
  if (!sharePoint) {
    const [settings, session, track, owned] = await Promise.all([
      getAppSettings(),
      sessionId ? getItem('sessions', sessionId) : null,
      trackId ? getItem('tracks', trackId) : null,
      clientId ? queryItems('sections', { clientId }) : null,
    ]);
    return { settings, session, track, sections: owned ? inOrder(owned) : null, requests: 1 + [sessionId, trackId, clientId].filter(Boolean).length };
  }
  const { data, requests } = await spReadOrBatch({
    settings: spByAppId('appsettings', 'default'),
    ...(sessionId ? { session: spByAppId('sessions', sessionId) } : {}),
    ...(trackId ? { track: spByAppId('tracks', trackId) } : {}),
    ...(clientId ? { owned: spItemsAddress('sections', { clientId }) } : {}),
  }).catch(notMade);
  const session = sessionId ? spOne('sessions', sessionId, data.session)?.item ?? null : null;
  const owned = clientId ? (await spAllRows(data.owned)).map((row) => spDecode('sections', row).item) : null;
  return {
    settings: versioned(spOne('appsettings', 'default', data.settings)?.item ?? null),
    session,
    track: trackId ? spOne('tracks', trackId, data.track)?.item ?? null : null,
    sections: owned ? inOrder(owned) : null,
    requests,
  };
}

/**
 * What the facilitator's Live display refreshes on its timer: the session record (so an activity added to the live
 * session shows up), its tracks, every answer (the records readSessionResponses() gives, in the same shape) and,
 * when `sectionIds` is given, those activities' own records (so a switch of
 * an activity on or off, or a question added to it, shows up). One request on SharePoint.
 *
 *   readLiveFeed(sessionId, { sectionIds })  ->  { session, tracks, answers, sections, requests }
 *
 * `session` is null when the session no longer exists. `sections` are in the order of `sectionIds` (null when none were
 * asked for). The questions and options are not read here: they change rarely, and readActivityContent() reads them
 * when they must be.
 */
export async function readLiveFeed(sessionId, { sectionIds = [], tolerant = false } = {}) {
  // `tolerant` (Phase 9b, DI-6): an answer item that is not a list is left out and named in `unreadable`, where it used to stop the feed.
  const damaged = tolerant ? [] : null;
  if (!sharePoint) {
    const [session, tracks, answers, sections] = await Promise.all([
      getItem('sessions', sessionId), queryItems('tracks', { sessionId }), readAnswers(sessionId, damaged), sectionIds.length ? getItems('sections', sectionIds) : null,
    ]);
    return { session, tracks, answers, sections, unreadable: damaged ?? [], requests: 4 };
  }
  const { data, requests } = await spReadOrBatch({
    session: spByAppId('sessions', sessionId),
    tracks: spItemsAddress('tracks', { sessionId }),
    responses: `${spListPath('responses')}/items?$filter=${RESPONSE.sessionId} eq ${spLiteral(sessionId)}&${PARTICIPANT_SELECT}&$top=200`,
    // The activities, in groups of 20 ids to an address (Phase 9b): the feed is one batch whatever the session holds.
    ...Object.fromEntries(chunked(sectionIds, READ_CHUNK).map((group, at) => [`sections${at}`, spItemsAddress('sections', { id: group })])),
  });
  const rows = data.responses.results ?? data.responses.value ?? [];
  const items = rows.filter((row) => row[RESPONSE.trackId]).flatMap((row) => {
    const found = decodeResponsesRow(row, damaged);
    return found ? [{ ...found.item, trackId: row[RESPONSE.trackId] }] : [];
  });
  // A session with more than one page of participants reads the rest one page at a time, as readSessionResponses() does.
  let cursor = data.responses.__next ?? data.responses['@odata.nextLink'] ?? data.responses['odata.nextLink'] ?? null;
  let more = 0;
  while (cursor) {
    const page = await spParticipants.page(sessionId, 200, cursor, damaged);
    items.push(...page.items);
    cursor = page.next;
    more += 1;
  }
  const sectionGroups = chunked(sectionIds, READ_CHUNK).map((_group, at) => data[`sections${at}`]);
  const sections = sectionIds.length ? pick(indexById((await Promise.all(sectionGroups.map(spAllRows))).flat().map((row) => spDecode('sections', row).item)), sectionIds) : null;
  return {
    session: spOne('sessions', sessionId, data.session)?.item ?? null,
    tracks: (await spAllRows(data.tracks)).map((row) => spDecode('tracks', row).item),
    answers: combineAnswers(items),
    sections,
    unreadable: damaged ?? [],
    requests: requests + more,
  };
}
