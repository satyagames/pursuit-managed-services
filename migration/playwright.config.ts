import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { sharePointFolderPath } from '../scripts/deployment-config.js';

// Phase 8: three engines. Chromium runs everything. WebKit (the engine of every iPad browser; here Playwright's own build, on a Mac) and Firefox run
// everything that does not depend on something only another engine offers. What does not run where, and why, is THIS list, so that nothing is skipped
// quietly; MIGRATION-PLAN.md, "Phase 8", prints it as the matrix. A test that cannot run in an engine says so with test.skip() inside the file instead.

/** Files that run on Chromium only. */
const CHROMIUM_ONLY_FILES = [
  // Playwright's clock holds the page's timers and the specs read the requests it makes in the page's own clock.
  { why: "they run on Playwright's clock (the Phase 7 harness; Firefox has not been tried with it)", files: /(?:end-session|polling)\.spec\.ts/ },
  // The DevTools protocol: CPU and network throttling and long tasks.
  { why: 'it drives Chromium through the DevTools protocol (CPU and network throttling, long tasks)', files: /(?:performance|latency|motion-perf)\.spec\.ts/ },
  // axe-core is run once, in Chromium: it reads the DOM, which is the same in every engine.
  { why: 'axe-core reads the DOM, which is the same in every engine, so it runs once; the keyboard, aria and reflow specs run in all three', files: /a11y\.spec\.ts/ },
  // Pixel arithmetic on a screenshot.
  { why: 'the contrast check is arithmetic on pixels; every engine paints the same colours (the screenshot decoder is a Chromium page)', files: /(?:contrast|results-charts-greyscale)\.spec\.ts/ },
  // Phase 11a: a build inside a test.
  { why: 'it builds a second admin page with Vite inside the test (the wall\'s rule taken out) to show the wall\'s check can fail; the check itself, on the real page, runs in all three engines (results-charts-names.spec.ts)', files: /results-charts-wall-mutation\.spec\.ts/ },
];

/** Tests (by title) that do not run in WebKit, and why. */
const WEBKIT_NOT_RUN = [
  { why: "Playwright's WebKit drops the boundary= of a fulfilled $batch response, so the page there correctly finds batching unusable and falls back to plain reads: the request budgets these specs assert are not what the page would send", files: /(?:admin-sharepoint|brand-studio-sharepoint|live-display-sharepoint)\.spec\.ts/, titles: [/a first QR scan reaches Welcome in 8 requests/, /the self-test creates, updates, reads back/, /the self-test fails loudly, and still cleans up/] },
  { why: 'Safari on a Mac does not Tab to buttons unless its own setting is on, so a spec that walks the Tab order finds only fields; keyboard.spec.ts covers WebKit with Alt+Tab, which is what Safari offers instead', titles: [/keyboard: the controls come in reading order and show the green ring/, /keyboard: the guest controls come in reading order/, /keyboard: the tab row is one stop with arrows/, /keyboard: arrows move between answers, Enter picks one/, /the crop dialog works from the keyboard/, /Full screen covers the page with large type, no navigation and a way out/, /the controls fade with the way out when the pointer is idle/] },
  { why: "Playwright's WebKit does not hand a route the body of a request whose body is a Blob, so the mocked SharePoint stores each uploaded picture empty; the test that reads the pictures from the library, seeded from the test's own process, runs in WebKit, and so does the local-server half (Phase 10f)", titles: [/Seed sample clients puts the six pictures in the library first, byte for byte/] },
  { why: "these choose a PHOTOGRAPH as a hero or logo, which Safari cannot fit under its size limit without WebP (it says so, in words: documented in AGENTS.md); brand-smoke.spec.ts runs the pipeline in WebKit with flat artwork and checks that message", titles: [/every slot ends at exactly its target size/, /"Crop and fit": drag, wheel, slider and arrow keys/, /Save uploads each new picture under/, /a client that only has the older logo keeps it/, /Revert throws away a picture that was only chosen/, /Save does nothing when nothing changed, and a failed upload/, /if the write to the client fails, the pictures just uploaded are removed again/, /an answer tile's picture can be uploaded in Content/, /Clients: a check-in code for iPads, logo upload, and delete protection/] },
];

/** Tests that do not run in Firefox, and why. */
const FIREFOX_NOT_RUN = [
  { why: "Firefox's real full screen makes the window the size of its virtual screen (1366 x 768), so the 1920 x 1080 sizes this spec asserts cannot be reached there; the fit of every card at four sizes runs in Chromium, and the smoke spec runs full screen in all three", titles: [/Full screen covers the page with large type, no navigation and a way out/] },
];

/** Tests that run only in Chromium: the engine-specific constructors and the DevTools protocol. */
const ONLY_IN_CHROMIUM = [
  { why: 'the kiosk probe constructs TouchEvent and GestureEvent objects, which only Chromium has, and one test reads the painted font through the DevTools protocol; reflow.spec.ts checks the same pinch rules with plain events in all three engines', titles: [/the participant page renders in Open Sans from inlined fonts/, /pinch zoom, the long-press menu and text selection stay available/, /\?kiosk=1 locks the page down, before or inside the hash/, /an installed web app \(iOS standalone or display-mode: standalone\) locks the page down/, /Admin and Setup follow the same kiosk rule/] },
];

const filesOf = (list: { files?: RegExp }[]) => list.flatMap((entry) => (entry.files ? [entry.files] : []));
const titlesOf = (list: { titles?: RegExp[] }[]) => list.flatMap((entry) => entry.titles ?? []);
const ignore = (...lists: { files?: RegExp }[][]) => lists.flatMap(filesOf);
const invert = (...lists: { titles?: RegExp[] }[][]) => lists.flatMap(titlesOf);

export default defineConfig({
  testDir: '../scripts/migration-tests',
  // Kept apart from test-results/flow so Playwright's own clean-up never deletes the flow screenshots.
  outputDir: '../test-results/.migration-run',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5188', headless: true },
  projects: [
    { name: 'chromium' },
    // One-time setup: node node_modules/playwright/cli.js install webkit firefox
    { name: 'webkit', use: { browserName: 'webkit' }, testIgnore: ignore(CHROMIUM_ONLY_FILES, WEBKIT_NOT_RUN), grepInvert: invert(WEBKIT_NOT_RUN, ONLY_IN_CHROMIUM) },
    { name: 'firefox', use: { browserName: 'firefox' }, testIgnore: ignore(CHROMIUM_ONLY_FILES), grepInvert: invert(FIREFOX_NOT_RUN, ONLY_IN_CHROMIUM) },
  ],
  webServer: {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'node scripts/migration-test-server.js',
    url: `http://127.0.0.1:5188${sharePointFolderPath}/index.html`,
    reuseExistingServer: false,
  },
});

/** For the report: what does not run where, and why. */
export const matrixNotes = { CHROMIUM_ONLY_FILES, WEBKIT_NOT_RUN, FIREFOX_NOT_RUN, ONLY_IN_CHROMIUM };
