// The first import of every entry (main.ts, admin-main.ts, setup-main.ts). The HTML runs src/unsupported/support-check.js before the
// module; when that finds the browser lacking something the app needs it has already shown the notice and set `__pmsUnsupported`.
// Throwing here, before any other module of the bundle has run, keeps the rest of the app from throwing over the notice or drawing
// on top of it. (The error is expected; it is the point.)
type Flags = { __pmsUnsupported?: boolean; __pmsMounted?: boolean };

if ((window as Flags).__pmsUnsupported) throw new Error('This browser cannot run this page; the notice is shown instead.');

/** Called straight after the app is mounted: from here on an error is the app's own, and the notice is never shown for it. */
export function mounted() {
  (window as Flags).__pmsMounted = true;
}
