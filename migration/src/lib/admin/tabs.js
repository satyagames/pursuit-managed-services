// The admin page's tabs (Prompt 44): the one list of them. Each tab's id (its address, `#<id>`), its label, its icon (admin/Icon.svelte), the
// actions that open it (the role matrix's, through TAB_ACTIONS in lib/access/scope.js, which a tab shows for when the person may at least look
// at one), and its place in the bar, the Menu and "the first tab a person sees". AdminApp.svelte draws the bar, the Menu and the panel from it,
// and lib/admin/router.ts reads addresses by it. Plain data and JSDoc, no DOM, no request; the participant page never imports it.
//
// What is not here, and why: the screen each tab shows. lib/admin is a lower layer than the screens (scripts/test-boundaries.js), so the panel
// is chosen in AdminApp.svelte by the tab's id, and scripts/test-admin-router.js holds every tab to a panel there.

import { TAB_ACTIONS } from '../access/scope.js';

/**
 * The tabs in the bar's order: the day's work first. Content is the old Activities and Content tabs in one, scoped by client (Phase 5b); its
 * address carries its view (lib/admin/admin-content-views.js). `legacy` says whether the PIN's legacy admin, who has no access read, sees it.
 * @typedef {'today' | 'clients' | 'content' | 'guests' | 'results' | 'users'} TabId
 * @type {readonly { id: TabId, title: string, icon: string, actions: readonly string[], legacy: boolean }[]}
 */
export const ADMIN_TABS = Object.freeze([
  Object.freeze({ id: 'today', title: 'Today', icon: 'calendar-check', actions: TAB_ACTIONS.today, legacy: true }),
  Object.freeze({ id: 'clients', title: 'Clients', icon: 'building', actions: TAB_ACTIONS.clients, legacy: true }),
  Object.freeze({ id: 'content', title: 'Content', icon: 'layers', actions: TAB_ACTIONS.content, legacy: true }),
  Object.freeze({ id: 'guests', title: 'Guests and QR', icon: 'qr', actions: TAB_ACTIONS.guests, legacy: true }),
  Object.freeze({ id: 'results', title: 'Results', icon: 'bar-chart', actions: TAB_ACTIONS.results, legacy: true }),
  Object.freeze({ id: 'users', title: 'People', icon: 'users', actions: TAB_ACTIONS.users, legacy: false }),
]);

/** The tab a page with no address, and no tab it may open, falls back to. */
export const DEFAULT_TAB = 'today';

/** The tabs shown before an access is read (the PIN's legacy admin): all but People, as before. */
export const legacyTabs = () => ADMIN_TABS.filter((tab) => tab.legacy);
