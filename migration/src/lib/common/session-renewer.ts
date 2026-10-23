// Step B of the data layer's sign-in ladder (Prompt 19, lib/data/session.js): renew the SharePoint sign-in by NAVIGATING, out of sight, to a
// small file of the site, because SharePoint renews its sign-in cookies on a navigation and not reliably on a fetch() (ASSUMED until
// QA-TESTING.md's check on the real site). The file is the page's own pms-config.txt (a few hundred bytes, in the page's own folder, which
// every account that can open the page can read). A hidden, sandboxed frame is made, waits for `load` (or gives up after the timeout), and is
// removed; it never navigates the top page (no allow-top-navigation), never downloads (no allow-downloads), and never throws: if sign-in
// framing rules block it, the light read after it says the sign-in is still refused and the ladder moves on. Installed by lib/settings/start.ts
// on SharePoint only. Touches the DOM; stores nothing.
import { SESSION_LIMITS } from '../data/session.js';
import { SETTINGS_FILE } from '../settings/deploy-settings.js';

/** A renewer for `pageUrl`'s site: resolves true when the frame loaded, false when it did not (never rejects). */
export function frameRenewer(pageUrl: string, timeoutMs = SESSION_LIMITS.renewTimeoutMs): () => Promise<boolean> {
  return () => new Promise<boolean>((resolve) => {
    let frame: HTMLIFrameElement | null = null;
    let timer = 0;
    const done = (loaded: boolean) => {
      window.clearTimeout(timer);
      frame?.remove();
      frame = null;
      resolve(loaded);
    };
    try {
      frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.title = '';
      frame.hidden = true;
      frame.dataset.sessionRenewer = '';
      frame.addEventListener('load', () => done(true), { once: true });
      frame.addEventListener('error', () => done(false), { once: true });
      timer = window.setTimeout(() => done(false), timeoutMs);
      // (A query of its own, so the browser navigates rather than reuses a cached copy.)
      frame.src = `${new URL(SETTINGS_FILE, pageUrl).href}?renew=${Date.now()}`;
      document.body.append(frame);
    } catch {
      done(false);
    }
  });
}
