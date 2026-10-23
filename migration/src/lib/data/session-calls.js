// The calls a page makes about its SharePoint sign-in (Prompt 19): it gives the data layer its renewer (Step B of the ladder: the entries
// hand it lib/common/session-renewer.ts's hidden frame), listens for a sign-in lost and back (the admin's banner), reads the evidence of
// the last refusals (the banner's Details, Setup's self-test), and makes the keep-alive's one light read. The state is core.js's `session`
// (lib/data/session.js says what is in it); this part only reads it and sets the two things a page wires in. Local server: nothing is sent.

import { SESSION_LIMITS } from './session.js';
import { session, sharePoint, spHttp } from './core.js';

/**
 * The function Step B calls to renew the sign-in (resolves when it has done what it can; it never needs to say whether it worked: the light read
 * after it does). null: none, and a refusal Step A cannot mend is thrown as it always was. `waits` shortens the ladder's waits, for a test.
 * @param {(() => Promise<unknown>) | null} renewer
 * @param {{ pauseMs?: number[], renewTimeoutMs?: number, cooldownMs?: number }} [waits]
 */
export function setSessionRenewer(renewer, waits) {
  session.renewer = renewer ?? null;
  session.limits = waits ? Object.freeze({ ...SESSION_LIMITS, ...waits }) : SESSION_LIMITS;
}

/**
 * Calls `listener({ state: 'lost', error })` when a sign-in could not be renewed (the error is the typed `session-lost` one), and
 * `listener({ state: 'back' })` when a request is answered after that. Returns the function that stops it.
 */
export function onSessionChange(listener) {
  session.listeners.add(listener);
  return () => { session.listeners.delete(listener); };
}

/** The last refusals of the sign-in (at most 20, oldest first), as lib/data/session.js's refusalEvidence() records them. A copy. */
export const sessionEvidence = () => [...session.evidence];

/** When the page last had an answer from SharePoint (ms, as Date.now()); the page's start when it has had none. */
export const lastAnswerAt = () => session.answeredAt;

/** The keep-alive's light read, `GET /_api/web?$select=Id`, through the ladder like any other. Resolves to what it cost. Nothing on the local server. */
export async function checkSession() {
  if (!sharePoint) return { requests: 0 };
  await spHttp('GET', '/web?$select=Id');
  return { requests: 1 };
}
