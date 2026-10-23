// What a refused SharePoint request means, and the rules of recovering from it (Prompt 19). Plain JS with no DOM and no state of its own: the
// rule book every 401, 403 and sign-in page is classified by (REFUSALS, classifyRefusal), the waits (SESSION_LIMITS), the shape of the in-memory
// evidence of a refusal (refusalEvidence, evidenceLine), and the ladder's single flight and cooldown (recoverSession), which work on the state
// object core.js holds (newSessionState). core.js runs the ladder on every request it sends; nothing here sends one.
//
// Two tokens, two refusals. The write token (the request digest, from /contextinfo) goes stale: SharePoint says "security validation", the
// token is asked for again and the write sent once more, as it has been since Phase 6. The sign-in (the browser's cookies for the site) can stop
// being accepted while a tab stays open: SharePoint then refuses a plain read, which carries no write token, with "Access denied" (seen on PCOE,
// Clients, after the admin page had been open a while). ASSUMED: SharePoint renews the sign-in when a person navigates on the site, not on a
// fetch(), which is why a reload cures it and why Step B navigates a hidden frame.

/** The waits of the ladder and the keep-alive. A test may shorten the first three (core.js setSessionRenewer). */
export const SESSION_LIMITS = Object.freeze({
  /** Step A's pause before the fresh token, from the first to the second (jittered, so ten tabs do not ask at once). */
  pauseMs: Object.freeze([250, 750]),
  /** How long Step B waits for its frame to load. */
  renewTimeoutMs: 10_000,
  /** After a recovery that failed, refusals are not recovered again for this long (a dead sign-in must not loop). */
  cooldownMs: 5_000,
  /** How many refusals the evidence keeps (in memory only). */
  evidenceKept: 20,
  /** The admin page's keep-alive: a page with no answer for this long checks its sign-in (when shown again, or while shown). */
  idleMs: 10 * 60_000,
});

/**
 * Every kind of refusal, in the order they are tried: the first row a refusal matches is its kind. `status`, `code` (SharePoint's error code,
 * the number before its comma), `words` (its message) and `signInPage` (the answer was not JSON) must all match where a row names them.
 * `digest` and `busy` come first, so that nothing they cover is ever taken for a sign-in. A `session` 403 after the sign-in was proven to work
 * is a `permission` (classifyRefusal's `proven`).
 */
export const REFUSALS = Object.freeze([
  // A stale request digest: SharePoint's SPException "The security validation for this page is invalid" (the code is ASSUMED, not captured).
  Object.freeze({ kind: 'digest', status: 403, code: '-2130575252' }),
  // The same by its words: what core.js has matched since Phase 6, and what the fake answers a write with a stale token.
  Object.freeze({ kind: 'digest', status: 403, words: /security validation|request digest/i }),
  // SharePoint Online throttling (429, 503, with Retry-After: docs/SHAREPOINT.md) and a gateway timeout on the way to it.
  Object.freeze({ kind: 'busy', status: 429 }),
  Object.freeze({ kind: 'busy', status: 503 }),
  Object.freeze({ kind: 'busy', status: 504 }),
  // A request with no sign-in SharePoint accepts (Phase 9a, F-2).
  Object.freeze({ kind: 'session', status: 401 }),
  // A sign-in page where JSON was expected: an expired sign-in (Phase 9a, F-2).
  Object.freeze({ kind: 'session', signInPage: true }),
  // System.UnauthorizedAccessException: ASSUMED to be the code of the refusal seen on the real site, until QA-TESTING.md's capture.
  Object.freeze({ kind: 'session', status: 403, code: '-2147024891' }),
  // The real site, Oct 2026: "Access denied. You do not have permission..." on a plain read of Clients after the admin tab had been open a while.
  Object.freeze({ kind: 'session', status: 403, words: /access denied|you do not have permission/i }),
]);

/** SharePoint's error code and words in a refusal (its parsed JSON, or its text); none when it is not JSON. */
export function refusalWords(answer) {
  try {
    const error = (typeof answer === 'string' ? JSON.parse(answer) : answer)?.error;
    return { code: error?.code, message: typeof error?.message === 'string' ? error.message : error?.message?.value };
  } catch { return {}; }
}

const matches = (row, { status, number, message, sawSignInPage }) => (row.signInPage ? Boolean(sawSignInPage) : row.status === status)
  && (row.code === undefined || row.code === number) && (row.words === undefined || row.words.test(message));

/**
 * The kind of a refused request: 'digest' | 'session' | 'permission' | 'busy' | 'other'. `proven`: the sign-in was shown to work after this
 * request was refused (a fresh token, or a renewal and its light read), so a 403 that still happens is the account, not the sign-in.
 * `method` is for the evidence; it does not change the kind.
 * @param {{ status?: number, code?: unknown, message?: unknown, method?: string, sawSignInPage?: boolean, proven?: boolean }} refusal
 */
export function classifyRefusal({ status, code, message, sawSignInPage = false, proven = false }) {
  const facts = { status, number: String(code ?? '').split(',')[0].trim(), message: String(message ?? ''), sawSignInPage };
  const kind = REFUSALS.find((row) => matches(row, facts))?.kind ?? 'other';
  return kind === 'session' && proven && status === 403 ? 'permission' : kind;
}

/** The state core.js keeps for the ladder (one per page; configure() makes a new one, keeping the page's renewer and listeners). */
export function newSessionState(previous) {
  return {
    renewer: previous?.renewer ?? null, listeners: previous?.listeners ?? new Set(), limits: previous?.limits ?? SESSION_LIMITS,
    evidence: [], recovering: null, coolUntil: 0, failed: null, lost: null, denied: new Set(), answeredAt: Date.now(),
  };
}

/**
 * What a refusal leaves in the evidence: when it happened (ms since the page loaded and since its last answer), whether the tab was shown, the
 * method, the list's KEY (never an item id, a name or an answer), the status, SharePoint's error code and the SPRequestGuid and
 * X-SharePointHealthScore it sent. Never stored, never sent: shown in the banner's Details and Setup's self-test.
 */
export function refusalEvidence(state, { method, list, status, code, headers }) {
  const entry = Object.freeze({
    sinceLoadMs: Math.round(globalThis.performance?.now() ?? 0), sinceAnswerMs: Date.now() - state.answeredAt,
    visibility: globalThis.document?.visibilityState ?? 'none', method, list: list ?? null, status, code: code ? String(code).split(',')[0].trim() : null,
    requestGuid: headers?.get?.('SPRequestGuid') ?? null, health: headers?.get?.('X-SharePointHealthScore') ?? null,
  });
  state.evidence = [...state.evidence, entry].slice(-state.limits.evidenceKept);
  return entry;
}

const minutes = (ms) => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);
/** One refusal as the Details line says it: "403 · -2147024891 · GET clients · SPRequestGuid … · 12 min since the last answer". */
export function evidenceLine(entry) {
  return [entry.status, entry.code, `${entry.method} ${entry.list ?? 'the site'}`, entry.requestGuid && `SPRequestGuid ${entry.requestGuid}`,
    entry.health && `health ${entry.health}`, `${minutes(entry.sinceAnswerMs)} since the last answer`, entry.visibility === 'hidden' && 'tab hidden']
    .filter(Boolean).join(' · ');
}

/**
 * The ladder's recovery, once for every request refused meanwhile (single flight), and not again within the cooldown after it failed:
 * Step A, a jittered pause and `fresh()` (a fresh write token, which proves the sign-in); else Step B, the renewer and `prove()` (one light
 * read). Resolves to { proven, step: 'A' | 'B' | null, renewable }; `renewable` is false where the page has no renewer. Never throws.
 * @param {ReturnType<typeof newSessionState>} state
 * @param {{ fresh: () => Promise<unknown>, prove: () => Promise<unknown>, pause: (ms: number) => Promise<void> }} steps
 */
export function recoverSession(state, { fresh, prove, pause }) {
  if (state.recovering) return state.recovering;
  if (state.failed && Date.now() < state.coolUntil) return Promise.resolve(state.failed);
  const works = (step) => step().then(() => true, () => false);
  const [low, high] = state.limits.pauseMs;
  state.recovering = (async () => {
    await pause(low + Math.random() * (high - low));
    if (await works(fresh)) return { proven: true, step: 'A', renewable: Boolean(state.renewer) };
    if (!state.renewer) return { proven: false, step: null, renewable: false };
    const renew = state.renewer;
    let timer;
    await Promise.race([Promise.resolve().then(renew).catch(() => false), new Promise((resolve) => { timer = setTimeout(resolve, state.limits.renewTimeoutMs, false); })]);
    clearTimeout(timer);
    if (await works(prove)) return { proven: true, step: 'B', renewable: true };
    return { proven: false, step: 'B', renewable: true };
  })().then((outcome) => {
    state.recovering = null;
    state.failed = outcome.proven ? null : outcome;
    if (!outcome.proven) state.coolUntil = Date.now() + state.limits.cooldownMs;
    return outcome;
  });
  return state.recovering;
}

/**
 * What the ladder does with a refused request once the page has recovered, or not: 'again' (send it once more: `again` says it has not been
 * sent twice, `safe` that it is a read, which Step A may send again; a write goes again only after Step B renewed the sign-in), 'permission'
 * (a 403 with the sign-in proven), 'lost' (the renewal failed), or 'as-is' (thrown as it always was: no renewer on this page, or a refusal the
 * sign-in being proven does not explain).
 */
export function ladderVerdict({ recovery, again, safe, status, code, message }) {
  if (recovery.proven && again && (safe || recovery.step === 'B')) return 'again';
  if (recovery.proven) return classifyRefusal({ status, code, message, proven: true }) === 'permission' ? 'permission' : 'as-is';
  return recovery.renewable ? 'lost' : 'as-is';
}

/** The words of a sign-in that could not be renewed (the error's message; the admin's banner says them too). */
export const SESSION_LOST_WORDS = 'Your SharePoint sign-in needs refreshing. Reload this page to carry on.';

/**
 * The typed error of a sign-in that could not be renewed (status 401, `code: 'session-lost'`), with SharePoint's status and words only in its
 * `details`; the page's listeners hear 'lost' the first time.
 */
export function sessionLost(state, error, evidence) {
  const lost = Object.assign(new Error(SESSION_LOST_WORDS), {
    status: 401, code: 'session-lost', sharePointStatus: evidence.status, details: `${error.message} (${evidenceLine(evidence)})`, evidence,
  });
  if (!state.lost) for (const listener of state.listeners) listener({ state: 'lost', error: lost });
  state.lost = lost;
  return lost;
}

/** Every answer: when it came (the keep-alive's measure); the cooldown is over; a sign-in said to be lost is back. */
export function noteAnswer(state) {
  state.answeredAt = Date.now();
  state.failed = null;
  if (!state.lost) return;
  state.lost = null;
  for (const listener of state.listeners) listener({ state: 'back' });
}
