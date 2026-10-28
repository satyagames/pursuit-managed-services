// The records (dataService.js section 2; Phase 17 cut it out unchanged): clients, sessions, activities, questions, options, visits, QR
// codes, the roster and admin users, as plain objects with a string id, and the lists' version check that every page's first read
// makes (PMS-LST-010 to 012). Built only on the generic item calls of core.js; reads and writes those lists, and keeps nothing.

import { ID, LISTS, VERSION, versionSelect } from '../schema/pms-schema.js';
import { indexById, pick, spLiteral } from './encoding.js';
import {
  baseUrl, createItem, deleteItem, fits, getItem, getItemWithVersion, getItems, listItems, onStop, queryItems, readLanUrls, sharePoint, spCreate,
  spFind, spHttp, spListPath, spMerge, updateItem, updateItemIfUnchanged,
} from './core.js';

// ============================================================================
// 2. Public API: the records
// ============================================================================

/** The signed-in SharePoint profile used for the staff welcome flow. */
export async function getCurrentUser() {
  if (!sharePoint) return null;
  const { data } = await spHttp('GET', '/web/currentuser?$select=Id,Title');
  return {
    id: data.Id == null ? null : String(data.Id),
    displayName: typeof data.Title === 'string' ? data.Title.trim() : '',
  };
}

// ---- The lists' version (Phase 10c-2b) ----
// SchemaVersion on the AppSettings item is the version of this site's lists; Setup writes it when it makes them, and nothing here ever
// does. Every page reads that item first, so it is checked on the reads that already happen (getAppSettings, readLists,
// readParticipantWatch) and costs no request. On SharePoint, a missing item, a missing list or no version is PMS-LST-010, a lower
// version PMS-LST-011 and a higher one PMS-LST-012: the page's stop handler is told (it puts its stop screen up) and the code is thrown.
// The words are Setup's (lib/settings/deploy-problems.js). The local server has no version.

/** The coded error for lists that are not this build's, after telling the page. `version` is what the site said (Setup's words use it). */
function listsStop(code, version = null) {
  onStop?.(code);
  return Object.assign(new Error(code), { code, version, wanted: VERSION });
}
/** `settings` (the AppSettings item, or null) when its lists are this build's version; otherwise throws, coded. */
function versioned(settings) {
  if (!sharePoint) return settings;
  const version = settings?.schemaVersion;
  if (version === undefined || version === null) throw listsStop('PMS-LST-010');
  if (version !== VERSION) throw listsStop(version < VERSION ? 'PMS-LST-011' : 'PMS-LST-012', version);
  return settings;
}
/** A read that found no list at all (404) means the lists have not been made: PMS-LST-010. Anything else is as it was. */
const notMade = (error) => { throw sharePoint && error.status === 404 && error.code !== 'item-missing' ? listsStop('PMS-LST-010') : error; };

/**
 * Prompt 21: a read of the item names every column of this build, and a site of an older version lacks some (version 4 has neither setting of
 * version 5), so SharePoint refuses it (400). Then the item's version alone is read, naming only what every version has: an older version is the
 * version's stop (PMS-LST-011), as it was when the read met no new column; anything else is the refusal as it was. One request more, on such a
 * site only.
 */
async function olderItem(error) {
  if (sharePoint && error?.status === 400) {
    const column = LISTS.appsettings.fields.schemaVersion.column;
    const alone = await spHttp('GET', `${spListPath('appsettings')}/items?$filter=${ID} eq ${spLiteral('default')}&$top=1&${versionSelect()}`).catch(() => null);
    const row = alone?.data?.results?.[0];
    if (row && Number.isInteger(row[column]) && row[column] < VERSION) versioned({ schemaVersion: row[column] });
  }
  throw error;
}

export const getAppSettings = async () => versioned(await getItem('appsettings', 'default').catch(notMade).catch(olderItem));

/**
 * Phase 20: a read that names a column the site lacks is refused (400). On lists of an older version that is the version's stop, not the read's:
 * the settings item says which (PMS-LST-011), as it did when the same read met no new column. Anything else is as it was.
 */
const versionFirst = async (error) => {
  if (sharePoint && error?.status === 400) await getAppSettings();
  throw error;
};

export async function updateAppSettings(changes) {
  if (await getAppSettings()) return updateItem('appsettings', 'default', changes);
  try {
    return await createItem('appsettings', { id: 'default', ...changes });
  } catch (error) {
    if (error.status !== 409) throw error;
    return updateItem('appsettings', 'default', changes);
  }
}

/**
 * The codes nobody has scanned, out of codes that were read by an indexed column (SessionId, and VisitorId for one guest). `Used` is a
 * Yes/No column: it is tested here, in the browser, and no request filters on it (Phase 10c-2a), so nothing rests on how SharePoint
 * compares a Yes/No column with a quoted word. A session has a few hundred codes at most.
 */
const unscanned = (tokens) => tokens.filter((token) => !token.used);

export const getVisitor = (id) => getItem('visitorroster', id);
export const createVisitor = (fields) => createItem('visitorroster', fields);
export const updateVisitor = (id, changes) => updateItem('visitorroster', id, changes);
export async function setVisitorEnabled(id, enabled) {
  const visitor = await getVisitor(id);
  if (!visitor) throw failure('visitor-missing', 'That visitor no longer exists.');
  if (enabled !== true) {
    const unused = unscanned(await queryItems('qrtokens', { visitorId: id, sessionId: visitor.sessionId }));
    const expiredAt = new Date().toISOString();
    await Promise.all(unused.map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt })));
  }
  return updateItem('visitorroster', id, { enabled: enabled === true });
}
export async function recordUserVisit(fields) {
  const { visitKey, ...record } = fields;
  const id = fields.id ?? visitKey;
  if (!id) throw new Error('A stable visit id is required.');
  try {
    if (sharePoint) return await spCreate('uservisitlogs', id, { ...record, id });
    return await createItem('uservisitlogs', { ...record, id });
  } catch (error) {
    if (error.status === 409) return { ...record, id };
    throw error;
  }
}

/** A parent's children, in the order of its ID array (e.g. session.sectionIds). */
async function listChildren(parentList, parentId, idsField, childList) {
  const parent = await getItem(parentList, parentId);
  return getItems(childList, parent?.[idsField]);
}

// ---- Clients: who is answering (responses reference them by clientId) ------

export const getClient = (id) => getItem('clients', id);
export const listClients = () => listItems('clients');
export const createClient = (fields) => createItem('clients', fields);
export const updateClient = (id, changes) => updateItem('clients', id, changes);

/**
 * Changes a client from what it holds NOW (Phase 15): reads it with its version, asks `change(client)` for the fields to write, and writes them
 * only if nobody changed the client meanwhile (If-Match on the item's ETag, on SharePoint and on the local server alike); if somebody did, it
 * reads again and asks again, once. So two admins at once both keep their change: the Animations switch and a Brand Studio save each start
 * from the other's result. Two requests on SharePoint (the item, the merge), as `updateClient` makes. Resolves to the client as written.
 * `change` may throw to stop before anything is written.
 * @param {string} id @param {(client: any) => Record<string, unknown>} change
 */
export async function updateClientWith(id, change) {
  for (let attempt = 0; ; attempt += 1) {
    const read = sharePoint ? await spFind('clients', id) : await getItemWithVersion('clients', id);
    if (!read) throw Object.assign(new Error('That client no longer exists.'), { status: 404, code: 'item-missing' });
    const changes = fits('clients', change(read.item));
    try {
      if (sharePoint) return await spMerge('clients', read, changes);
      return { ...read.item, ...(await updateItemIfUnchanged('clients', id, changes, read.etag)) };
    } catch (error) {
      if (error?.status !== 412 || attempt >= 1) throw error;
    }
  }
}
export const deleteClient = (id) => deleteItem('clients', id);

// ---- Sessions: session.sectionIds lists its sections in order ---------------

export const getSession = (id) => getItem('sessions', id);
export const listSessions = () => listItems('sessions');
export const createSession = (fields) => createItem('sessions', fields);
export const updateSession = (id, changes) => updateItem('sessions', id, changes);
export async function setSessionParticipationMode(id, participationMode) {
  if (!['staff', 'client-visit'].includes(participationMode)) throw new Error('Choose Staff or Client Visit mode.');
  const session = await getSession(id);
  if (!session) throw failure('session-missing', 'That session no longer exists.');
  const updated = await updateItem('sessions', id, { participationMode });
  if (participationMode === 'staff' && session.participationMode === 'client-visit') {
    const invitations = unscanned(await queryItems('qrtokens', { sessionId: id }));
    const expiredAt = new Date().toISOString();
    await Promise.all(invitations.filter((token) => token.visitorId)
      .map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt })));
  }
  return updated;
}
export const deleteSession = (id) => deleteItem('sessions', id);

// ---- Sections: section.questionIds lists its questions in order -------------

export const getSection = (id) => getItem('sections', id);
export async function getSectionContent(id) {
  const section = await getSection(id);
  if (!section) return null;
  const questions = await getItems('questions', section.questionIds);
  const options = indexById(await getItems('options', [...new Set(questions.flatMap((question) => question.optionIds ?? []))]));
  return { section, questions: questions.map((question) => ({ ...question, options: pick(options, question.optionIds) })) };
}

/** A session's sections in order; every section if no sessionId is given. */
export const listSections = (sessionId) =>
  sessionId === undefined ? listItems('sections') : listChildren('sessions', sessionId, 'sectionIds', 'sections');
export const createSection = (fields) => createItem('sections', fields);
export const updateSection = (id, changes) => updateItem('sections', id, changes);

// ---- Questions: question.optionIds lists its options in order ---------------

export const getQuestion = (id) => getItem('questions', id);
/** A section's questions in order; every question if no sectionId is given. */
export const listQuestions = (sectionId) =>
  sectionId === undefined ? listItems('questions') : listChildren('sections', sectionId, 'questionIds', 'questions');
export const createQuestion = (fields) => createItem('questions', fields);
export const updateQuestion = (id, changes) => updateItem('questions', id, changes);
export const deleteQuestion = (id) => deleteItem('questions', id);

// ---- Options ----------------------------------------------------------------

export const getOption = (id) => getItem('options', id);
/** A question's options in order; every option if no questionId is given. */
export const listOptions = (questionId) =>
  questionId === undefined ? listItems('options') : listChildren('questions', questionId, 'optionIds', 'options');
export const createOption = (fields) => createItem('options', fields);
export const updateOption = (id, changes) => updateItem('options', id, changes);
export const deleteOption = (id) => deleteItem('options', id);

// ---- Client tracks: one per iPad in a session --------------------------------
// A track (its id is the `clientTrackId`) is one iPad's independent run through a
// session. Several tracks share one sessionId and their answers merge into that
// session's results as each is saved. A track points at its session
// (track.sessionId) instead of the session listing its tracks: creating a record
// can't clash with another iPad joining at the same moment, whereas appending to a
// shared array could silently drop one of them.

/** An Error with a machine-readable `code`. Its message is worded for the person at the iPad. */
const failure = (code, message) => Object.assign(new Error(message), { code });

export const getClientTrack = (id) => getItem('tracks', id);
/** A session's tracks in the order they joined; every track if no sessionId is given. */
export const listClientTracks = (sessionId) =>
  sessionId === undefined ? listItems('tracks') : queryItems('tracks', { sessionId });
/** The client's session that hasn't ended, or null. */
export async function findOpenSession(clientId) {
  const sessions = await queryItems('sessions', { clientId });
  return sessions.find((session) => session.status !== 'completed') ?? null;
}

/**
 * Finds a track again after the iPad disconnected or the page reloaded. The track's
 * id travels in the URL hash, so the app can look it up and carry on where the
 * client left off. Resolves to the track, or null if it no longer exists; throws
 * if its session has ended.
 */
export async function resumeClientTrack(clientTrackId) {
  const track = await getItem('tracks', clientTrackId);
  const session = track && (await getItem('sessions', track.sessionId));
  if (!session) return null;
  const settings = await getAppSettings();
  if (settings && settings.activeSessionId !== track.sessionId) {
    throw failure('session-not-active', 'This visit is no longer the active session. Ask your facilitator for help.');
  }
  if (session.status === 'completed') throw failure('session-ended', 'This session has ended.');
  return updateItem('tracks', track.id, {
    lastResumedAt: new Date().toISOString(),
    resumeCount: (track.resumeCount ?? 0) + 1,
  });
}

/**
 * Admin: ends a session. QR codes nobody has scanned yet end with it: they are
 * marked used, so a scan can no longer start a track.
 */
export async function endSession(sessionId) {
  const now = new Date().toISOString();
  const session = await updateItem('sessions', sessionId, { status: 'completed', endedAt: now });
  const waiting = unscanned(await queryItems('qrtokens', { sessionId }));
  await Promise.all(waiting.map((token) => updateItem('qrtokens', token.id, { used: true, expiredAt: now })));
  return session;
}

/** Admin: reopens an ended session. Codes that expired with it stay dead; provision new ones. */
export async function reopenSession(sessionId) {
  const started = (await listClientTracks(sessionId)).length > 0;
  return updateItem('sessions', sessionId, { status: started ? 'in-progress' : 'not-started', endedAt: null });
}

// ---- QR tokens: a token's id is the value encoded in its QR code ------------
// Lifecycle: an admin provisions a token for a client (provisionQrToken); the QR
// code encodes qrUrl(); the first scan claims it (openQrScan, section 4), which creates
// a fresh client track, marks the token used and links the two. A later scan is
// rejected, and so is a token whose session has ended. Once claimed, an iPad that
// reloads finds its track again through the URL hash (resumeClientTrack), not by
// scanning again.

export const getQrToken = (token) => getItem('qrtokens', token);
export const listQrTokens = () => listItems('qrtokens');
export const updateQrToken = (token, changes) => updateItem('qrtokens', token, changes);

/** 'unused', 'used' (scanned) or 'expired' (its session ended before anyone scanned it). */
export const qrTokenStatus = (token) => (token.expiredAt ? 'expired' : token.used ? 'used' : 'unused');

const QR_PARAM = 'qr';

/** The URL a QR code encodes. `baseUrl` is where the iPads reach the app, e.g. http://192.168.1.20:3000. */
export const qrUrl = (tokenId, baseUrl) => {
  const url = new URL(baseUrl);
  if (!/\.html$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  url.search = new URLSearchParams({ [QR_PARAM]: tokenId }).toString();
  url.hash = '';
  return url.href;
};

/** The token in a page's query string (what a scanned QR code opened the app with), or null. */
export const qrTokenFromSearch = (search) => new URLSearchParams(search).get(QR_PARAM);

/** Addresses other devices on the network can reach the app at (dev server only), best first. */
export const getLanUrls = () => readLanUrls();

/**
 * Admin: pre-provisions a single-use QR token for a client. It joins `sessionId`,
 * or the client's open session if none is given.
 */
/** @param {string} clientId @param {string} [sessionId] @param {{ visitorId?: string | null }} [options] */
export async function provisionQrToken(clientId, sessionId, options = {}) {
  const { visitorId = null } = options;
  const settings = await getAppSettings();
  const client = await getItem('clients', clientId);
  if (!client) throw failure('client-missing', 'That client no longer exists.');
  const targetSessionId = sessionId ?? settings?.activeSessionId;
  const session = targetSessionId ? await getSession(targetSessionId) : await findOpenSession(clientId);
  if (!session) throw failure('session-missing', `${client.name} has no open session to join.`);
  if (settings && settings.activeSessionId !== session.id) {
    throw failure('session-not-active', 'Choose the active session in User Setup before creating a check-in code.');
  }
  if (session.clientId !== clientId) throw failure('client-session-mismatch', 'The selected session belongs to a different client.');
  if (session.status === 'completed') throw failure('session-ended', `${client.name}'s session has ended.`);
  const participationMode = session.participationMode ?? 'staff';
  if (participationMode === 'client-visit') {
    if (!visitorId) throw failure('visitor-required', 'Select a visitor before creating a QR code.');
    const visitor = await getVisitor(visitorId);
    if (!visitor || visitor.sessionId !== session.id || visitor.enabled === false) {
      throw failure('visitor-missing', 'That visitor is not enabled for this session.');
    }
  } else if (visitorId) {
    throw failure('unexpected-visitor', 'Visitor QR codes are only available in client visit mode.');
  }
  return createItem('qrtokens', {
    clientId,
    sessionId: session.id,
    visitorId,
    used: false,
    createdAt: new Date().toISOString(),
    usedAt: null,
    clientTrackId: null, // set when it is scanned
  });
}

// ---- Admin users --------------------------------------------------------------

/** The facilitators, at the admin page's PIN: its first read, so a site whose lists were never made says PMS-LST-010 here. */
export const listAdminUsers = () => listItems('adminusers').catch(notMade);
/** A facilitator, as Setup adds one (Phase 10c-3, migration/src/lib/setup/setup-admins.js): { id, name, pin }, where `pin` is the hash lib/admin/admin-pin.js compares. */
export const addAdminUser = (fields) => createItem('adminusers', fields);

// ---- Responses ----------------------------------------------------------------

/**
 * Whose answer this is: its client track, or (answers saved before tracks
 * existed) its client. Null if anonymous.
 */
export const responseOwner = (response) => response.clientTrackId ?? response.clientId ?? null;

// Shared with the other parts of lib/data (dataService.js does not pass these on).
export { failure, notMade, unscanned, versionFirst, versioned };
