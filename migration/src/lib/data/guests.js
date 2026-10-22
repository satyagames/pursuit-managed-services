// Guests in bulk (dataService.js section 6; Phase 17 cut it out unchanged): adding guests to a session's list and making their QR
// codes, paced (common.js runPaced), with the name a guest list compares. Reads the session and its guests; writes the roster and QR
// codes.

import { createItem, getItem, queryItems } from './core.js';
import { PACE, runPaced } from './common.js';
import { failure } from './records.js';
import { readLists } from './today-clients.js';
/** @typedef {import('./common.js').PaceOptions} PaceOptions */

/** One name, as the guest list compares it: Unicode-normalised, whitespace collapsed, case ignored. */
export const guestNameKey = (name) => String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

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
