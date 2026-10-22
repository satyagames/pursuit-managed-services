// How each of the three pages starts (Phase 10b): find out which site and lists are this copy's, tell the data layer, then mount.
//
// It is the second import of every entry, straight after the browser check, so that the line below runs before any module that
// could ask for data: from then until dataService.configure() is called, a request is an error (PMS-CFG-003) and never a request to
// some default. The settings come from lib/settings/deploy-settings.js: on SharePoint, pms-config.txt beside the page over the values built
// into the page (lib/settings/settings-file.js reads the file, once, on every load); on the local server, nothing is read. They are held in
// this module for as long as the page is open and are never written to browser storage.
import { mount, unmount, type Component } from 'svelte';
import * as dataService from '../data/dataService.js';
import { isLocalAddress } from './address-check.js';
import { BUILT } from './built-settings.js';
import { resolveSettings } from './deploy-settings.js';
import { focusHeading } from '../common/focus.js';
import { readSettingsFile } from './settings-file.js';

dataService.requireConfiguration();

export type Deployment = {
  /** What the data layer was configured with; null on the local server, and when there is a problem. */
  settings: Record<string, unknown> | null;
  /** Where each setting came from: 'file', 'built in', 'derived' or 'default'. */
  sources: Record<string, string>;
  /** At most one: the first thing wrong, as a code and where (lib/settings/deploy-settings.js). lib/settings/deploy-problems.js puts it in words. */
  problems: { id: string; kind?: string; status?: number; at?: string }[];
  /** On SharePoint: every value that could be worked out, problem or not. */
  known?: Record<string, unknown>;
};
/** What a page started from: the settings file as it was read (or why it was not), and what the build put into the page. */
type SettingsRead = { file?: unknown; fileError?: { kind: string; status?: number }; built: Record<string, unknown> };

let found: Deployment | null = null;
/** What the page does when the data layer finds the site's lists are not this build's (PMS-LST-010 to 012): set by startPage; none for Setup. */
let stopForLists: ((code: string) => void) | null = null;
let read: Omit<SettingsRead, 'built'> = {};
/** What this page last worked out about itself; null until findSettings() has answered. */
export const deployment = () => found;
/** What it worked that out from: Setup spells a problem out with it. */
export const settingsRead = (): SettingsRead => ({ ...read, built: BUILT });

/** Works out this page's settings and, when nothing is wrong with them, hands them to the data layer. Never throws. */
export async function findSettings(): Promise<Deployment> {
  const pageUrl = window.location.href;
  read = isLocalAddress(window.location) ? {} : await readSettingsFile(pageUrl);
  found = resolveSettings({ pageUrl, built: BUILT, ...read }) as Deployment;
  // (The data layer tells the page, through onStop, when the lists turn out not to be this build's: Phase 10c-2b.)
  if (!found.problems.length) dataService.configure({ sharePoint: found.settings, onStop: (code: string) => stopForLists?.(code) });
  return found;
}

/**
 * The stop screen: what the participant page and the admin page show in place of themselves while they cannot tell which site and
 * lists are their own. A few plain elements over the whole window, in the page's own colours and its own button (neither page has
 * loaded anything of a client yet), with the same short words whatever is wrong: both pages have a size to keep to, so the problem
 * is given as its code and where, and Setup, where the words send the person, spells it out in full and says who to ask
 * (lib/settings/deploy-problems.js; that is also why "who to ask" is not on this screen). Try again loads the page afresh, which reads the settings file again. The heading takes focus, as on
 * every new screen.
 */
function showStop(target: Element, trouble: Deployment['problems'][number], lists = false) {
  const screen = document.createElement('main');
  screen.style.cssText = 'position:fixed;inset:0;overflow:auto;padding:1.5rem;overflow-wrap:anywhere';
  // (Fixed words; the one thing that comes from outside, where the settings are wrong, goes in as text.)
  screen.innerHTML = `<h1 tabindex="-1">This page cannot start</h1><p>${lists ? "This site's lists are not the ones this version of the app needs" : 'It cannot tell which lists are its own'}, so it has stopped rather than guess. `
    + 'Check your connection and press Try again, or open Setup (setup.html, in this folder) to see what is wrong.</p>'
    // (Each page's own primary button: `.button` on the participant page, `.btn` on the admin's. Never both: the legacy stylesheet the
    // participant page still loads gives `.btn` a focus ring of its own, which is not this app's green one.)
    + `<button class="${target.id === 'app' ? 'button button-primary' : 'btn btn--primary'}">Try again</button><p></p>`;
  screen.querySelector('button')!.onclick = () => window.location.reload();
  screen.lastChild!.textContent = `Details: ${[trouble.id, trouble.kind, trouble.status, trouble.at].filter(Boolean).join(' ')}`;
  target.replaceChildren(screen);
  focusHeading(screen.querySelector('h1'));
}

/**
 * Puts `App` on the screen once the page knows which site and lists are its own, and the stop screen in its place when it cannot
 * tell. Resolves when one or the other is up.
 */
export async function startPage(target: Element, App: Component) {
  const [trouble] = (await findSettings()).problems;
  if (trouble) showStop(target, trouble);
  else {
    const app = mount(App, { target });
    // Lists of another version (Phase 10c-2b) are found on the first read of the AppSettings item, wherever that is: the page goes, the stop screen comes.
    stopForLists = (code) => {
      stopForLists = null;
      void unmount(app);
      showStop(target, { id: code }, true);
    };
  }
}
