// Reads pms-config.txt, the settings file beside the page (Phase 10b; named .txt since Phase 10g: the first real site would not hand out a
// .json file from a document library, and did serve a .txt, so the file's name is .txt and its content is still JSON). Plain JS, so
// `node --test` runs it on a stub.
//
// This is the one request a Svelte page makes for itself: it has to come before the data layer knows which site and lists to use, so
// it cannot go through public/js/dataService.js (every other request does; a test fails if another file here asks for anything).
//
// A missing file is an answer; a failed read is not. HTTP 404 means there is no settings file, and the values built into the page
// are next. Anything else that is not the file (no connection, no answer in time, another status, a sign-in page, text that is not
// JSON) is handed back as `fileError`, and the page stops: carrying on would be how a page ends up on the wrong lists without a
// word. The answer is never kept: the file is asked for on every load, never from a cache, and nothing is put in browser storage.
import { SETTINGS_FILE } from './deploy-settings.js';

/**
 * @param {string} pageUrl the page's own address; the file is in the same folder. (It is asked for with the page's own sign-in:
 *   a request to the page's own origin carries it without being told to.)
 * @returns {Promise<{ file?: unknown, fileError?: { kind: 'unreachable' | 'status' | 'page' | 'json', status?: number } }>}
 *   `unreachable` is no connection, or no answer within the 8 seconds the request is given. `status` is the HTTP status that came back,
 *   for `status` and also for `page` and `json` (a web page with a success status is exactly what a site that will not serve the file sends).
 *   `{ file }` when it was read (whatever JSON it holds: lib/deploy-settings.js judges it), `{}` when there is none.
 */
export async function readSettingsFile(pageUrl) {
  let response, text;
  try {
    response = await fetch(new URL(SETTINGS_FILE, pageUrl).href, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return {};
    if (!response.ok) return { fileError: { kind: 'status', status: response.status } };
    text = await response.text();
  } catch {
    return { fileError: { kind: 'unreachable' } };
  }
  try { return { file: JSON.parse(text) }; } catch { return { fileError: { kind: /^\s*</.test(text) ? 'page' : 'json', status: response.status } }; }
}
