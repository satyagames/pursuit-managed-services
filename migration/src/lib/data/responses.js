// Answers, kept one item per participant (dataService.js section 3; Phase 17 cut it out unchanged): the item's shape and limits, the
// blind save, the read of a session's answers (and of a damaged item, named instead of stopping), a restart, and the list of a session's
// visits. Reads and writes the answers list on both backends; the participant page saves only through lib/participant/participantData.ts.

import { ID } from '../schema/pms-schema.js';
import { RESPONSE, pause, spLiteral } from './encoding.js';
import { getItem, itemPath, listTypes, request, send, sharePoint, spDecode, spEntityType, spHttp, spListPath, spPages, updateItem } from './core.js';
import { failure, versioned } from './records.js';

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

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export {
  PARTICIPANT_SELECT, answerRecord, answerRecords, combineAnswers, decodeResponsesRow, participantFields, participantItem, participants, readAnswers,
  spParticipants,
};
