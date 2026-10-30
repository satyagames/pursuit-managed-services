// Today's client (dataService.js section 3; Phase 17 cut it out unchanged): making a client today's (activateClient), what the
// participant page shows for it (getLiveExperience), an activity's questions, and the stamps of a visit (recordParticipantVisit,
// noteTrackResumed). Reads the settings item, sessions, activities and questions; writes sessions, the settings item and the visit
// log. Keeps nothing.

import { ID } from '../schema/pms-schema.js';
import { READ_CHUNK, chunked, indexById, pick, spEncode } from './encoding.js';
import {
  createItem, getItem, getItems, queryItems, request, sharePoint, spEntityType, spFind, spHttp, spListPath, spRefs, updateItem,
} from './core.js';
import { failure, getAppSettings, recordUserVisit, unscanned, updateAppSettings } from './records.js';
import { isCheckActivity } from '../participant/confidence-check.js';

// ============================================================================
// 3. Today's client and per-participant responses
// ============================================================================
// PMS-IMPLEMENTATION-PLAN.md 4.2 to 4.5 (in git history at 7347c72). Everything from here down was added for the Svelte pages, from Phase 4 on.

// ---- Today's client -----------------------------------------------------------

/** "Domino's" -> 'dominos'. A client's slug, and through it the id of each day's session. */
export const slugify = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** A client's activities in order, enabled or not. One query on the indexed ClientId. */
export const listClientSections = async (clientId) => (await queryItems('sections', { clientId })).sort(byOrder);

/** The id of a client's session for a day: `<slug>-<yyyy-mm-dd>`. The same for every admin, so it can't be created twice. */
export const sessionIdFor = (client, date) => `${slugify(client.slug) || slugify(client.name) || slugify(client.id)}-${date}`;

/**
 * Admin "Go live": makes `clientId` today's client. Finds that client's session for `dateString`
 * (YYYY-MM-DD) or creates it, then points AppSettings at it. The session's id is derived from the
 * client's slug and the date, and AppId is unique, so two admins pressing the button together end
 * up with the same single session. Resolves to { session, client, settings }.
 */
export async function activateClient(clientId, dateString) {
  const date = String(dateString ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw failure('date-invalid', 'Give the date as YYYY-MM-DD.');
  }
  // Read first: it is what was live before, and on lists of another version it stops here, before anything is written.
  const before = await getAppSettings();
  const client = await getItem('clients', clientId);
  if (!client) throw failure('client-missing', 'That client no longer exists.');
  if (client.status === 'archived') throw failure('client-archived', `${client.name} is archived. Restore it before going live.`);
  const sessionId = sessionIdFor(client, date);
  const owned = await listClientSections(clientId);
  const sectionIds = owned.map((section) => section.id);
  let session = await getItem('sessions', sessionId);
  if (!session) {
    try {
      // (Phase 20: a new session asks the confidence check when its client has one with a question; the facilitator can switch it off.)
      session = await createItem('sessions', {
        id: sessionId, clientId, date, sectionIds, activeSectionId: null, status: 'not-started', endedAt: null,
        participationMode: 'staff', activityFlow: 'sequential', confidenceCheck: owned.some((section) => isCheckActivity(section) && (section.questionIds ?? []).length > 0),
      });
    } catch (error) {
      if (error.status !== 409) throw error;
      session = await getItem('sessions', sessionId); // another admin created it in the same moment
      if (!session) throw error;
    }
  }
  if (session.clientId !== clientId) {
    throw failure('client-session-mismatch', `The session ${sessionId} belongs to a different client. Give ${client.name} its own slug.`);
  }
  if (session.status === 'completed') {
    throw failure('session-ended', `${client.name}'s session for ${date} has ended. Reopen it before going live.`);
  }
  // Results are tallied over session.sectionIds, so an activity added since the session was made joins it.
  const added = sectionIds.filter((id) => !(session.sectionIds ?? []).includes(id));
  if (added.length) session = await updateItem('sessions', sessionId, { sectionIds: [...(session.sectionIds ?? []), ...added] });
  if (before?.activeSessionId && before.activeSessionId !== sessionId) {
    // Codes nobody scanned for the session being replaced stop working.
    const stale = unscanned(await queryItems('qrtokens', { sessionId: before.activeSessionId }));
    const expiredAt = new Date().toISOString();
    await Promise.all(stale.map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt })));
  }
  const settings = await updateAppSettings({ activeSessionId: sessionId, activeClientId: clientId, activatedAt: new Date().toISOString() });
  return { session, client, settings };
}

/**
 * The activities a participant sees are the client's own (Sections.ClientId), in order. `owned` is that read. Every activity belongs
 * to a client: one that names none is shown to nobody. (Until Phase 10c-2a such an activity followed the session that listed it.)
 */
const inOrder = (owned) => [...owned].sort(byOrder);

/**
 * What a participant page needs to show today's experience, in as few requests as it can be done:
 * AppSettings first (pass it in if it was read already), then the Client, the Session and the
 * client's Sections side by side. Four requests.
 *   { status: 'live', settings, client, session, sections }
 *   { status: 'not-live' | 'archived', reason, settings, client: null, session: null, sections: [] }
 * `reason` is 'no-session', 'session-missing', 'session-ended', 'client-missing' or 'client-archived'.
 */
export async function getLiveExperience(knownSettings) {
  const settings = knownSettings === undefined ? await getAppSettings() : knownSettings;
  if (!settings?.activeSessionId) return liveExperienceOf(settings, null, null, []);
  // Go live writes the client beside the session. With no client named nothing is live (the session is still read, to say whether it
  // is missing or has ended): the client is never looked for through the session.
  if (!settings.activeClientId) return liveExperienceOf(settings, null, await getItem('sessions', settings.activeSessionId), []);
  const [client, session, owned] = await Promise.all([
    getItem('clients', settings.activeClientId),
    getItem('sessions', settings.activeSessionId),
    queryItems('sections', { clientId: settings.activeClientId }),
  ]);
  return liveExperienceOf(settings, client, session, owned);
}

/** getLiveExperience()'s answer for records that are already in hand: the active session, its client, and that client's activities. */
async function liveExperienceOf(settings, client, session, owned) {
  const off = (reason) => ({
    status: reason === 'client-archived' ? 'archived' : 'not-live', reason, settings: settings ?? null, client: null, session: null, sections: [],
  });
  if (!settings?.activeSessionId) return off('no-session');
  if (!session) return off('session-missing');
  if (session.status === 'completed') return off('session-ended');
  if (!client || session.clientId !== client.id) return off('client-missing');
  if (client.status === 'archived') return off('client-archived');
  return { status: 'live', reason: null, settings, client, session, sections: inOrder(owned) };
}

/** The hub's fuller refresh: the session (its flow and status) and the client's activities, side by side. Resolves to { session, sections }. */
export async function getSessionActivities(sessionId, clientId) {
  const [session, owned] = await Promise.all([getItem('sessions', sessionId), queryItems('sections', { clientId })]);
  return { session, sections: session ? inOrder(owned) : [] };
}

/** The hub's usual refresh: the client's activities alone, for a caller that already holds the session record. One request. */
export const getClientActivities = (clientId) => listClientSections(clientId);

/**
 * recordUserVisit() for the participant page, which sends it once the screen is up. The row and
 * the "already logged" rule are the same; what differs is that the list's columns are not all
 * read and checked first, which recordUserVisit() does through the general create path.
 */
export async function recordParticipantVisit(fields) {
  if (!sharePoint) return recordUserVisit(fields);
  const { visitKey, ...record } = fields;
  const id = fields.id ?? visitKey;
  if (!id) throw new Error('A stable visit id is required.');
  try {
    const type = await spEntityType('uservisitlogs');
    await spHttp('POST', `${spListPath('uservisitlogs')}/items`, {
      body: { __metadata: { type }, Title: id, ...spEncode('uservisitlogs', { ...record, id }), [ID]: id },
    });
  } catch (error) {
    if (error.status !== 409) throw error; // this tab's row is there already
  }
  return { ...record, id };
}

/**
 * The questions of an activity whose section record the caller already holds, each with its
 * options in order. Two requests, side by side (getSectionContent() takes three, one after another).
 * An activity of more than 20 questions is read in groups of 20 (Phase 9b), each group again as two
 * reads side by side, so that no address grows with the activity: with 30 questions the one read that
 * asked for them all had an address of about 2,000 characters. Up to 20 questions it is exactly the two
 * requests it always was (the boot budget counts them). getSectionContent() is the older reader, and is untouched.
 */
export async function getSectionQuestions(section) {
  const ids = section?.questionIds ?? [];
  if (ids.length === 0) return [];
  const groups = chunked([...new Set(ids.map(String))], READ_CHUNK);
  const read = await Promise.all(groups.flatMap((group) => [
    getItems('questions', group),
    request('GET', `/options?${new URLSearchParams(group.map((id) => ['questionId', id]))}`),
  ]));
  const questions = indexById(read.filter((_rows, at) => at % 2 === 0).flat());
  const index = indexById(read.filter((_rows, at) => at % 2 === 1).flat());
  return pick(questions, ids).map((question) => ({ ...question, options: pick(index, question.optionIds) }));
}

/**
 * Notes that a participant came back to their visit (resumeCount, lastResumedAt), given the track
 * record a read returned. It checks nothing and is meant to be sent after the page is up:
 * resumeClientTrack() does the same stamp, but only after three reads of its own.
 */
export async function noteTrackResumed(track) {
  const changes = { lastResumedAt: new Date().toISOString(), resumeCount: (track.resumeCount ?? 0) + 1 };
  if (!sharePoint) return updateItem('tracks', track.id, changes);
  let ref = spRefs.get(track);
  if (!ref?.type) {
    const found = await spFind('tracks', track.id);
    if (!found) return null;
    ref = { id: found.numericId, type: found.type ?? await spEntityType('tracks') };
  }
  await spHttp('POST', `${spListPath('tracks')}/items(${ref.id})`, {
    idempotent: true,
    headers: { 'X-HTTP-Method': 'MERGE', 'If-Match': '*' },
    body: { __metadata: { type: ref.type }, ...spEncode('tracks', changes) },
  });
  return { ...track, ...changes };
}

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export { inOrder, liveExperienceOf };
