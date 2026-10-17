// The unsupported-browser check (Phase 8). It runs as a plain script in the HTML of all three pages (index, admin, setup), before the
// app's module, and is written in ES5 on purpose: it has to run in a browser that is too old for the app.
//
// Three ways a browser can fail, and what each one sees:
//   1. It cannot run module scripts at all. It skips the app and runs the <script nomodule> beside this one (see page.html), which shows
//      the notice.
//   2. It runs the module but lacks something the app needs (an API, a CSS feature). `supported()` finds out here, before the app
//      starts, shows the notice and sets `window.__pmsUnsupported`; the first import of every entry (lib/settings/support.ts) then stops the
//      bundle so nothing runs over the notice.
//   3. It loads the module but cannot parse it, or the module throws before the page is drawn. Either one raises an `error` event
//      on the window while `window.__pmsMounted` is not yet set, and that shows the notice too. Once the app has mounted, errors are
//      the app's own business and the notice is never shown.
// The test list is what the app really uses (migration/src/lib/data/dataService.js, the Svelte app, the stylesheets), not a version number.
(function () {
  var w = window;
  var d = document;

  function show() {
    w.__pmsUnsupported = true;
    var page = d.getElementById('pms-unsupported');
    if (page) page.style.display = 'block';
  }

  function css(rule) {
    try { return !!(w.CSS && w.CSS.supports && w.CSS.supports(rule)); } catch (error) { return false; }
  }

  function supported() {
    try {
      // Nothing is listed that another entry implies in every engine: a browser with AbortSignal.timeout (Safari 16, Chrome 103, Firefox 100) has fetch, Promise.allSettled,
      // AbortController and URL; one with color-mix() has :focus-visible; any with <dialog> has shadow DOM. The newest of the things the app needs are what is tested.
      return typeof w.AbortSignal.timeout === 'function'
        && typeof w.structuredClone === 'function'
        && typeof Array.prototype.at === 'function'
        && typeof w.HTMLDialogElement === 'function'
        && typeof w.CSS.registerProperty === 'function'
        && css('color: color-mix(in srgb, red, blue)');
    } catch (error) {
      return false;
    }
  }

  if (!supported()) show();
  w.addEventListener('error', function () { if (!w.__pmsMounted) show(); });
}());
