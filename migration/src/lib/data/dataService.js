/**
 * dataService.js: the ONLY module that talks to the backend. (One exception: migration/src/lib/settings/settings-file.js reads the page's
 * settings file, which has to happen before this module knows where to look.)
 *
 * Since Phase 10c-1 it belongs to the pages in migration/ alone. Until then the legacy pages were built from this same file, so it
 * was only ever allowed to grow; they left the branch (the tag legacy-final holds them), that rule went with them, and so did the
 * exports that only they, or nothing, called. All of this file is carried by the participant page, so whatever is added here is paid
 * for there: logic that only the admin or Setup needs belongs in a module under migration/src/lib that is handed this one
 * (lib/admin/admin-today.js is the pattern).
 *
 * Screens import the functions exported below and never call fetch() themselves. The parts:
 *
 *    1. Backend adapter: the local Express server, or same-origin SharePoint REST using the browser's own SharePoint sign-in.
 *    2. Public API, the records: clients, sessions, activities, questions, options, visits, QR codes, the roster and admin
 *       users. Built only on the adapter.
 *    3. Today's client, and answers kept one item per participant.
 *    4. A first QR scan in few requests, and a visit begun from Welcome.
 *    5. The admin's Today and Clients screens.
 *    6. Content per client, copying activities, and guests in bulk.
 *    7. Pictures for a client's look.
 *    8. What a page that stays open reads on a timer.
 *    9. Removing a visit that has no answers.
 *   10. Which lists are this copy's.
 *
 * Contract of the public API:
 *   - Records are plain objects with a string `id`, never raw backend payloads.
 *   - get*(id) resolves to null when the record doesn't exist; other failures throw.
 *   - Records reference each other by ID only; joins happen here, at read time.
 *
 * Phase 10c-2a took out the last seven exports that no page called (joinSession, claimQrToken, saveResponse, getSessionResponses,
 * getSessionResults, listVisitorRoster, listUserVisitLogs): the tests that had used them as set-up or as a reference now use the calls
 * the pages use, and expected values written out (DROPS-10C2A.md, in git history at 7347c72).
 */

import { ID, LISTS } from '../schema/pms-schema.js';
import { READ_CHUNK, RESPONSE, chunked, distinct, indexById, pause, pick, spEncode, spLibraryIn, spLiteral, spTitleIn } from './encoding.js';
import {
  createItem, deleteItem, getItem, getItemWithVersion, getItems, holdScan, isUnreachable, itemPath, listTypes, logoFolders, queryItems, request,
  requestTotal, send, sharePoint, spBatch, spByAppId, spDecode, spDigest, spEntityType, spEntityTypeAhead, spFind, spHttp, spItems, spListPath,
  spMade, spMerge, spMetadata, spPages, spReadOrBatch, spReadTogether, spRefs, spSite, spTitle, unfinishedScan, updateItem, updateItemIfUnchanged,
} from './core.js';
import { PACE, localFilter, runPaced, spAllRows, spItemsAddress, spOne, spWrite } from './common.js';
import { failure, getAppSettings, getCurrentUser, notMade, recordUserVisit, unscanned, updateAppSettings, versioned } from './records.js';

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
  const sectionIds = (await listClientSections(clientId)).map((section) => section.id);
  let session = await getItem('sessions', sessionId);
  if (!session) {
    try {
      session = await createItem('sessions', {
        id: sessionId, clientId, date, sectionIds, activeSectionId: null, status: 'not-started', endedAt: null,
        participationMode: 'staff', activityFlow: 'sequential',
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

// ---- Responses, one item per participant ------------------------------------------
// The item's AppId is the participant's track id (unique), TrackId repeats it in an indexed column,
// and ResponsesJson is an array of { questionId, answer, firstAnswer, attempts, correct, answeredAt }.
// Only the participant's own device writes it, so after the first save every save is one request:
// no read first, and nothing to collide with. These items are the only answers there are: the session's shared item (AppId = the
// session's id, no TrackId) was the legacy pages', and since Phase 10c-2a nothing writes, reads or clears one. An item of the
// Responses list that has no TrackId is not a participant's and is not read.

/** The longest text answer that is stored. Longer ones are refused, not cut, so nothing is lost silently. */
export const MAX_ANSWER_TEXT = 1000;
/** spEncode's ceiling for one text column. A SharePoint multi-line plain-text column holds 63,999 characters. */
export const MAX_RESPONSES_JSON = 60_000;

const answerRecord = (record) => ({
  questionId: String(record.questionId),
  answer: record.answer,
  firstAnswer: record.firstAnswer === undefined ? record.answer : record.firstAnswer,
  attempts: Number.isInteger(record.attempts) && record.attempts > 0 ? record.attempts : 1,
  correct: record.correct === true ? true : record.correct === false ? false : null,
  answeredAt: typeof record.answeredAt === 'string' ? record.answeredAt : null,
});

/** Stored records as the six known fields; anything that is not an answer to a question is dropped. */
const answerRecords = (stored) => (Array.isArray(stored) ? stored : [])
  .filter((record) => record && typeof record.questionId === 'string' && record.answer !== undefined)
  .map(answerRecord);

/**
 * Lays `incoming` answers over `existing` ones, one record per question. The later answer wins,
 * except for what the first try was: once a first answer is stored it is never rewritten, so
 * neither a reload nor a second device can turn a wrong first try into a right one.
 */
export function mergeAnswerRecords(existing, incoming) {
  const merged = new Map(answerRecords(existing).map((record) => [record.questionId, record]));
  for (const record of answerRecords(incoming)) {
    const earlier = merged.get(record.questionId);
    if (!earlier) { merged.set(record.questionId, record); continue; }
    const newer = (record.answeredAt ?? '') >= (earlier.answeredAt ?? '') ? record : earlier;
    merged.set(record.questionId, {
      ...newer, firstAnswer: earlier.firstAnswer, correct: earlier.correct, attempts: Math.max(earlier.attempts, record.attempts),
    });
  }
  return [...merged.values()];
}

function participantFields({ trackId, sessionId, clientId = null, responses }) {
  if (typeof trackId !== 'string' || !trackId || typeof sessionId !== 'string' || !sessionId) {
    throw new Error('A participant save needs its track and its session.');
  }
  const records = new Map();
  for (const entry of Array.isArray(responses) ? responses : []) {
    if (!entry || typeof entry.questionId !== 'string' || entry.answer === undefined) throw new Error('Each answer needs a questionId and an answer.');
    const record = answerRecord({ ...entry, answeredAt: entry.answeredAt ?? new Date().toISOString() });
    if ([record.answer, record.firstAnswer].some((value) => typeof value === 'string' && value.length > MAX_ANSWER_TEXT)) {
      throw failure('answer-too-long', `An answer can be ${MAX_ANSWER_TEXT} characters at most.`);
    }
    records.set(record.questionId, record);
  }
  const fields = { trackId, sessionId, clientId, responses: [...records.values()] };
  if (JSON.stringify(fields.responses).length > MAX_RESPONSES_JSON) {
    throw failure('responses-too-large', 'These answers are too long to store together. Shorten the written answers.');
  }
  return fields;
}

// The two backends, as the same five operations. A `ref` is whatever lets a later write reach the
// item without looking it up: SharePoint's numeric item id and entity type, or the id locally.
const PARTICIPANT_SELECT = `$select=Id,${ID},${RESPONSE.sessionId},${RESPONSE.clientId},${RESPONSE.trackId},${RESPONSE.responses}`;

// Phase 9b (DI-6). An item whose answers are not a JSON list used to stop every reader of a session's results. The readers that take a
// `damaged` list (readSessionResponsesChecked, readLiveFeed with `tolerant`) leave such an item out and say which it was and why; the
// others throw as they always did. Nothing in an item is an empty list, not a damaged one.
const UNREADABLE_JSON = 'its saved answers are not valid JSON';
const UNREADABLE_LIST = 'its saved answers are not a list';

/** Why SharePoint's ResponsesJson text cannot be read as a list of answers, or null when it can. */
function whyUnreadable(text) {
  if (text === undefined || text === null || text === '') return null;
  if (typeof text !== 'string') return Array.isArray(text) ? null : UNREADABLE_LIST;
  let value;
  try { value = JSON.parse(text); } catch { return UNREADABLE_JSON; }
  return Array.isArray(value) ? null : UNREADABLE_LIST;
}

/** One participant's Responses row decoded. With a `damaged` list an unreadable row is noted there and null is returned; without one it throws as spDecode does. */
function decodeResponsesRow(row, damaged) {
  const reason = damaged ? whyUnreadable(row[RESPONSE.responses]) : null;
  if (reason) { damaged.push({ id: row[RESPONSE.trackId], reason }); return null; }
  return spDecode('responses', row);
}

const spParticipants = {
  async findAll(trackId) {
    const rows = await spPages(`${spListPath('responses')}/items?$filter=${RESPONSE.trackId} eq ${spLiteral(trackId)}&${PARTICIPANT_SELECT}&$top=5`);
    return rows.map((row) => {
      // The participant's OWN damaged item still stops this page (it cannot save into what it cannot read), but it says so in words.
      if (whyUnreadable(row[RESPONSE.responses])) {
        throw failure('responses-unreadable', 'Your saved answers could not be read, so this page cannot go on. Please tell your facilitator: the item that holds your answers needs to be corrected or deleted.');
      }
      const found = spDecode('responses', row);
      return { item: { ...found.item, trackId }, etag: found.etag, ref: { id: found.numericId, type: found.type ?? listTypes.get('responses') } };
    });
  },
  async create(fields) {
    const type = await spEntityType('responses');
    const { data } = await spHttp('POST', `${spListPath('responses')}/items`, {
      idempotent: true,
      body: {
        __metadata: { type }, Title: fields.trackId, [ID]: fields.trackId, [RESPONSE.trackId]: fields.trackId,
        [RESPONSE.sessionId]: fields.sessionId, [RESPONSE.clientId]: fields.clientId, [RESPONSE.responses]: JSON.stringify(fields.responses),
      },
    });
    return { id: data.Id, type: data.__metadata?.type ?? type };
  },
  async overwrite(ref, responses, etag = '*') {
    await spHttp('POST', `${spListPath('responses')}/items(${ref.id})`, {
      idempotent: true,
      headers: { 'X-HTTP-Method': 'MERGE', 'If-Match': etag },
      body: { __metadata: { type: ref.type ?? await spEntityType('responses') }, [RESPONSE.responses]: JSON.stringify(responses) },
    });
  },
  async remove(ref) {
    await spHttp('POST', `${spListPath('responses')}/items(${ref.id})`, { headers: { 'X-HTTP-Method': 'DELETE', 'If-Match': '*' } });
  },
  /** One page of a session's participant items, straight from the indexed SessionId. */
  async page(sessionId, top, cursor, damaged = null) {
    const { data } = await spHttp('GET', cursor ?? `${spListPath('responses')}/items?$filter=${RESPONSE.sessionId} eq ${spLiteral(sessionId)}&${PARTICIPANT_SELECT}&$top=${top}`);
    const rows = data.results ?? data.value ?? [];
    return {
      items: rows.filter((row) => row[RESPONSE.trackId]).flatMap((row) => {
        const found = decodeResponsesRow(row, damaged);
        return found ? [{ ...found.item, trackId: row[RESPONSE.trackId] }] : [];
      }),
      next: data.__next ?? data['@odata.nextLink'] ?? data['odata.nextLink'] ?? null,
    };
  },
};

const localParticipants = {
  // A query, like SharePoint's, so "nothing saved yet" is an empty answer rather than a 404 in the
  // browser's console. Only a caller that will check the version pays for a second read.
  async findAll(trackId, versioned = false) {
    const items = await request('GET', `/participantresponses?${new URLSearchParams({ id: trackId })}`);
    return Promise.all(items.map(async (item) => ({
      item, ref: { id: item.id },
      etag: versioned ? (await send('GET', itemPath('participantresponses', item.id))).etag : undefined,
    })));
  },
  async create(fields) {
    return { id: (await request('POST', '/participantresponses', { id: fields.trackId, ...fields })).id };
  },
  async overwrite(ref, responses, etag) {
    await send('PATCH', itemPath('participantresponses', ref.id), { body: { responses }, headers: etag ? { 'If-Match': etag } : undefined });
  },
  async remove(ref) {
    await request('DELETE', itemPath('participantresponses', ref.id));
  },
  async page(sessionId, top, cursor, damaged = null) {
    const query = new URLSearchParams({ sessionId, top: String(top), skip: String(cursor ?? 0) });
    const { items, next } = await request('GET', `/participantresponses/page?${query}`);
    if (!damaged) return { items, next };
    // Locally the answers are a JSON value of their own: anything but a list (or nothing) is damaged.
    const readable = items.filter((item) => {
      const damagedItem = item.responses !== undefined && item.responses !== null && !Array.isArray(item.responses);
      if (damagedItem) damaged.push({ id: item.trackId ?? item.id, reason: UNREADABLE_LIST });
      return !damagedItem;
    });
    return { items: readable, next };
  },
};

const participants = () => (sharePoint ? spParticipants : localParticipants);
const participantItem = (found) => ({
  trackId: found.item.trackId,
  sessionId: found.item.sessionId ?? null,
  clientId: found.item.clientId ?? null,
  responses: answerRecords(found.item.responses),
  ref: found.ref,
});

/**
 * One participant's saved answers: { trackId, sessionId, clientId, responses, ref }, or null if
 * they have saved nothing yet. One request, on the indexed TrackId. `ref` is opaque: hand it to
 * saveParticipantResponses() and that save is a single write.
 */
export async function getParticipantResponses(trackId) {
  if (!trackId) return null;
  const [found] = await participants().findAll(trackId);
  return found ? participantItem(found) : null;
}

/**
 * Stores a participant's whole answer list: { trackId, sessionId, clientId, responses }.
 *
 * With the `ref` from an earlier read or save it is ONE request: a blind overwrite of the item's
 * answers, with no read first and no version check, because only this participant's device writes
 * the item. Without a `ref` it creates the item; if the unique AppId says the item is there
 * already (an earlier create whose reply was lost, or the same visit open on a second device) it
 * reads it, lays these answers over what it holds (mergeAnswerRecords) and updates it instead.
 *
 * Resolves to { ref, responses }: the ref for the next save and the answers now stored.
 */
export async function saveParticipantResponses(input, ref = null) {
  const fields = participantFields(input);
  const store = participants();
  if (ref) {
    try {
      await store.overwrite(ref, fields.responses);
      return { ref, responses: fields.responses };
    } catch (error) {
      if (error.status !== 404) throw error; // the item is gone (its track was removed): start a new one
    }
  }
  try {
    return { ref: await store.create(fields), responses: fields.responses };
  } catch (error) {
    if (error.status !== 409) throw error;
  }
  const [found] = await store.findAll(fields.trackId);
  if (!found) throw Object.assign(new Error('The participant record could not be created or found.'), { status: 409 });
  const responses = participantFields({ ...fields, responses: mergeAnswerRecords(found.item.responses, fields.responses) }).responses;
  await store.overwrite(found.ref, responses);
  return { ref: found.ref, responses };
}

/** Removes a participant's own item. Does nothing if there is none. Resolves to { removed: items removed }. */
export async function deleteParticipantResponses(trackId) {
  const store = participants();
  const found = await store.findAll(trackId);
  for (const entry of found) await store.remove(entry.ref);
  return { removed: found.length };
}

/** Drops answers from a participant's own item: all of them, or only those to `questionIds`. Resolves to { removed }. */
async function removeParticipantAnswers(trackId, questionIds = null) {
  if (questionIds?.length === 0) return { removed: 0 };
  const store = participants();
  for (let attempt = 0; ; attempt += 1) {
    const [found] = await store.findAll(trackId, true);
    const held = found ? answerRecords(found.item.responses) : [];
    const kept = held.filter((record) => questionIds !== null && !questionIds.includes(record.questionId));
    if (kept.length === held.length) return { removed: 0 };
    try {
      // Unlike the participant's own saves this one checks the version: the device may be writing too.
      await store.overwrite(found.ref, kept, found.etag ?? undefined);
      return { removed: held.length - kept.length };
    } catch (error) {
      if (error.status !== 412 || attempt === 4) throw error;
      await pause(30 * (attempt + 1));
    }
  }
}

/**
 * Admin control: sends one visit back to the start of an activity (`sectionId`), or to the very beginning when none is given.
 * That visit's answers are removed from the participant's own item, so the session's other visits and their tallies are
 * untouched; then the track is stamped, and the iPad sees `restartedAt` change and jumps there. Resolves to { removed }.
 */
export async function restartParticipantTrack(clientTrackId, { sectionId = null } = {}) {
  let questionIds = null;
  if (sectionId !== null) {
    const section = await getItem('sections', sectionId);
    if (!section) throw failure('section-missing', 'That module no longer exists.');
    questionIds = section.questionIds ?? [];
  }
  const { removed } = await removeParticipantAnswers(clientTrackId, questionIds);
  if (!(await getItem('tracks', clientTrackId))) throw failure('track-missing', 'That client track no longer exists.');
  // Stamp it after the answers are gone, so an iPad reacting to the stamp never sees stale ones.
  await updateItem('tracks', clientTrackId, { restartedAt: new Date().toISOString(), restartSectionId: sectionId });
  return { removed };
}

/**
 * One page of a session's participant items: { items: [{ trackId, sessionId, clientId, responses }], next }.
 * Pass `next` back as `cursor` for the following page; it is null on the last. A session of about
 * 60 participants is one query on the indexed SessionId.
 */
export async function listSessionParticipants(sessionId, { pageSize = 100, cursor = null } = {}) {
  const { items, next } = await participants().page(sessionId, pageSize, cursor);
  return {
    items: items.map((item) => ({ trackId: item.trackId, sessionId: item.sessionId ?? sessionId, clientId: item.clientId ?? null, responses: answerRecords(item.responses) })),
    next,
  };
}

/**
 * THE reader of a session's answers. Resolves to one record per participant and question:
 *   { questionId, clientId, clientTrackId, answer, firstAnswer, finalAnswer, attempts, correct, timestamp }
 * `answer` is the one that counts: the FIRST try for a graded question, so a Retry never raises a
 * result. `finalAnswer` is where they ended up.
 */
export const readSessionResponses = (sessionId) => readAnswers(sessionId, null);

/**
 * readSessionResponses() for a screen that must show the rest when one item is damaged (Phase 9b, DI-6). Resolves to
 * { answers, unreadable: [{ id, reason }] }: `answers` are exactly what readSessionResponses() returns for the items it can read;
 * `unreadable` names each item it could not, by its participant's visit id, and why, in a few words. Nothing in an item is an empty
 * list and is not listed. The same one request on SharePoint.
 */
export async function readSessionResponsesChecked(sessionId) {
  const unreadable = [];
  return { answers: await readAnswers(sessionId, unreadable), unreadable };
}

async function readAnswers(sessionId, damaged) {
  const store = participants();
  const items = [];
  let cursor = null;
  do {
    const page = await store.page(sessionId, 200, cursor, damaged);
    items.push(...page.items);
    cursor = page.next;
  } while (cursor);
  return combineAnswers(items);
}

/** readSessionResponses()'s records from participant items, for a caller that read the items itself (the live feed, section 8). */
function combineAnswers(items) {
  const answers = new Map();
  for (const item of items) {
    for (const record of answerRecords(item.responses)) {
      answers.set(`${item.trackId} ${record.questionId}`, {
        questionId: record.questionId, clientId: item.clientId ?? null, clientTrackId: item.trackId,
        answer: record.correct === null ? record.answer : record.firstAnswer,
        firstAnswer: record.firstAnswer, finalAnswer: record.answer,
        attempts: record.attempts, correct: record.correct, timestamp: record.answeredAt,
      });
    }
  }
  return [...answers.values()];
}

/**
 * One read-only question of this site, on a small read of `list` (a key of LISTS, such as 'qrtokens') with the given query string, answered as
 * { ok: true, rows, length, data } (`length` is the address, as sent) or { ok: false, status, message }. Never throws and never writes. The setup page's
 * self-test asks it two questions (lib/setup/setup-checks.js, Phase 9b); SharePoint only. With no `list` (Phase 10b), `query` is the whole address after
 * `/_api` and `data` is what came back: the setup page asks where each list is that way (lib/setup/setup-deployment.js). It is a GET either way.
 */
export async function probeSharePointRead(list, query) {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  // (A query that names no columns is given the list's: Phase 10h.)
  const address = !list ? query : /\$select=/.test(query) ? `${spListPath(list)}/items?${query}` : spItems(list, query);
  try {
    const { data } = await spHttp('GET', address);
    return { ok: true, rows: (data.results ?? data.value ?? []).length, length: `${spSite()}/_api${address}`.length, data };
  } catch (error) {
    return { ok: false, status: error?.status, message: String(error?.message ?? error).replace(/^SharePoint \(\d+\):\s*/, '').replace(/\s+/g, ' ').slice(0, 140) };
  }
}

/**
 * One request of the setup page to the site's REST API (Phase 10c-3: migration/src/lib/setup/provision.js makes the lists and marks them ready with
 * it): `resource` is the address after `/_api`, and a write carries the write token. Resolves to what came back, and throws as every request
 * here does (`status`, and SharePoint's own words). SharePoint only.
 */
export async function sendToSharePoint(method, resource, body, headers) {
  if (!sharePoint) throw new Error('SharePoint mode is not enabled on this page.');
  return (await spHttp(method, resource, { body, headers })).data;
}

/**
 * The setup page's self-test, for a real site (run it on the test site only). It creates a
 * throwaway participant item, updates it with one write, reads it back by TrackId, tries to
 * create it a second time (the unique AppId must refuse), lists it by session, reads two things in
 * one $batch request (what a QR scan relies on to stay at 8 requests), and deletes everything it
 * made. Resolves to the steps: [{ name, pass, detail, requests, ms }]. `extraSteps` ([{ name, run }]) are further steps for a
 * real site, run after the batch step and before the clean-up; the Setup page passes its two read-only probes.
 */
export async function runParticipantSelfTest(onStep = () => {}, extraSteps = []) {
  const store = participants();
  const tag = crypto.randomUUID();
  const fields = participantFields({
    trackId: `selftest-${tag}`, sessionId: `selftest-session-${tag}`, clientId: 'selftest',
    responses: [{ questionId: 'selftest-q1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: true }],
  });
  const second = [...fields.responses, answerRecord({ questionId: 'selftest-q2', answer: 'A written answer.', attempts: 1, correct: null, answeredAt: new Date().toISOString() })];
  const steps = [];
  let ref = null;
  const step = async (name, run) => {
    const before = requestTotal;
    const started = Date.now();
    let result;
    try {
      result = { name, pass: true, detail: (await run()) ?? '' };
    } catch (error) {
      result = { name, pass: false, detail: error?.message ?? String(error) };
    }
    result = { ...result, requests: requestTotal - before, ms: Date.now() - started };
    steps.push(result);
    onStep(result);
    return result.pass;
  };
  const expect = (condition, message) => { if (!condition) throw new Error(message); };

  await step('Create a participant item', async () => {
    ref = await store.create(fields);
    return `AppId and TrackId ${fields.trackId}`;
  });
  if (ref) {
    await step('Update it with one write, no read', async () => {
      const before = requestTotal;
      await store.overwrite(ref, second);
      const sent = requestTotal - before;
      expect(sent === 1, `The update took ${sent} requests; it should take 1.`);
      return 'Overwritten blind (If-Match: *).';
    });
    await step('Read it back by TrackId', async () => {
      const found = await store.findAll(fields.trackId);
      expect(found.length === 1, `Found ${found.length} items for the TrackId; expected 1.`);
      const item = participantItem(found[0]);
      expect(item.sessionId === fields.sessionId && item.clientId === fields.clientId, 'SessionId or ClientId did not come back as written.');
      expect(JSON.stringify(item.responses) === JSON.stringify(second), 'The answers read back differ from the answers written.');
      return `${item.responses.length} answers, as written.`;
    });
    await step('A second create with the same AppId is refused', async () => {
      try {
        await store.create(fields);
      } catch (error) {
        expect(error.status === 409, `Refused, but not as a duplicate: ${error.message}`);
        return 'Refused: AppId enforces unique values.';
      }
      throw new Error(`A duplicate was created. Clients must not be able to make two items for one participant: turn on "Enforce unique values" for ${spTitle('responses')}.${ID}.`);
    });
    await step('List the session with one query', async () => {
      const before = requestTotal;
      const { items, next } = await store.page(fields.sessionId, 100, null);
      expect(requestTotal - before === 1, 'Listing the session took more than one request.');
      expect(items.length === 1 && next === null, `The session query returned ${items.length} items; expected 1.`);
      return 'One item, one request.';
    });
    // SharePoint only: the local server has no batch endpoint, and the page never asks it for one.
    if (sharePoint) {
      await step('Two reads in one request ($batch)', async () => {
        const before = requestTotal;
        let answers;
        try {
          answers = await spBatch([
            `${spListPath('responses')}/items?$filter=${RESPONSE.trackId} eq ${spLiteral(fields.trackId)}&${PARTICIPANT_SELECT}&$top=5`,
            `${spListPath('responses')}?$select=ListItemEntityTypeFullName`,
          ]);
        } catch (error) {
          throw new Error(`${error.message} The participant page then reads one by one: a QR scan costs 13 requests instead of 8 (set "batch": false in pms-config.txt), and still works.`);
        }
        const sent = requestTotal - before;
        expect(sent === 1, `The batch took ${sent} requests; it should take 1.`);
        const rows = answers[0]?.results ?? answers[0]?.value;
        expect(Array.isArray(rows) && rows.length > 0 && rows.every((row) => row[ID] === fields.trackId), 'The first read in the batch did not return the test item as JSON.');
        expect(typeof answers[1]?.ListItemEntityTypeFullName === 'string', "The second read in the batch did not return the list's item type.");
        return 'Both answered, as JSON, in one request. A QR scan reads the session, client, activities and visitor this way.';
      });
      // Steps the caller adds, on SharePoint only: the Setup page's two read-only probes of this tenant (lib/setup/setup-checks.js, Phase 9b). They report what
      // they find; a refusal is a finding, not a failure of the self-test.
      for (const { name, run } of extraSteps) await step(name, run);
    }
  }
  await step('Delete everything it made', async () => {
    const found = await store.findAll(fields.trackId);
    for (const entry of found) await store.remove(entry.ref);
    const left = await store.findAll(fields.trackId);
    expect(left.length === 0, `${left.length} test item(s) are still in the list; delete items whose TrackId starts with "selftest-".`);
    return `${found.length} item(s) removed.`;
  });
  return steps;
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

// ============================================================================
// 4. A first QR scan, in few requests
// ============================================================================
// The legacy pages' check-in (claimQrToken, which left in Phase 10c-2a) cost 14 requests on SharePoint:
// it read AppSettings and the Session twice and the code three times, and read two lists' whole
// column sets before writing to them. openQrScan() is the same check-in for the participant page
// with every record read once; what it reads is also today's experience, so the page that calls
// it reads nothing twice either. Its checks, their order, their codes and their words are the ones
// that check-in had; scripts/test-participant-storage.js writes them out. To the first screen that is 8 requests
// (9 for the device that moves a session to in-progress); where $batch can't be used, 13 once the
// page is told so (`batch: false`), and 14 while each page load still finds out for itself. (One
// more than before Phase 9a, which added a read to the batch: the look for a track that an earlier,
// cut-off try of the same code left behind.)
//
// What makes a code single-use is unchanged: ONE write to the code, which only applies if the
// code is still as it was read (If-Match on its version). $batch carries reads and nothing else.

// ---- The check-in --------------------------------------------------------------------------------

// The two backends, as the same six operations. A read resolves to { item, etag, ref }.
const spScan = {
  /** Asks for the write token alongside the first reads: the batched reads need it, and so do the writes that follow. */
  warm() { spDigest().catch(() => {}); },
  token: async (id) => spOne('qrtokens', id, (await spHttp('GET', spByAppId('qrtokens', id))).data),
  /** Everything the code points at, read side by side: one request where $batch works. */
  async records({ sessionId, clientId, visitorId, wantUser, tokenId }) {
    const asked = {
      session: spByAppId('sessions', sessionId),
      client: spByAppId('clients', clientId),
      owned: spItemsAddress('sections', { clientId }),
      // Tracks an earlier try of this code wrote and never got to claim it for (Phase 9a). Looked for, never needed: see `earlier` below.
      ...(tokenId ? { earlier: spItemsAddress('tracks', { sessionId, qrTokenId: tokenId }, 20) } : {}),
      ...(visitorId ? { visitor: spByAppId('visitorroster', visitorId) } : {}),
      ...(wantUser ? { user: '/web/currentuser?$select=Id,Title' } : {}),
      // The type a new Tracks item must name. No Tracks item is read on this path, so it is asked for here, once.
      ...(listTypes.has('tracks') ? {} : { trackType: `${spListPath('tracks')}?$select=ListItemEntityTypeFullName` }),
    };
    const names = Object.keys(asked);
    const together = await spReadTogether(Object.values(asked));
    const read = async (name) => (name in asked ? together[names.indexOf(name)] ?? (await spHttp('GET', asked[name])).data : null);
    const [session, client, owned, visitor, user, trackType, earlier] = await Promise.all([
      read('session'), read('client'), read('owned'), read('visitor'),
      read('user').catch((cause) => { console.warn('Could not read the signed-in SharePoint display name.', cause); return null; }),
      read('trackType'),
      read('earlier').catch(() => null), // a scan must never fail for this
    ]);
    if (trackType) listTypes.set('tracks', trackType.ListItemEntityTypeFullName);
    const next = owned.__next ?? owned['@odata.nextLink'] ?? owned['odata.nextLink'];
    const rows = [...(owned.results ?? owned.value ?? []), ...(next ? await spPages(next) : [])];
    return {
      session: spOne('sessions', sessionId, session),
      client: spOne('clients', clientId, client)?.item ?? null,
      owned: rows.map((row) => spDecode('sections', row).item),
      visitor: spOne('visitorroster', visitorId, visitor)?.item ?? null,
      user: user ? { id: user.Id == null ? null : String(user.Id), displayName: typeof user.Title === 'string' ? user.Title.trim() : '' } : null,
      earlier: (earlier?.results ?? earlier?.value ?? []).map((row) => { const found = spDecode('tracks', row); return { item: found.item, ref: { id: found.numericId, type: found.type } }; }),
    };
  },
  /** The same item spCreate() would write, without first reading every column of the list. AppId is unique, so a repeat can't make a second. */
  async createTrack(id, fields) {
    try {
      const { data } = await spHttp('POST', `${spListPath('tracks')}/items`, {
        idempotent: true,
        body: { __metadata: { type: await spEntityType('tracks') }, Title: id, ...spEncode('tracks', { ...fields, id }), [ID]: id },
      });
      return { item: spMade('tracks', data, { ...fields, id }), ref: { id: data.Id } };
    } catch (error) {
      const found = error.status === 409 ? await spOne('tracks', id, (await spHttp('GET', spByAppId('tracks', id))).data) : null;
      if (!found) throw error;
      return found; // an earlier try had created it, and only its reply was lost
    }
  },
  /** The write that claims (or retires) the code: it applies only if the code is still at the version that was read. */
  async claim(token, changes) {
    if (!token.etag) throw new Error(`SharePoint did not return an ETag for ${spTitle('qrtokens')}.`);
    await spWrite('qrtokens', token, 'MERGE', token.etag, changes);
  },
  startSession: (session) => spWrite('sessions', session, 'MERGE', session.etag, { status: 'in-progress' }),
  removeTrack: (track) => spWrite('tracks', track, 'DELETE', '*'),
};

const localScan = {
  warm() {},
  async token(id) {
    const found = await getItemWithVersion('qrtokens', id);
    return found && { ...found, ref: null };
  },
  async records({ sessionId, clientId, visitorId, tokenId }) {
    const [session, client, owned, visitor, earlier] = await Promise.all([
      getItemWithVersion('sessions', sessionId), getItem('clients', clientId), queryItems('sections', { clientId }),
      visitorId ? getItem('visitorroster', visitorId) : null,
      tokenId ? queryItems('tracks', { sessionId, qrTokenId: tokenId }).catch(() => []) : [],
    ]);
    return { session: session && { ...session, ref: null }, client, owned, visitor, user: null, earlier: earlier.map((item) => ({ item, ref: null })) };
  },
  async createTrack(id, fields) {
    try {
      return { item: await createItem('tracks', { id, ...fields }), ref: null };
    } catch (error) {
      const item = error.status === 409 ? await getItem('tracks', id) : null;
      if (!item) throw error;
      return { item, ref: null };
    }
  },
  claim: (token, changes) => updateItemIfUnchanged('qrtokens', token.item.id, changes, token.etag),
  startSession: (session) => updateItemIfUnchanged('sessions', session.item.id, { status: 'in-progress' }, session.etag),
  removeTrack: (track) => deleteItem('tracks', track.item.id),
};

// What a guest reads when a code cannot be used (scripts/test-participant-storage.js writes these out, case by case, on both adapters).
const scanRefusal = {
  unknown: () => failure('token-unknown', "This QR code isn't recognized. Ask your facilitator for a new one."),
  used: () => failure('token-used', 'This QR code has already been used. Ask your facilitator for a new code.'),
  expired: () => failure('token-expired', 'This QR code has expired because the session has ended.'),
  otherSession: () => failure('session-not-active', 'This code is for a different session. Ask your facilitator for the current check-in code.'),
  noVisitor: () => failure('visitor-token-required', 'This code is not assigned to a visitor. Ask your facilitator for a visitor-specific code.'),
  visitorOff: () => failure('visitor-missing', 'This visitor code is no longer enabled. Ask your facilitator for help.'),
  strayVisitor: () => failure('unexpected-visitor', 'This visitor code is not valid for the active session mode.'),
};

/**
 * What a QR scan does on the participant page: the check-in and getLiveExperience() in one pass.
 * It reads the code and AppSettings, then the session, the client, the client's activities and
 * the visitor together, and checks the code (known, not used, not expired), its session (not
 * ended, the live one) and its visitor, in that order. Resolves to { experience, user, failure, claim }:
 *
 *   experience  today's experience, as getLiveExperience() gives it
 *   user        the signed-in account, read only where it is used: for a staff code, or when the
 *               code was refused (Welcome then offers the staff way in). Null for a visitor's code.
 *   failure     null, or why the code can't be used: an Error with a `code` and words fit to show the guest
 *   claim()     writes the visit's track, then claims the code. Resolves to the track; rejects with
 *               'token-used' if another device took the code first. It is separate so that the
 *               caller can read the first activity while these writes are on their way.
 *
 * Exactly one of any number of devices scanning the same code gets a track. A device that loses
 * removes the track it had written. If a device can't learn whether its claim arrived (the
 * connection dropped), it throws the connection error and keeps what it has in memory, so that
 * this page's next try carries on with the same track instead of starting over.
 */
export async function openQrScan(tokenId) {
  const store = sharePoint ? spScan : localScan;
  store.warm();
  const [token, settings] = await Promise.all([store.token(tokenId), getAppSettings()]);
  const held = unfinishedScan?.tokenId === tokenId ? unfinishedScan.track : null;
  if (!held) holdScan(null);
  const experienceFor = (records) => {
    // What was read for the code is today's experience whenever the code is for the active session.
    const active = records && settings?.activeSessionId === token.item.sessionId
      && settings.activeClientId === token.item.clientId;
    return active ? liveExperienceOf(settings, records.client, records.session?.item ?? null, records.owned) : getLiveExperience(settings ?? null);
  };
  const refuse = async (error, records = null) => {
    if (held) {
      holdScan(null);
      await store.removeTrack(held).catch(() => {});
    }
    const [experience, user] = await Promise.all([experienceFor(records), records?.user ?? getCurrentUser().catch(() => null)]);
    return { experience, user, failure: error, claim: () => Promise.reject(error) };
  };

  if (!token) return refuse(scanRefusal.unknown());
  // This page's earlier try did claim the code; it just never heard so.
  const ours = held !== null && token.item.clientTrackId === held.item.id;
  if (!ours && token.item.expiredAt) return refuse(scanRefusal.expired()); // retired by endSession(): stored as used too, but say why
  if (!ours && token.item.used) return refuse(scanRefusal.used());

  const records = await store.records({
    sessionId: token.item.sessionId, clientId: token.item.clientId, visitorId: token.item.visitorId ?? null, wantUser: !token.item.visitorId, tokenId,
  });
  const session = records.session?.item ?? null;
  const visitor = records.visitor;
  if (!ours) {
    if (!session || session.status === 'completed') {
      // Ended before anyone scanned it (an older code, or a hand-edited session): retire it now.
      await store.claim(token, { used: true, expiredAt: new Date().toISOString() }).catch(() => {});
      return refuse(scanRefusal.expired(), records);
    }
    if (settings && settings.activeSessionId !== session.id) return refuse(scanRefusal.otherSession(), records);
    if ((session.participationMode ?? 'staff') === 'client-visit') {
      if (!token.item.visitorId) return refuse(scanRefusal.noVisitor(), records);
      if (!visitor || visitor.sessionId !== session.id || visitor.enabled === false) return refuse(scanRefusal.visitorOff(), records);
    } else if (token.item.visitorId) {
      return refuse(scanRefusal.strayVisitor(), records);
    }
  }

  const claim = async () => {
    const track = held ?? await store.createTrack(crypto.randomUUID(), {
      sessionId: token.item.sessionId, clientId: token.item.clientId, joinedVia: 'qr', qrTokenId: token.item.id,
      visitorId: visitor?.id ?? null, participantName: visitor?.displayName ?? null,
      sharePointUserId: visitor ? null : records.user?.id ?? null,
      createdAt: new Date().toISOString(), resumeCount: 0, lastResumedAt: null, restartedAt: null, restartSectionId: null,
    });
    holdScan({ tokenId, track });
    // The session's first visit moves it to in-progress, alongside the claim. It applies only if
    // the session is still as it was read: a 412 means another device, or the facilitator, got there first.
    const starting = session?.status === 'not-started'
      ? store.startSession(records.session).then(() => { session.status = 'in-progress'; }, (error) => {
        if (error.status !== 412) console.warn('Could not mark the session as in progress.', error);
      })
      : null;
    let current = token;
    for (let attempt = 0; !ours; attempt += 1) {
      try {
        await store.claim(current, { used: true, usedAt: new Date().toISOString(), clientTrackId: track.item.id });
        break;
      } catch (error) {
        // Refused, or not known to have arrived. The code itself says whose it is.
        let now;
        try { now = await store.token(tokenId); } catch { throw error; } // can't tell yet: this page's next try settles it
        if (now?.item.clientTrackId === track.item.id) break; // ours: the write landed and only its reply went astray
        const free = now && !now.item.used && !now.item.expiredAt;
        if (free && attempt < 2 && (error.status === 412 || isUnreachable(error))) { // nobody has it: ask again, at its version now
          current = now;
          await pause(30 * (attempt + 1));
          continue;
        }
        holdScan(null);
        await store.removeTrack(track).catch(() => {}); // another device won: undo our track
        throw error.status === 412 || now?.item.used ? scanRefusal.used() : error;
      }
    }
    holdScan(null);
    // The code is this visit's now, so any other track written for it is a try that was cut off before it could claim the code (on
    // this device before a reload, or on another): nobody can ever use one, and each would be counted as a participant who answered
    // nothing. They were read before this device wrote its own, and only the device that got the code removes them (Phase 9a).
    await Promise.all((records.earlier ?? []).filter((left) => left.item.id !== track.item.id).map((left) => store.removeTrack(left).catch(() => {})));
    await starting;
    return track.item;
  };
  return { experience: await experienceFor(records), user: records.user, failure: null, claim };
}

// ---- A visit begun from Welcome (Phase 9a) ---------------------------------------------------------

/**
 * The participant page's "Click here to begin" (a visit with no code): a new visit of `clientId` in the session, which must be the live
 * one, not ended, and not for guests only. Two things about what a bad moment leaves:
 *
 *   - The visit's id is the caller's (`trackId`, made once for as long as Welcome is on screen). A press whose reply never
 *     arrived, pressed again, finds the visit it already made. (A new id each call would leave an extra visit, counted in the
 *     results as a participant who answered nothing.)
 *   - Moving the session to in-progress is tried, not required (as openQrScan() does it). A participant whose account may only
 *     read Sessions still gets in.
 *
 * Phase 10j: AppSettings and the session are read side by side (their checks, in the same order, with the same words), and the write that
 * moves the session on uses the version the check read and is not waited for: a 412 means someone else moved it first. What the writes need
 * (the write token, the participants list's type and columns) is fetched ahead by the page (prepareWrites); a press while that is on its way
 * waits for it. With `waitForSession: false` (Welcome's "Click here to begin") it resolves as soon as the visit is written, and the session is
 * moved on after; otherwise once that write is done too (or failed), which keeps the requests of a test's set-up in order. Resolves to the track.
 * @param {string} trackId @param {string} sessionId @param {string} clientId @param {{ sharePointUserId?: string | null, waitForSession?: boolean }} [options]
 */
export async function beginVisit(trackId, sessionId, clientId, { sharePointUserId = null, waitForSession = true } = {}) {
  const [settingsRead, sessionRead] = await Promise.allSettled([getAppSettings(), sharePoint ? spFind('sessions', sessionId) : getItemWithVersion('sessions', sessionId)]);
  if (settingsRead.status === 'rejected') throw settingsRead.reason;
  const settings = settingsRead.value;
  if (settings && settings.activeSessionId !== sessionId) {
    throw failure('session-not-active', 'Your facilitator changed the active session. Ask them for the current check-in link.');
  }
  if (sessionRead.status === 'rejected') throw sessionRead.reason;
  const read = sessionRead.value;
  const session = read?.item ?? null;
  if (!session) throw failure('session-missing', 'That session no longer exists.');
  if (session.status === 'completed') throw failure('session-ended', 'This session has ended.');
  if ((session.participationMode ?? 'staff') === 'client-visit') throw failure('visitor-required', 'Scan the visitor QR code provided by your facilitator.');
  let track;
  try {
    track = await createItem('tracks', {
      id: trackId, sessionId, clientId, joinedVia: 'manual', qrTokenId: null, visitorId: null, participantName: null, sharePointUserId,
      createdAt: new Date().toISOString(), resumeCount: 0, lastResumedAt: null, restartedAt: null, restartSectionId: null,
    });
  } catch (error) {
    // An earlier press made it, and only its reply was lost. (An id that is some other session's visit is nobody's to take.)
    track = error.status === 409 ? await getItem('tracks', trackId) : null;
    if (!track || track.sessionId !== sessionId) throw error;
  }
  if (session.status === 'not-started') {
    const changes = { status: 'in-progress' };
    const moved = (sharePoint ? spMerge('sessions', read, changes) : updateItemIfUnchanged('sessions', sessionId, changes, read.etag)).catch((error) => {
      if (error.status !== 412) console.warn('Could not mark the session as in progress.', error);
    });
    if (waitForSession) await moved;
  }
  return track;
}

/**
 * Fetches ahead, in the background, what the participant page's writes will ask for (Phase 10j): the write token, the item type of each list
 * in `types`, and the item type and column check of each list in `checked` (one written through the general create or update, which checks the
 * list's columns first). They are the very requests those writes make, shared: a write meanwhile waits for them and never sends a second copy,
 * and one that failed is forgotten, so the write asks for it as it always did. Never throws; nothing to do on the local server.
 * @param {{ checked?: string[], types?: string[] } | null} [wanted]
 */
export async function prepareWrites(wanted) {
  if (!sharePoint || !wanted) return;
  const { checked = [], types = [] } = wanted;
  await Promise.all([spDigest(), ...checked.map((list) => spMetadata(list)), ...types.map(spEntityTypeAhead)].map((pending) => pending.catch(() => {})));
}

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
    }));
    // The lists' version comes with the AppSettings item: a read of it checks it (above).
    sent.forEach(({ list }, at) => { if (list === 'appsettings') versioned(answers[at].find((row) => row.id === 'default') ?? null); });
  }
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

// ============================================================================
// 6. Content per client, copying activities, and guests in bulk
// ============================================================================
// Added for Phase 5b (migration/src/admin/AdminContent.svelte and AdminGuests.svelte, through
// migration/src/lib/admin/admin-content.js). No SharePoint column is used beyond the thirteen of Phase 4: an activity's order is
// Sections.Order, which has always been there; an activity's client is Sections.ClientId; a
// question's layout and an option's picture are Questions.Layout and Options.ImageUrl.
//
// Every function below is built from the generic list calls both adapters implement (createItem,
// updateItem, deleteItem, queryItems, readLists), so the local Express adapter and SharePoint take
// the same path; scripts/test-admin-content.js runs each one against both and compares.
//
// Bulk work is paced: `runPaced` keeps a few writes in flight, spaces them on SharePoint, and the
// adapter itself already waits out a 429 or 503 for as long as Retry-After asks.

/** @typedef {{ id: string, title: string, order?: number, enabled?: boolean, questionIds?: string[], clientId?: string | null, description?: string | null, industryTags?: string[] }} SectionRecord */
/** @typedef {{ id: string, type: string, prompt: string, sectionId?: string, optionIds?: string[], order?: number, layout?: string | null }} QuestionRecord */
/** @typedef {{ id: string, questionId: string, label: string, value?: any, correct?: boolean | null, imageUrl?: string | null }} OptionRecord */
/** @typedef {{ sections: SectionRecord[], questions: QuestionRecord[], options: OptionRecord[] }} ActivityContent */

/** One name, as the guest list compares it: Unicode-normalised, whitespace collapsed, case ignored. */
export const guestNameKey = (name) => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The questions and options of some activities, in the fewest reads: one $batch on SharePoint
 * (questions and options side by side, 20 ids to a read), plain parallel reads locally. `sections`
 * are the activity records already in hand. Resolves to { questions, options }, unordered; an
 * activity's own order is section.questionIds and each question's optionIds.
 * @param {SectionRecord[]} sections
 * @returns {Promise<{ questions: QuestionRecord[], options: OptionRecord[] }>}
 */
export async function readActivityContent(sections) {
  const questionIds = distinct(sections.flatMap((section) => section.questionIds ?? []));
  if (questionIds.length === 0) return { questions: [], options: [] };
  const groups = chunked(questionIds, READ_CHUNK);
  const answers = await readLists([
    ...groups.map((ids) => ({ list: 'questions', where: { id: ids } })),
    ...groups.map((ids) => ({ list: 'options', where: { questionId: ids } })),
  ]);
  return { questions: answers.slice(0, groups.length).flat(), options: answers.slice(groups.length).flat() };
}

// ---- Copying and duplicating activities ----------------------------------------------------------

/** What joins an id to the client it was copied for: `sec-trivia~c-dominos`. A copy of a copy starts again from the original's id. */
export const COPY_SEPARATOR = '~';
/** The id a copy of `sourceId` gets in `toClientId`. The same every time, so copying twice cannot make two. */
export const copyIdFor = (sourceId, toClientId) => `${String(sourceId).split(COPY_SEPARATOR)[0]}${COPY_SEPARATOR}${toClientId}`;

const titleKey = (title) => String(title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** `Title (copy)`, then `Title (copy 2)`, ... the first that is not among `taken`. */
export function copyTitle(title, taken) {
  const used = new Set([...taken].map(titleKey));
  for (let number = 1; ; number += 1) {
    const candidate = `${title} (copy${number === 1 ? '' : ` ${number}`})`;
    if (!used.has(titleKey(candidate))) return candidate;
  }
}

/**
 * What copying would do, worked out without a single request, so the screen can show it and the
 * copy then does exactly that. `sections` are the activities to copy in the order they should land;
 * `questions` and `options` are everything those activities hold (readActivityContent). `targetSections`
 * are what the destination client has now.
 *
 *   ids: 'derived'  each record's id comes from its source's and the client (copyIdFor), so a second
 *                   copy meets the first and does nothing more. An activity is skipped when the client
 *                   already has one with that title, or one that was copied from it before (it may
 *                   have been renamed since).
 *   ids: 'random'   a duplicate: new ids, and `retitle` gives it the title `X (copy)`.
 *
 * Copies start NOT live, are appended after the client's last activity in the order given, and keep
 * their questions in the order they had. A question's layout, an option's picture and an activity's
 * description travel only when they have a value, so a site whose list lacks that column is never asked
 * to store one. Resolves to { items, skipped, totals }, where an item is
 * { source, section, questions, options } holding the records to create.
 * @param {ActivityContent & { toClientId: string, targetSections?: SectionRecord[], ids?: 'derived' | 'random', retitle?: boolean, makeId?: () => string }} plan
 */
export function planCopy({ sections, questions, options, toClientId, targetSections = [], ids = 'derived', retitle = false, makeId = () => crypto.randomUUID() }) {
  const questionIndex = new Map(questions.map((question) => [question.id, question]));
  const optionsOf = new Map();
  for (const option of options) optionsOf.set(option.questionId, [...(optionsOf.get(option.questionId) ?? []), option]);
  const takenTitles = new Set(targetSections.map((section) => titleKey(section.title)));
  const takenIds = new Set(targetSections.map((section) => section.id));
  let order = Math.max(0, ...targetSections.map((section) => Number(section.order) || 0));
  const items = [];
  const skipped = [];
  const newId = (sourceId) => (ids === 'random' ? makeId() : copyIdFor(sourceId, toClientId));

  for (const source of sections) {
    const sectionId = newId(source.id);
    const title = retitle ? copyTitle(source.title, [...takenTitles]) : source.title;
    if (!retitle && takenTitles.has(titleKey(title))) {
      skipped.push({ source, reason: 'title-exists', message: `"${source.title}" is already one of this client's activities.` });
      continue;
    }
    if (ids === 'derived' && takenIds.has(sectionId)) {
      skipped.push({ source, reason: 'already-copied', message: `"${source.title}" was copied here before (it may have been renamed since).` });
      continue;
    }
    takenTitles.add(titleKey(title));
    takenIds.add(sectionId);
    order += 1;

    const copiedOptions = [];
    const copiedQuestions = [];
    for (const questionId of source.questionIds ?? []) {
      const question = questionIndex.get(questionId);
      if (!question) continue; // the activity lists a question that is gone: nothing to copy
      const copiedQuestionId = newId(question.id);
      const ordered = (question.optionIds ?? []).map((id) => (optionsOf.get(question.id) ?? []).find((option) => option.id === id)).filter(Boolean);
      const copiedIds = [];
      for (const option of ordered) {
        const copiedId = newId(option.id);
        copiedIds.push(copiedId);
        copiedOptions.push({
          id: copiedId, questionId: copiedQuestionId, label: option.label, value: option.value, correct: option.correct ?? null,
          ...(typeof option.imageUrl === 'string' && option.imageUrl.trim() ? { imageUrl: option.imageUrl } : {}),
        });
      }
      copiedQuestions.push({
        id: copiedQuestionId, sectionId, type: question.type, prompt: question.prompt, optionIds: copiedIds, order: question.order ?? copiedQuestions.length + 1,
        ...(question.layout ? { layout: question.layout } : {}),
      });
    }
    items.push({
      source,
      section: {
        id: sectionId, title, order, enabled: false, industryTags: [...(source.industryTags ?? [])], questionIds: copiedQuestions.map((question) => question.id),
        clientId: toClientId,
        ...(typeof source.description === 'string' && source.description.trim() ? { description: source.description } : {}),
      },
      questions: copiedQuestions,
      options: copiedOptions,
    });
  }
  return {
    items,
    skipped,
    totals: {
      activities: items.length,
      questions: items.reduce((sum, item) => sum + item.questions.length, 0),
      options: items.reduce((sum, item) => sum + item.options.length, 0),
    },
  };
}

/** Creates a record, or, if its id is taken (a failed earlier run that could not clean up), writes the same content over it. */
async function createOrOverwrite(list, record) {
  try {
    await createItem(list, record);
  } catch (error) {
    if (error.status !== 409) throw error;
    const { id, ...fields } = record;
    await updateItem(list, id, fields);
  }
}

/**
 * Makes the activities of a client part of the live session's tally. Results are counted over
 * session.sectionIds, which Go live fills; an activity made while its client is already live would
 * otherwise show no results. Does nothing when another client (or none) is live. Resolves to the
 * session, or null.
 */
export async function addSectionsToLiveSession(clientId, sectionIds) {
  const settings = await getAppSettings();
  if (!settings?.activeSessionId) return null;
  const session = await getItem('sessions', settings.activeSessionId);
  if (!session || session.clientId !== clientId || session.status === 'completed') return null;
  const missing = sectionIds.filter((id) => !(session.sectionIds ?? []).includes(id));
  return missing.length ? updateItem('sessions', session.id, { sectionIds: [...(session.sectionIds ?? []), ...missing] }) : session;
}

/**
 * Admin: copies activities, with their questions and options, to `toClientId`. See planCopy() for
 * what a copy is. Each activity is written options first, then questions, then the activity record
 * itself, so nothing refers to a record that is not there yet and the activity appears to
 * participants and in the admin only when it is whole. If any write of an activity fails, what that
 * activity had written is deleted again: a failed copy leaves no half-built activity. A run that
 * stops (two activities in a row failed, or `signal` was aborted) leaves the rest not attempted.
 * Running it again copies only what is missing: activities that are whole are skipped, the others
 * are written again.
 *
 * Pass `content` ({ sections, questions, options }, as the screen showed it) to copy exactly that;
 * otherwise `sectionIds` are read. `onProgress({ written, total, activity, activityIndex, activities })`
 * is called after each record.
 * @param {{ toClientId: string, sectionIds?: string[], content?: ActivityContent | null, ids?: 'derived' | 'random', retitle?: boolean, onProgress?: (step: { written: number, total: number, activity: string, activityIndex: number, activities: number }) => void } & PaceOptions} options
 * Resolves to
 *   { client, copied: [{ source, section, questions, options }], skipped, failed: [{ source, error }],
 *     notAttempted: [source], totals, stopped, liveSessionSynced }, where liveSessionSynced is true when the
 * client is live and its session now counts the copies, null when there was nothing to do (it is not live), and
 * false when the session could not be updated.
 */
export async function copyActivities({
  toClientId, sectionIds = [], content = null, ids = 'derived', retitle = false,
  concurrency = PACE.concurrency, gapMs = null, onProgress = () => {}, signal = null,
} = {}) {
  const client = await getItem('clients', toClientId);
  if (!client) throw failure('client-missing', 'That client no longer exists.');
  if (client.status === 'archived') throw failure('client-archived', `${client.name} is archived. Restore it before adding activities.`);
  let source = content;
  if (!source) {
    const sections = await getItems('sections', sectionIds);
    source = { sections, ...(await readActivityContent(sections)) };
  }
  const targetSections = await queryItems('sections', { clientId: toClientId });
  const plan = planCopy({ ...source, toClientId, targetSections, ids, retitle });
  const copied = [];
  const failed = [];
  let stopped = null;
  let streak = 0;
  let written = 0;
  const total = plan.totals.activities + plan.totals.questions + plan.totals.options;

  for (const [position, item] of plan.items.entries()) {
    if (signal?.aborted) { stopped = 'aborted'; break; }
    const made = [];
    const tick = (list, record) => {
      made.push([list, record.id]);
      written += 1;
      onProgress({ written, total, activity: item.section.title, activityIndex: position + 1, activities: plan.items.length });
    };
    try {
      for (const [list, records] of [['options', item.options], ['questions', item.questions]]) {
        const { results } = await runPaced(records, async (record) => { await createOrOverwrite(list, record); tick(list, record); }, { concurrency, gapMs, stopAfterFailures: 1, signal });
        const bad = results.find((result) => result && !result.ok);
        if (bad) throw bad.error;
        if (results.some((result) => result === undefined)) throw failure('copy-stopped', 'The copy was stopped.');
      }
      try {
        await createItem('sections', item.section);
      } catch (error) {
        if (error.status !== 409) throw error;
        // The activity is already there whole (another admin, or an earlier run that was not told): nothing to undo.
        written -= made.length;
        made.length = 0;
        plan.skipped.push({ source: item.source, reason: 'already-copied', message: `"${item.source.title}" was copied here a moment ago.` });
        continue;
      }
      tick('sections', item.section);
      copied.push(item);
      streak = 0;
    } catch (error) {
      for (const [list, id] of made.reverse()) await deleteItem(list, id).catch(() => {});
      written -= made.length;
      if (error.code === 'copy-stopped') { stopped = 'aborted'; break; }
      failed.push({ source: item.source, error });
      streak += 1;
      if (streak >= 2) { stopped = 'failures'; break; }
    }
  }
  const attempted = new Set([...copied, ...failed].map((entry) => entry.source.id));
  const notAttempted = plan.items.map((item) => item.source).filter((entry) => !attempted.has(entry.id)
    && !plan.skipped.some((skip) => skip.source.id === entry.id));
  let liveSessionSynced = null;
  if (copied.length) {
    try { liveSessionSynced = (await addSectionsToLiveSession(toClientId, copied.map((item) => item.section.id))) ? true : null; } catch { liveSessionSynced = false; }
  }
  return { client, copied, skipped: plan.skipped, failed, notAttempted, totals: plan.totals, stopped, liveSessionSynced };
}

/**
 * Admin: a copy of one of a client's activities in the same client, titled `X (copy)` and not live. Resolves like copyActivities().
 * @param {string} sectionId
 * @param {PaceOptions & { onProgress?: (step: { written: number, total: number, activity: string, activityIndex: number, activities: number }) => void }} [options]
 */
export async function duplicateActivity(sectionId, options = {}) {
  const section = await getItem('sections', sectionId);
  if (!section) throw failure('activity-missing', 'That activity no longer exists.');
  if (!section.clientId) throw failure('activity-unassigned', 'Give this activity a client before duplicating it.');
  return copyActivities({ ...options, toClientId: section.clientId, sectionIds: [sectionId], ids: 'random', retitle: true });
}

/**
 * Admin: deletes an activity, its questions and their options. The activity record goes first, so
 * participants stop seeing it at once; the questions and options follow. Anything that could not be
 * deleted is reported in `leftovers` (nothing refers to it, and it does no harm). Recorded answers
 * are not touched. Pass `content` ({ questions, options }) when the screen already holds it.
 * Resolves to { deleted: { questions, options }, leftovers: [{ list, id }] }.
 * @param {string} sectionId
 * @param {{ content?: { questions: QuestionRecord[], options: OptionRecord[] } | null } & PaceOptions} [options]
 */
export async function deleteActivity(sectionId, { content = null, concurrency = PACE.concurrency, gapMs = null } = {}) {
  const section = await getItem('sections', sectionId);
  if (!section) return { deleted: { questions: 0, options: 0 }, leftovers: [] };
  const held = content ?? await readActivityContent([section]);
  const questions = held.questions.filter((question) => (section.questionIds ?? []).includes(question.id));
  const options = held.options.filter((option) => questions.some((question) => question.id === option.questionId));
  await deleteItem('sections', sectionId);
  const leftovers = [];
  const counts = { questions: 0, options: 0 };
  for (const [list, records] of [['options', options], ['questions', questions]]) {
    const { results } = await runPaced(records, (record) => deleteItem(list, record.id), { concurrency, gapMs, stopAfterFailures: records.length || 1 });
    records.forEach((record, index) => {
      if (results[index]?.ok) counts[list] += 1;
      else leftovers.push({ list, id: record.id });
    });
  }
  if (section.clientId) {
    // The live session no longer counts it.
    const settings = await getAppSettings();
    const session = settings?.activeSessionId ? await getItem('sessions', settings.activeSessionId) : null;
    if (session?.clientId === section.clientId && (session.sectionIds ?? []).includes(sectionId)) {
      await updateItem('sessions', session.id, { sectionIds: session.sectionIds.filter((id) => id !== sectionId) }).catch(() => {});
    }
  }
  return { deleted: counts, leftovers };
}

// ---- Guests ----------------------------------------------------------------------------------------

/** The live session a guest action may work on: it exists, has not ended, and is the one participants are given. */
async function guestSession(sessionId) {
  const [settingRows, sessionRows] = await readLists([{ list: 'appsettings' }, { list: 'sessions', where: { id: sessionId } }]);
  const settings = settingRows.find((row) => row.id === 'default') ?? null;
  const session = sessionRows[0] ?? null;
  if (!session) throw failure('session-missing', 'That session no longer exists.');
  if (settings && settings.activeSessionId !== session.id) {
    throw failure('session-not-active', 'This session is no longer the live one. Go live with it on Today first.');
  }
  if (session.status === 'completed') throw failure('session-ended', 'That session has ended.');
  return session;
}

/**
 * Admin: adds named guests to the live session's roster. `names` are already tidy (the screen's
 * parser trims, collapses and caps them); names already on the roster, or repeated in `names`, are
 * skipped here too, against a roster read just now, so adding the same list twice adds nobody. A
 * run that fails part way keeps the guests it added and can simply be run again. Resolves to
 * { added: [visitor], skipped: [name], failed: [{ name, error }], notAttempted: [name], stopped }.
 * @param {string} sessionId
 * @param {string[]} names
 * @param {PaceOptions & { onProgress?: (step: { done: number, total: number }) => void }} [options]
 */
export async function addGuests(sessionId, names, { concurrency = PACE.concurrency, gapMs = null, onProgress = () => {}, signal = null } = {}) {
  const session = await guestSession(sessionId);
  const roster = await queryItems('visitorroster', { sessionId: session.id });
  const have = new Set(roster.map((visitor) => guestNameKey(visitor.displayName)));
  const fresh = [];
  const skipped = [];
  for (const name of names) {
    const key = guestNameKey(name);
    if (!key || have.has(key)) { skipped.push(name); continue; }
    have.add(key);
    fresh.push(name);
  }
  let done = 0;
  const { results, stopped } = await runPaced(fresh, async (name) => {
    const visitor = await createItem('visitorroster', { sessionId: session.id, displayName: name, enabled: true });
    done += 1;
    onProgress({ done, total: fresh.length });
    return visitor;
  }, { concurrency, gapMs, signal });
  return {
    added: results.flatMap((result) => (result?.ok ? [result.value] : [])),
    skipped,
    failed: fresh.flatMap((name, index) => (results[index] && !results[index].ok ? [{ name, error: results[index].error }] : [])),
    notAttempted: fresh.filter((_, index) => results[index] === undefined),
    stopped,
  };
}

/**
 * Admin: a single-use QR code for every enabled guest of the live session who has none. "Has one" is
 * any code that has not expired, scanned or not, so a guest who already joined is left alone and
 * running it again makes nothing: it is safe to press twice and to run again after a failure. The
 * checks are provisionQrToken()'s, made once for the whole run (the session is live and has not ended,
 * and guests scan a personal QR), where provisionQrToken makes them for every guest. Codes made before
 * a failure stay: each is whole by itself. Resolves to
 * { created: [{ visitorId, tokenId }], alreadyHad: number, failed: [{ visitorId, error }], notAttempted: [visitorId], stopped }.
 * @param {string} sessionId
 * @param {PaceOptions & { onProgress?: (step: { done: number, total: number }) => void }} [options]
 */
export async function provisionGuestCodes(sessionId, { concurrency = PACE.concurrency, gapMs = null, onProgress = () => {}, signal = null } = {}) {
  const session = await guestSession(sessionId);
  if ((session.participationMode ?? 'staff') !== 'client-visit') {
    throw failure('visitor-required', 'Choose "Guests scan a personal QR" on Today before making guest codes.');
  }
  const client = await getItem('clients', session.clientId);
  if (!client) throw failure('client-missing', 'That client no longer exists.');
  const [visitors, tokens] = await readLists([{ list: 'visitorroster', where: { sessionId: session.id } }, { list: 'qrtokens', where: { sessionId: session.id } }]);
  const holding = new Set(tokens.filter((token) => token.visitorId && !token.expiredAt).map((token) => token.visitorId));
  const enabled = visitors.filter((visitor) => visitor.enabled !== false);
  const missing = enabled.filter((visitor) => !holding.has(visitor.id));
  let done = 0;
  const { results, stopped } = await runPaced(missing, async (visitor) => {
    const token = await createItem('qrtokens', {
      clientId: session.clientId, sessionId: session.id, visitorId: visitor.id, used: false, createdAt: new Date().toISOString(), usedAt: null, clientTrackId: null,
    });
    done += 1;
    onProgress({ done, total: missing.length });
    return token;
  }, { concurrency, gapMs, signal });
  return {
    created: missing.flatMap((visitor, index) => (results[index]?.ok ? [{ visitorId: visitor.id, tokenId: results[index].value.id }] : [])),
    alreadyHad: enabled.length - missing.length,
    failed: missing.flatMap((visitor, index) => (results[index] && !results[index].ok ? [{ visitorId: visitor.id, error: results[index].error }] : [])),
    notAttempted: missing.filter((_, index) => results[index] === undefined).map((visitor) => visitor.id),
    stopped,
  };
}

// ============================================================================
// 7. Pictures for a client's look
// ============================================================================
// Added for Phase 6 (migration/src/admin/BrandStudio.svelte, AssetUploader.svelte). The older upload with
// no name, uploadClientLogo(), was the legacy admin's and left with it in Phase 10c-1; the local server's
// upload route still takes a picture with no name. No SharePoint column is used.
//
// A picture is stored under a name that says whose it is and what it holds,
// `<slug>-<slot>-<10 hex of the SHA-256 of its bytes>.<ext>` (migration/src/lib/brand/asset-names.js), flat in
// the ClientLogos library (SharePoint) or in the uploads folder (the local server). A different picture
// has a different name, so an address never changes what it shows, and the file it replaces can be
// removed by name once the new one is in use. The browser has already cropped, resized and re-encoded the
// picture (and so stripped its metadata) before it gets here; this only stores it.

/** The only names a picture is stored under. */
const ASSET_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:hero|logo|background|tile)-[0-9a-f]{10}\.(png|webp|jpg)$/;
const ASSET_TYPES = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
/** Above every slot's cap (the biggest is 350 KB): a picture over this did not come from the cropper. */
const ASSET_MAX_BYTES = 512 * 1024;

/** What is wrong with a picture and its name, in words; '' when it can be stored. */
function assetProblem(file, name) {
  if (typeof name !== 'string' || !ASSET_NAME.test(name)) return 'That is not a picture file name this page makes.';
  const extension = ASSET_TYPES[file?.type];
  if (!extension || !name.endsWith(`.${extension}`)) return 'Choose a PNG, JPEG or WebP picture. SVG upload is disabled on SharePoint.';
  if (!(file.size > 0)) return 'The picture is empty.';
  if (file.size > ASSET_MAX_BYTES) return 'That picture is too big to store.';
  return '';
}

/** The ClientLogos library's folder, asked once per page load. */
function spLogoFolder() {
  if (!logoFolders.has(sharePoint)) {
    const library = spLibraryIn(sharePoint);
    const pending = spHttp('GET', `/web/lists/getbytitle(${spLiteral(library)})/RootFolder?$select=ServerRelativeUrl`).then(({ data }) => data.ServerRelativeUrl);
    logoFolders.set(sharePoint, pending);
    pending.catch(() => logoFolders.delete(sharePoint));
  }
  return logoFolders.get(sharePoint);
}

async function spUploadAsset(file, name) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const valid = file.type === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : file.type === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
    : starts(0x52, 0x49, 0x46, 0x46) && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!valid) throw new Error('The picture content does not match its image type.');
  // The folder and the write token are independent, so they are asked for together (the first upload on a page).
  const [folder] = await Promise.all([spLogoFolder(), spDigest()]);
  // The same name is the same bytes, so writing it over is safe, and so is sending it twice after a 503.
  const { data } = await spHttp('POST', `/web/GetFolderByServerRelativeUrl(${spLiteral(folder)})/Files/add(url=${spLiteral(name)},overwrite=true)`, { body: file, idempotent: true });
  return { name, url: new URL(data.ServerRelativeUrl, spSite()).href };
}

/**
 * Stores a finished picture (a Blob or File of image/png, image/webp or image/jpeg) under `name` and
 * resolves to { url, name }, where `url` is what to store in a client's theme or an option. SVG is refused
 * on both adapters. Locally the picture goes through the existing upload endpoint (to UPLOAD_DIR when the
 * server has one), with the name in the query; on SharePoint it is a file in the ClientLogos library
 * (the folder is asked for once per page, then each upload is one request after the write token).
 * @param {Blob} file
 * @param {string} name `<slug>-<slot>-<hash>.<ext>`
 */
export async function uploadClientAsset(file, name) {
  const problem = assetProblem(file, name);
  if (problem) throw new Error(problem);
  if (sharePoint) return spUploadAsset(file, name);
  const { url } = await request('POST', `/uploads/logo?name=${encodeURIComponent(name)}`, file);
  return { name, url };
}

/**
 * Removes a picture this page uploaded, once nothing uses it: best effort, never throws. Resolves to
 * whether it was removed. A file whose name is not one of ours, or that is not in the pictures folder,
 * is never touched (a seeded logo, a picture pasted from elsewhere). On SharePoint the file goes to the
 * site's recycle bin, so it can be restored.
 * @param {string | null | undefined} url
 */
export async function removeClientAsset(url) {
  try {
    if (!url) return false;
    const name = decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() ?? '');
    if (!ASSET_NAME.test(name)) return false;
    if (sharePoint) {
      const folder = await spLogoFolder();
      const site = new URL(spSite());
      const parsed = new URL(url, site);
      const path = decodeURIComponent(parsed.pathname);
      if (parsed.origin !== site.origin || path.toLowerCase() !== `${folder}/${name}`.toLowerCase()) return false;
      await spHttp('POST', `/web/GetFileByServerRelativeUrl(${spLiteral(path)})/recycle()`);
      return true;
    }
    if (!decodeURIComponent(new URL(url, 'http://local.invalid/').pathname).endsWith(`/assets/images/clients/${name}`)) return false;
    await request('DELETE', `/uploads/logo/${encodeURIComponent(name)}`);
    return true;
  } catch (error) {
    console.warn('dataService: could not remove an old picture', error);
    return false;
  }
}

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

// ============================================================================
// 10. Which lists are this copy's (Phase 10b)
// ============================================================================

/**
 * The title of each list, by its key, and of the picture library (`logoLibrary`), as this page's requests spell them: under the
 * settings it was configured with, or under `settings` when some are given (nothing is asked of the site either way). The setup
 * page shows them; a test holds migration/src/lib/settings/deploy-settings.js to the same twelve keys and titles.
 * @returns {Record<string, string>}
 */
export const sharePointListTitles = (settings = sharePoint) => ({
  ...Object.fromEntries(Object.keys(LISTS).map((list) => [list, spTitleIn(settings, list)])),
  logoLibrary: spLibraryIn(settings),
});

// Passed on from the parts already cut out of this file (Phase 17).
export {
  configure, requireConfiguration, isUnreachable, isSharePointMode,
} from './core.js';
export {
  runPaced,
} from './common.js';
export {
  checkSharePointLists, checkSharePointSchema,
} from './schema-check.js';
export {
  getCurrentUser, getAppSettings, updateAppSettings, getVisitor, createVisitor, updateVisitor, setVisitorEnabled, recordUserVisit, getClient,
  listClients, createClient, updateClient, updateClientWith, deleteClient, getSession, listSessions, createSession, updateSession,
  setSessionParticipationMode, deleteSession, getSection, getSectionContent, listSections, createSection, updateSection, getQuestion, listQuestions,
  createQuestion, updateQuestion, deleteQuestion, getOption, listOptions, createOption, updateOption, deleteOption, getClientTrack, listClientTracks,
  findOpenSession, resumeClientTrack, endSession, reopenSession, getQrToken, listQrTokens, updateQrToken, qrTokenStatus, qrUrl, qrTokenFromSearch,
  getLanUrls, provisionQrToken, listAdminUsers, addAdminUser, responseOwner,
} from './records.js';
