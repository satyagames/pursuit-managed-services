// A first QR scan in few requests, and a visit begun from Welcome (dataService.js section 4; Phase 17 cut it out unchanged but for its
// five writes of the held scan, which go through core.js's holdScan(), where that state lives). Reads the code, the settings item, the
// session, the client and its activities; writes the visit, the claim on the code (If-Match) and the session's status.

import { ID } from '../schema/pms-schema.js';
import { pause, spEncode } from './encoding.js';
import {
  createItem, deleteItem, getItem, getItemWithVersion, holdScan, isUnreachable, listTypes, queryItems, sharePoint, spByAppId, spDecode, spDigest,
  spEntityType, spEntityTypeAhead, spFind, spHttp, spListPath, spMade, spMerge, spMetadata, spPages, spReadTogether, spTitle, unfinishedScan,
  updateItemIfUnchanged,
} from './core.js';
import { spItemsAddress, spOne, spWrite } from './common.js';
import { failure, getAppSettings, getCurrentUser } from './records.js';
import { getLiveExperience, liveExperienceOf } from './today.js';

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
  return { experience: await experienceFor(records), user: records.user, failure: null, claim, pictureUrl: visitor?.pictureUrl ?? null };
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
