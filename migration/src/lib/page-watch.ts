import { POLL, nextDelay, type PollMode } from './poll-schedule.js';

/**
 * The timer of a page that stays open (the participant page's look at what the facilitator did). The rules,
 * which scripts/test-polling.js and the Playwright polling specs hold:
 *
 *   - One timer, rescheduled after every check (never an interval), so each wait gets its own jitter.
 *   - A hidden tab sends nothing; when it is shown again it checks once at once, then carries on.
 *   - The wait depends on what is on screen (`mode`) and on what the last check cost.
 *   - A failed check backs off, and a 429 or 503's Retry-After is a floor for the wait.
 *   - Never two checks at once, and a tab that comes back is not looked at again within POLL.minGapMs of the last look (the network
 *     coming back is: that look is the one the page needs).
 */
export type PageWatcher = {
  /** Begin: the first check is one wait from now (the page has just read everything). */
  start(): void;
  /** Stop for good (the page is going away). */
  stop(): void;
  /** Check now (a button, or the network came back): resolves when that check is over. A check already running is not doubled. */
  checkNow(): Promise<void>;
  /** The screen changed kind (a question opened or closed): reschedule from the last check, with the new wait. */
  replan(): void;
};

type Check = () => Promise<{ requests?: number } | void>;

export function createPageWatcher({ check, mode = () => 'idle', enabled = () => true, local = false, wait, now = () => Date.now(), random = Math.random }: {
  check: Check;
  mode?: () => PollMode;
  /** Another rule for the wait (the admin's Live display has its own): given what the last check cost and how many failed in a row. */
  wait?: (state: { requests: number; failures: number; retryAfterMs: number; local: boolean }) => number;
  /** False while the page cannot be checked (still starting, a preview, an error screen): the timer runs, the check is skipped. */
  enabled?: () => boolean;
  local?: boolean;
  now?: () => number;
  random?: () => number;
}): PageWatcher {
  let timer: number | undefined;
  let started = false;
  let running: Promise<void> | null = null;
  let lastEnd = now();
  let lastRequests = 1;
  let failures = 0;
  let retryAfterMs = 0;

  const clear = () => { window.clearTimeout(timer); timer = undefined; };
  const delay = () => (wait ? wait({ requests: lastRequests, failures, retryAfterMs, local }) : nextDelay({ mode: mode(), local, requests: lastRequests, failures, retryAfterMs, random }));

  function schedule(wait = delay()) {
    clear();
    if (!started || document.hidden) return;
    timer = window.setTimeout(() => { timer = undefined; if (!document.hidden) void run(); }, wait);
  }

  function run(): Promise<void> {
    if (running) return running;
    running = (async () => {
      try {
        if (enabled()) {
          const result = await check();
          lastRequests = Math.max(1, Math.round(result?.requests ?? 1));
          failures = 0;
          retryAfterMs = 0;
        }
      } catch (cause) {
        failures += 1;
        const asked = (cause as { retryAfter?: number } | null)?.retryAfter;
        retryAfterMs = typeof asked === 'number' && Number.isFinite(asked) ? asked : 0;
      } finally {
        running = null;
        lastEnd = now();
        schedule();
      }
    })();
    return running;
  }

  /** Check now unless one ran less than POLL.minGapMs ago, in which case wait out the rest of that gap. */
  function checkSoon(): Promise<void> {
    if (running) return running;
    const since = now() - lastEnd;
    if (since >= POLL.minGapMs) { clear(); return run(); }
    schedule(POLL.minGapMs - since);
    return Promise.resolve();
  }

  const onVisibility = () => {
    if (document.hidden) clear();
    else if (started) void checkSoon();
  };
  // The network came back: look at once (it is the moment the page most needs to), without waiting out the gap.
  const onOnline = () => { if (started && !running) { clear(); void run(); } };

  return {
    start() {
      if (started) return;
      started = true;
      lastEnd = now();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('online', onOnline);
      schedule();
    },
    stop() {
      started = false;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    },
    checkNow() {
      if (running) return running;
      clear();
      return run();
    },
    replan() {
      if (!started || running) return;
      const sinceLast = now() - lastEnd;
      // The next check falls one new wait after the last one, but not sooner than the minimum gap.
      schedule(Math.max(0, delay() - sinceLast, POLL.minGapMs - sinceLast));
    },
  };
}
