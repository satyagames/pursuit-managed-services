// The Content tab's views (Phase 18): one client's workspace with a view for what its participants read (Activities) and one for how it
// looks (Brand). This list is the only place a view is named: the strip under the client header, its arrow keys, the address
// (#content, #content/brand), the words on each tab and the view a browser tab comes back to are all read from it, so a third view is one
// more row. Plain JS with JSDoc and no DOM, Svelte or requests, so `node --test` can run it (scripts/test-admin-content-views.js);
// AdminContent.svelte draws what it says.

import { activitiesOfClient } from './admin-content.js';
import { resolveClientTheme } from '../brand/client-theme.js';

/**
 * What a view's tab shows beside its label, worked out from what the screen already holds (no request).
 * @typedef {{ sections?: { clientId?: string | null, enabled?: boolean }[], clientId?: string, client?: any, brandDirty?: boolean }} ViewState
 * @typedef {{ text: string, flag: string | null }} Badge `flag`: a state that needs the person's eye, shown with a mark beside the words.
 */

/** @param {ViewState} state @returns {Badge} */
function activitiesBadge({ sections = [], clientId = '' }) {
  const owned = activitiesOfClient(sections, clientId);
  return { text: `${owned.length} · ${owned.filter((section) => section.enabled === true).length} live`, flag: null };
}

/** A client's saved look in a word: its own colours, or the standard ones. @param {any} client @returns {'Standard' | 'Custom'} */
export const lookWord = (client) => (resolveClientTheme(client).source === 'default' ? 'Standard' : 'Custom');

/** @param {ViewState} state @returns {Badge} */
function brandBadge({ client = null, brandDirty = false }) {
  return { text: `${lookWord(client)} look`, flag: brandDirty ? 'Unsaved changes' : null };
}

/**
 * The views, in the order of the strip. `segment` is the address after `#content/` ('' for plain #content); `component` is the key the screen
 * draws the view by; `heading` is the id of the view's heading, where focus goes when the view is opened; `isDefault` marks the one view a plain #content, an unknown segment or nothing remembered opens.
 * @type {readonly { id: string, label: string, segment: string, component: string, heading: string, isDefault: boolean, badge: (state: ViewState) => Badge }[]}
 */
export const CONTENT_VIEWS = Object.freeze([
  Object.freeze({ id: 'activities', label: 'Activities', segment: '', component: 'activities', heading: 'activities-heading', isDefault: true, badge: activitiesBadge }),
  Object.freeze({ id: 'brand', label: 'Brand', segment: 'brand', component: 'brand', heading: 'brand-title', isDefault: false, badge: brandBadge }),
]);

/** The view a plain #content opens. */
export const DEFAULT_VIEW = /** @type {string} */ (CONTENT_VIEWS.find((view) => view.isDefault)?.id);

/** The tab whose address the views share. */
const TAB = 'content';
/** Phase 5b's address of the old Activities tab, which lands on Content. */
const OLD_HASH = '#sections';
/** Where the last view is kept for the browser tab. */
const KEY = 'pms.contentView';

/** A view by id; the default for anything else. @param {string | null | undefined} id */
export const viewById = (id) => CONTENT_VIEWS.find((view) => view.id === id) ?? /** @type {typeof CONTENT_VIEWS[number]} */ (CONTENT_VIEWS.find((view) => view.isDefault));

/** The address of a view: #content for the default, #content/<segment> for the others. @param {string} id */
export function hashOfView(id) {
  const view = viewById(id);
  return view.segment ? `#${TAB}/${view.segment}` : `#${TAB}`;
}

/**
 * The view an address asks for: null when the address is not Content's (another tab's, the Live display's...), the default for #content, the
 * old #sections, or a segment no view has.
 * @param {string} hash
 * @returns {string | null}
 */
export function viewOfHash(hash) {
  if (hash === OLD_HASH || hash === `#${TAB}`) return DEFAULT_VIEW;
  if (!hash.startsWith(`#${TAB}/`)) return null;
  const segment = hash.slice(TAB.length + 2);
  return CONTENT_VIEWS.find((view) => view.segment !== '' && view.segment === segment)?.id ?? DEFAULT_VIEW;
}

/** What a view's tab shows beside its label. @param {string} id @param {ViewState} state @returns {Badge} */
export const viewBadge = (id, state) => viewById(id).badge(state);

/**
 * The strip's arrow keys, as the top tabs have them: the index a key moves to (Left and Right wrap, Home and End go to the ends), or null when the
 * key is not the strip's.
 * @param {string} key @param {number} index
 * @returns {number | null}
 */
export function stepView(key, index) {
  const count = CONTENT_VIEWS.length;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Keeps the view for this browser tab, so the Content tab comes back to it. Storage that is missing or refuses (a private window, a policy) is
 * passed over: the view still opens.
 * @param {string} id @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage sessionStorage on the page
 */
export function rememberView(id, storage) {
  try { storage?.setItem(KEY, viewById(id).id); } catch { /* not kept */ }
}

/**
 * The view this browser tab last showed, or the default when nothing is kept, storage refuses, or the kept view is no longer in the list.
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @returns {string}
 */
export function lastView(storage) {
  try { return viewById(storage?.getItem(KEY) ?? null).id; } catch { return DEFAULT_VIEW; }
}
