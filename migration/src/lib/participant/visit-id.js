// The id of the visit "Click here to begin" makes. Plain JS with JSDoc and no DOM, so `node --test` imports it.
//
// dataService.beginVisit() takes the visit's id from the page, so that a press whose reply never arrived, pressed again, finds the
// visit it already made instead of making a second one. That only works if the second press uses the same id, so the id is kept
// here for as long as the outcome of a try is not known: one for each session (a try for one session must never be offered to
// another), and forgotten the moment a visit is known to have begun, so that the next visit to that session is a new one.
// Held in memory only: a reloaded page starts afresh, as it always did.

/** @type {Map<string, string>} session id -> the id of a visit whose making is not known to have finished */
const pending = new Map();

/**
 * A new visit id. `randomUUID` exists only on https and on localhost; on the dev server's LAN address the bytes are drawn directly.
 * @param {{ randomUUID?: () => string, getRandomValues: (bytes: Uint8Array) => Uint8Array }} [source]
 */
export function newVisitId(source = globalThis.crypto) {
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  return Array.from(source.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The id to begin a visit to `sessionId` with: the one an unfinished try already used, else a new one. @param {string} sessionId */
export function visitIdFor(sessionId) {
  let id = pending.get(sessionId);
  if (!id) pending.set(sessionId, id = newVisitId());
  return id;
}

/** The visit was made (the page holds its track): the next visit to that session gets a new id. @param {string} sessionId */
export function visitBegun(sessionId) {
  pending.delete(sessionId);
}
