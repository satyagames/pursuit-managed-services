// Prompt 44: the admin page's addresses (migration/src/lib/admin/router.ts) and its one list of tabs (lib/admin/tabs.js).
//   1. The router reads and writes exactly the addresses the page always had (#today ... #users, #content/brand, the old #sections, the QR sheet,
//      the Live display and the wall), and holds a screen the role does not open to the first tab shown, as AdminApp.svelte did.
//   2. The tab list is the one AdminApp.svelte, the Menu, the role matrix's TAB_ACTIONS and the tests read: same ids, order, words and icons
//      as the page had, and AdminApp.svelte has no list of its own, a panel for every tab, and no hash parsing of its own.
// Run: node --test scripts/test-admin-router.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';
import { ADMIN_TABS, DEFAULT_TAB, legacyTabs } from '../migration/src/lib/admin/tabs.js';
import { TAB_ACTIONS, firstTab, tabsFor } from '../migration/src/lib/access/scope.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTER = path.join(ROOT, 'migration/src/lib/admin/router.ts');

/** Loads router.ts in Node: esbuild strips its types, and its relative imports are pointed at the files they name. */
async function loadRouter() {
  const source = await readFile(ROUTER, 'utf8');
  const { code } = await transformWithEsbuild(source, 'router.ts', { loader: 'ts', format: 'esm' });
  const pointed = code.replace(/from\s+['"](\.[^'"]+)['"]/g, (_, spec) => `from '${pathToFileURL(path.resolve(path.dirname(ROUTER), spec)).href}'`);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-router-'));
  const file = path.join(dir, 'router.mjs');
  await writeFile(file, pointed);
  return import(pathToFileURL(file).href);
}

const router = await loadRouter();
const ids = (tabs) => tabs.map((tab) => tab.id);

describe('the admin page\'s tabs (lib/admin/tabs.js)', () => {
  it('are the six the page had, in its order, with its words and icons', () => {
    assert.deepEqual(ADMIN_TABS.map(({ id, title, icon }) => [id, title, icon]), [
      ['today', 'Today', 'calendar-check'], ['clients', 'Clients', 'building'], ['content', 'Content', 'layers'],
      ['guests', 'Guests and QR', 'qr'], ['results', 'Results', 'bar-chart'], ['users', 'People', 'users'],
    ]);
    assert.equal(DEFAULT_TAB, 'today');
    assert.deepEqual(ids(legacyTabs()), ['today', 'clients', 'content', 'guests', 'results'], 'the PIN\'s legacy admin: all but People, as before');
  });

  it('take the actions that open them from the role matrix\'s TAB_ACTIONS, one tab for each', () => {
    assert.deepEqual(ids(ADMIN_TABS).sort(), Object.keys(TAB_ACTIONS).sort());
    for (const tab of ADMIN_TABS) assert.equal(tab.actions, TAB_ACTIONS[tab.id]);
  });

  it('give the first tab a role sees (firstTab) and the menu (tabsFor) in their order', () => {
    // (The access shape of scripts/test-scope.js.)
    const accessOf = (role, scopeType = 'global', more = {}) => ({
      person: { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '' }, owner: false, legacy: false, user: { id: 'x@deloitte.com', status: 'Active' },
      assignments: [{ id: `x|${role}`, userKey: 'x@deloitte.com', role, scopeType, clientId: null, sessionId: null, periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: 'v@deloitte.com', ...more }],
    });
    assert.equal(firstTab(accessOf('Super admin'), ADMIN_TABS), 'today');
    assert.deepEqual(ids(tabsFor(accessOf('Super admin'), ADMIN_TABS)), ids(ADMIN_TABS));
    assert.equal(firstTab(accessOf('Leadership', 'client', { clientId: 'acme' }), ADMIN_TABS), 'results');
    assert.deepEqual(ids(tabsFor(accessOf('Producer', 'client', { clientId: 'acme' }), ADMIN_TABS)), ['today', 'content', 'guests', 'results']);
  });

  it('are AdminApp.svelte\'s: it has no list of its own, draws a panel for every tab, and reads addresses only through the router', async () => {
    const app = await readFile(path.join(ROOT, 'migration/src/AdminApp.svelte'), 'utf8');
    assert.match(app, /import \{[^}]*ADMIN_TABS[^}]*\} from '\.\/lib\/admin\/tabs\.js'/);
    assert.match(app, /from '\.\/lib\/admin\/router\.js'/);
    assert.doesNotMatch(app, /title: '(Today|Clients|Content|Guests and QR|Results|People)'/, 'no tab written out in AdminApp.svelte');
    assert.doesNotMatch(app, /wallOfHash|liveDisplayOfHash|viewOfHash|'#print-guests'/, 'no address read or written out in AdminApp.svelte');
    for (const tab of ADMIN_TABS) assert.match(app, new RegExp(`activeTab === '${tab.id}'`), `a panel for ${tab.id}`);
  });
});

describe('the admin page\'s addresses (lib/admin/router.ts)', () => {
  const all = ADMIN_TABS;
  const noPeople = legacyTabs();

  it('reads a tab from its address, among the tabs shown, and Content from its views\' addresses', () => {
    for (const tab of all) assert.equal(router.tabOfHash(`#${tab.id}`, all), tab.id);
    assert.equal(router.tabOfHash('#content/brand', all), 'content');
    assert.equal(router.tabOfHash('#sections', all), 'content', 'the old Activities tab lands on Content');
    assert.equal(router.tabOfHash('#content/nothing', all), 'content');
    assert.equal(router.tabOfHash('#results?x=1', all), 'results', 'a query after the tab is ignored');
    assert.equal(router.tabOfHash('#users', noPeople), null, 'a tab not shown is not followed');
    assert.equal(router.tabOfHash('#live-display', all), null);
    assert.equal(router.tabOfHash('', all), null);
  });

  it('writes the same addresses back', () => {
    assert.equal(router.hashOfTab('today', 'activities'), '#today');
    assert.equal(router.hashOfTab('content', 'activities'), '#content');
    assert.equal(router.hashOfTab('content', 'brand'), '#content/brand');
    assert.equal(router.hashOfTab('users', 'brand'), '#users');
    assert.equal(router.contentViewOf('#content/brand'), 'brand');
    assert.equal(router.contentViewOf('#today'), 'activities');
  });

  it('reads and writes the Live display and the wall', () => {
    assert.deepEqual(router.liveOfHash('#live-display'), { sessionId: '', wall: false });
    assert.deepEqual(router.liveOfHash('#live-display/kroger-2026-10-20'), { sessionId: 'kroger-2026-10-20', wall: false });
    assert.deepEqual(router.liveOfHash('#live-display/kroger-2026-10-20/wall'), { sessionId: 'kroger-2026-10-20', wall: true });
    assert.equal(router.liveOfHash('#results'), null);
    assert.equal(router.liveHash('kroger-2026-10-20', false), '#live-display/kroger-2026-10-20');
    assert.equal(router.liveHash('kroger-2026-10-20', true), '#live-display/kroger-2026-10-20/wall');
    assert.equal(router.liveHash('', false), '#live-display');
    assert.equal(router.PRINT_HASH, '#print-guests');
  });

  it('opens the shell where the address says, and holds a screen the role does not open to the first tab shown', () => {
    const yes = () => true;
    assert.deepEqual(router.openingScreen('#print-guests', all, yes), { tab: 'guests', printing: true, liveDisplay: null, wall: false });
    assert.deepEqual(router.openingScreen('#live-display/s1/wall', all, yes), { tab: 'results', printing: false, liveDisplay: 's1', wall: true });
    assert.deepEqual(router.openingScreen('#content/brand', all, yes), { tab: 'content', printing: false, liveDisplay: null, wall: false });
    assert.deepEqual(router.openingScreen('#nothing', all, yes), { tab: 'today', printing: false, liveDisplay: null, wall: false });
    const resultsOnly = [{ id: 'results' }];
    const only = (tab) => tab === 'results';
    assert.deepEqual(router.openingScreen('#print-guests', resultsOnly, only), { tab: 'results', printing: false, liveDisplay: null, wall: false }, 'no QR sheet without Guests');
    const contentOnly = [{ id: 'content' }];
    assert.deepEqual(router.openingScreen('#live-display/s1', contentOnly, (tab) => tab === 'content'), { tab: 'content', printing: false, liveDisplay: null, wall: false }, 'no Live display without Results');
    assert.deepEqual(router.openingScreen('#print-guests', all, null), { tab: 'guests', printing: true, liveDisplay: null, wall: false }, 'no access to ask: as the address says');
    assert.equal(router.openingScreen('', [], yes).tab, 'today', 'no tab at all: Today');
  });

  it('moves along the bar with the arrows, Home and End, wrapping', () => {
    assert.equal(router.tabKeyTarget('ArrowRight', 5, 6), 0);
    assert.equal(router.tabKeyTarget('ArrowLeft', 0, 6), 5);
    assert.equal(router.tabKeyTarget('ArrowRight', 2, 6), 3);
    assert.equal(router.tabKeyTarget('Home', 4, 6), 0);
    assert.equal(router.tabKeyTarget('End', 1, 6), 5);
    assert.equal(router.tabKeyTarget('Enter', 1, 6), null);
  });
});
