// Has the SharePoint sign-in run out? Plain JS with JSDoc and no DOM, so `node --test` imports it.
//
// When it has, SharePoint answers a request with its sign-in page (or a 401), and the data service says so with status 401 and the
// words "sign-in page". That is not a lost connection: waiting does not mend it, the person has to load the page again and sign in.
// The participant page used to show nothing for it on Welcome and the hub, and "check the connection" on a save.

/**
 * @param {unknown} error What a data service call threw.
 * @returns {boolean} true when it says the sign-in has expired. A refusal (403 with SharePoint's own words), a busy server and no
 * connection at all are not that.
 */
export const isSignedOut = (error) => {
  const failure = /** @type {{ status?: number, message?: string } | null | undefined} */ (error);
  return failure?.status === 401 || /sign-in page/i.test(String(failure?.message ?? ''));
};

/**
 * What to say when a screen could not be loaded: that the sign-in ran out, that the server cannot be reached, or what the server
 * itself said. (A dropped connection used to be shown as the browser's own words, "Load failed".)
 * @param {unknown} error
 * @param {(error: unknown) => boolean} isUnreachable dataService.isUnreachable
 * @param {string} fallback
 */
export function loadFailureText(error, isUnreachable, fallback) {
  if (isSignedOut(error)) return 'Your sign-in has expired. Reload this page to sign in again.';
  if (isUnreachable(error)) return 'Can’t reach the server. Check the connection, then try again.';
  return error instanceof Error && error.message ? error.message : fallback;
}
