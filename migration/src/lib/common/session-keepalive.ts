// The admin page's keep-alive (Prompt 19): most refused sign-ins are the first request after a tab sat idle or a laptop slept, so the page
// checks its sign-in itself, with one light read (dataService.checkSession(), GET /_api/web?$select=Id), and the data layer's ladder runs
// while the person is still looking, not when they press something. It costs nothing while the page is busy: it checks only when no request
// has been answered for SESSION_LIMITS.idleMs (any answer resets that), at once when the tab is shown again after that long, and never while
// the tab is hidden (lib/common/page-watch.ts, the one timer: a hidden tab has none). On the local server it is never started. It can renew
// what SharePoint will renew; it cannot outlast a tenant policy that ends sessions (docs/SHAREPOINT.md, "Sessions, tokens and the 403").
import { createPageWatcher, type PageWatcher } from './page-watch.js';
import { POLL } from './poll-schedule.js';
import { SESSION_LIMITS } from '../data/session.js';

type Api = { checkSession(): Promise<{ requests: number }>; lastAnswerAt(): number };

/** How long until the page has been idle for `idleMs` (0 when it has been), and never sooner than POLL.minGapMs from now. */
export function keepAliveWait(now: number, lastAnswer: number, idleMs = SESSION_LIMITS.idleMs): number {
  return Math.max(POLL.minGapMs, idleMs - (now - lastAnswer));
}

/** The watcher (not started): start() it once the admin is in, stop() it on lock. */
export function createKeepAlive(api: Api, { idleMs = SESSION_LIMITS.idleMs, now = () => Date.now() } = {}): PageWatcher {
  const idle = () => now() - api.lastAnswerAt() >= idleMs;
  return createPageWatcher({
    // (Idle or not is decided inside the check, not by `enabled`: a check that `enabled` skips finishes at once, and page-watch.ts then keeps
    // that finished check as the one "running", so the watcher would never check again.)
    check: async () => (idle() ? api.checkSession() : { requests: 0 }),
    // (A check that failed waits a whole idle time: a sign-in the ladder could not renew is not asked about every few seconds.)
    wait: ({ failures }) => (failures ? idleMs : keepAliveWait(now(), api.lastAnswerAt(), idleMs)),
    now,
  });
}
