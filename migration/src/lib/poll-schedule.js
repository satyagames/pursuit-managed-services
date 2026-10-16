// When a page that stays open looks at the server again. Plain JS with JSDoc and no DOM, so
// scripts/test-polling.js can hold every rule to its number.
//
// The budget (PMS-IMPLEMENTATION-PLAN.md 4.3, in git history at 7347c72; MIGRATION-PLAN.md "Polling budget"): SharePoint Online allows
// 3,000 requests per signed-in user per 5 minutes, and ten iPads can share one account. A participant page that
// is only waiting (Welcome, the Activities hub, the finale, "not live yet") may use 4 requests a minute on
// average; it uses 3. While a question is on screen the traffic is the answers it saves, so the page looks
// again only once a minute. A check is ONE request (a $batch of reads, dataService.readParticipantWatch), and
// where a site cannot batch the wait grows with what the check really cost, so the rate stays the same.

/**
 * @typedef {'idle' | 'question'} PollMode
 *   idle: Welcome, the hub, the finale, "not live yet" (nothing is being answered).
 *   question: a question (or an activity's completion screen) is on screen.
 */

export const POLL = Object.freeze({
  /** Checks a minute, waiting. 3 a minute is 20 s between checks: under the 4 allowed, with room for the one when a hidden tab returns. */
  idlePerMinute: 3,
  /** Checks a minute with a question on screen: one slow one. */
  questionPerMinute: 1,
  /** The local Express server has no throttle: it is checked every 3 s, as before, with no jitter. */
  localMs: 3000,
  /** Each wait is stretched or shortened by up to this fraction at random, so iPads that opened together do not check together. */
  jitter: 0.2,
  /** Never two checks closer than this, whatever woke the page (a tab coming back, the network returning, a change of screen). */
  minGapMs: 5000,
  /** The longest a failing page waits between tries. */
  maxBackoffMs: 5 * 60_000,
  /**
   * The longest a Retry-After is obeyed for. SharePoint asks for seconds to a few minutes; a wait of hours would leave a page that
   * looks dead, and a number too big for a timer (2^31 ms) makes the timer fire at once, which is the opposite of waiting.
   */
  maxRetryAfterMs: 15 * 60_000,
});

/** A Retry-After in milliseconds as a wait that can be kept: 0 for none or an unreadable one, and never longer than POLL.maxRetryAfterMs. */
const askedWait = (retryAfterMs) => (Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.min(retryAfterMs, POLL.maxRetryAfterMs) : 0);

/**
 * How long to wait before the next check, in milliseconds.
 * @param {object} [options]
 * @param {PollMode} [options.mode]
 * @param {boolean} [options.local] the local server: a flat 3 s, no jitter (a Retry-After is still honoured)
 * @param {number} [options.requests] what the last check cost (1 for a batch); the wait is that many times longer, so the rate holds
 * @param {number} [options.failures] checks that failed in a row: the wait doubles with each, up to POLL.maxBackoffMs
 * @param {number} [options.retryAfterMs] a Retry-After from a 429 or 503: the wait is never shorter than this
 * @param {() => number} [options.random] 0 to 1, for tests
 */
export function nextDelay({ mode = 'idle', local = false, requests = 1, failures = 0, retryAfterMs = 0, random = Math.random } = {}) {
  const asked = askedWait(retryAfterMs);
  if (local) return Math.max(POLL.localMs, asked);
  const perMinute = mode === 'question' ? POLL.questionPerMinute : POLL.idlePerMinute;
  let base = Math.round((60_000 / perMinute) * Math.max(1, Math.round(requests) || 1));
  if (failures > 0) base = Math.min(POLL.maxBackoffMs, base * 2 ** Math.min(failures, 6));
  const jittered = base * (1 + (random() * 2 - 1) * POLL.jitter);
  // Retry-After is a floor: the jitter on it only ever makes the wait longer.
  return Math.round(Math.max(jittered, asked * (1 + random() * POLL.jitter)));
}

/** The facilitator's Live display: one feed read every 12 s on SharePoint (5 a minute; the structure read every 5 minutes makes it under 6), 2 s on the local server. */
export const LIVE_DISPLAY = Object.freeze({ sharePointMs: 12_000, localMs: 2000 });

/**
 * The wait between two refreshes of an admin screen that polls (the Live display): a fixed interval, no jitter (one facilitator, one
 * page), longer by what the last refresh cost, doubled for each failure in a row, and never shorter than a Retry-After.
 * @param {object} [options]
 * @param {number} [options.sharePointMs] @param {number} [options.localMs] @param {boolean} [options.local]
 * @param {number} [options.requests] @param {number} [options.failures] @param {number} [options.retryAfterMs]
 */
export function adminDelay({ sharePointMs = LIVE_DISPLAY.sharePointMs, localMs = LIVE_DISPLAY.localMs, local = false, requests = 1, failures = 0, retryAfterMs = 0 } = {}) {
  const asked = askedWait(retryAfterMs);
  if (local) return Math.max(localMs, asked);
  const base = sharePointMs * Math.max(1, Math.round(requests) || 1);
  return Math.round(Math.max(Math.min(POLL.maxBackoffMs, base * 2 ** Math.min(failures, 6)), asked));
}

/**
 * Which kind of screen a route is. A question or an activity's completion screen (`/quiz/<id>`, and the old
 * `/feedback/<id>` that only redirects into it) is "question"; everything else a participant sees is "idle".
 * @param {string} location the router's location, e.g. '/quiz/sec-trivia'
 * @returns {PollMode}
 */
export const modeOf = (location) => (/^\/(quiz|feedback)\//.test(location ?? '') ? 'question' : 'idle');

/** Routes that show the "this session has ended" notice instead of their own screen once the session has ended: Welcome and the hub. */
export const ENDED_NOTICE_ROUTES = Object.freeze(['/', '/welcome', '/agenda']);

/** Does the "session ended" notice replace the screen at `location`? A participant mid-activity finishes it; the finale stays as it is. */
export const showsEndedNotice = (location) => ENDED_NOTICE_ROUTES.includes((location ?? '').split('?')[0] || '/');

/** Has the facilitator ended this session? (`Sessions.Status` is 'completed' once End session was pressed, and goes back on Reopen.) */
export const sessionHasEnded = (session) => session?.status === 'completed';
