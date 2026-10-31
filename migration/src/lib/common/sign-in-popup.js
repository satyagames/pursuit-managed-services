// Sign in again without a reload (Prompt 26): a tap opens a small window on this same page with ?signed-in=1. The firm's single sign-on renews the SharePoint cookie there
// on the way; the page, loaded, tells its opener and closes before it asks for anything. The opener then proves the sign-in with one light read and carries on, with
// the screen and the unsent answers as they were. A browser blocks a window not opened by a tap, so nothing ever calls this but a button. ASSUMED until QA-TESTING.md's
// check on the real site: that sign-on works in such a window. The brief named a static signed-in.html; this page is used instead, so there is no new file to upload,
// and it is a file the site is already known to serve as a page. Stores nothing.

const MARK = 'signed-in';
const MESSAGE = 'pms-signed-in';
const GIVE_UP_MS = 3 * 60_000;

/** Is this page load the pop-up? @param {Location} [where] @param {unknown} [opener] */
export const isSignInPopup = (where = window.location, opener = window.opener) => Boolean(opener) && new URLSearchParams(where.search).has(MARK);

/** The pop-up's whole work: says so to the page that opened it, closes, and stops this page's start. */
export function closeSignInPopup() {
  window.opener.postMessage(MESSAGE, window.location.origin);
  window.close();
  throw new Error('This window was opened to sign in, and has closed.');
}

/**
 * Opens the window and waits for it. Resolves to whether the sign-in works now: false when the window was blocked, closed by the person with the sign-in still refused, or
 * still open after three minutes. Never throws.
 * @param {string} pageUrl this page's address
 * @param {() => Promise<boolean>} check the data layer's checkSignedIn
 * @param {Pick<Window, 'open' | 'addEventListener' | 'removeEventListener' | 'setInterval' | 'clearInterval' | 'setTimeout' | 'clearTimeout'> & { location: { origin: string } }} [host]
 */
export function openSignInPopup(pageUrl, check, host = window) {
  const address = new URL(pageUrl);
  address.search = `?${MARK}=1`;
  address.hash = '';
  const popup = host.open(address.href, 'pms-sign-in', 'width=480,height=640');
  if (!popup) return Promise.resolve(false);
  return new Promise((resolve) => {
    let poll = 0;
    let limit = 0;
    const finish = () => {
      host.removeEventListener('message', heard);
      host.clearInterval(poll);
      host.clearTimeout(limit);
      check().then(resolve, () => resolve(false));
    };
    const heard = (event) => { if (event.origin === host.location.origin && event.data === MESSAGE) finish(); };
    host.addEventListener('message', heard);
    poll = host.setInterval(() => { if (popup.closed) finish(); }, 500);
    limit = host.setTimeout(finish, GIVE_UP_MS);
  });
}
