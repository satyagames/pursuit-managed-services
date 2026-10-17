<script lang="ts">
  import { tick } from 'svelte';
  import { focusHeading } from './lib/focus.js';
  import * as dataService from '../../public/js/dataService.js';
  import { login } from './lib/admin-pin.js';
  import { unlockFailureText } from './lib/admin-unlock.js';
  import { liveDisplayHash, liveDisplayOfHash } from './lib/admin-address.js';
  import { wallHash, wallOfHash } from './lib/live-wall.js';
  import { APP_NAME } from './lib/app-name.js';
  import { deployment } from './lib/start.js';
  import { mayLeave } from './lib/unsaved.js';
  import DeloitteWordmark from './components/DeloitteWordmark.svelte';
  import AdminClients from './admin/AdminClients.svelte';
  import AdminContent from './admin/AdminContent.svelte';
  import AdminGuests from './admin/AdminGuests.svelte';
  import AdminResults from './admin/AdminResults.svelte';
  import AdminToday from './admin/AdminToday.svelte';
  import LiveDisplay from './admin/LiveDisplay.svelte';
  import PrintSheet from './admin/PrintSheet.svelte';

  type Admin = { id: string; name?: string };
  type Tab = 'today' | 'clients' | 'content' | 'guests' | 'results';

  // The day's work first. Content is the old Activities and Content tabs in one, scoped by client (Phase 5b).
  const tabs: { id: Tab; title: string }[] = [
    { id: 'today', title: 'Today' },
    { id: 'clients', title: 'Clients' },
    { id: 'content', title: 'Content' },
    { id: 'guests', title: 'Guests and QR' },
    { id: 'results', title: 'Results' },
  ];
  /** The address of the guest QR sheet. It is a view of this page, not a tab: Back returns to Guests and QR. */
  const PRINT_HASH = '#print-guests';

  /** This copy's label, from its settings ("Test, folder 3"): shown in the bar, so that two folders on one site can be told apart. */
  const label = typeof deployment()?.settings?.label === 'string' ? String(deployment()?.settings?.label) : '';

  let loginHeading = $state<HTMLElement>();
  let pinField = $state<HTMLInputElement>();
  let admin = $state<Admin | null>(null);
  let activeTab = $state<Tab>('today');
  let pin = $state('');
  let error = $state('');
  let busy = $state(false);
  let toastMessage = $state('');
  let toastKind = $state<'info' | 'success' | 'error'>('info');
  let toastTimer: number | undefined;
  let printing = $state(false);
  /** The Live display is a view of Results (the tab stays Results; Back returns to its list). null: not showing; '': the session that is live now; else a session id. */
  let liveDisplay = $state<string | null>(null);
  /** The Live display as the wall (Phase 11a: `#live-display/<id>/wall`, what "Open in a new tab" opens): the charts with no names in the page. */
  let wallPage = $state(false);

  /** The Live display a hash asks for, and whether it is the wall; null when the hash is not the Live display's. */
  function liveOfHash(hash: string): { sessionId: string; wall: boolean } | null {
    const wall = wallOfHash(hash);
    if (wall !== null) return { sessionId: wall, wall: true };
    const live = liveDisplayOfHash(hash);
    return live === null ? null : { sessionId: live, wall: false };
  }

  // An old address (#sections, the Activities tab) lands on Content, where its capabilities now are.
  const tabFromHash = (): Tab | null => (window.location.hash === '#sections' ? 'content' : tabs.find((tab) => `#${tab.id}` === window.location.hash)?.id ?? null);

  async function unlock(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const result = await login(pin.trim());
      if (!result) {
        error = 'Incorrect PIN.';
        pin = '';
        return;
      }
      admin = result as Admin;
      printing = window.location.hash === PRINT_HASH;
      const view = liveOfHash(window.location.hash);
      liveDisplay = view?.sessionId ?? null;
      wallPage = view?.wall ?? false;
      activeTab = printing ? 'guests' : liveDisplay !== null ? 'results' : tabFromHash() ?? 'today';
      pin = '';
      void newScreen();
    } catch (cause) {
      const support = deployment()?.settings?.support as { name?: string; contact?: string } | undefined;
      error = unlockFailureText(cause, { isUnreachable: dataService.isUnreachable, adminsList: dataService.sharePointListTitles().adminusers, support });
    } finally {
      busy = false;
      // The field was disabled while the PIN was checked, and a disabled field drops focus: after a wrong PIN, put the person back in it.
      if (!admin) void tick().then(() => pinField?.focus());
    }
  }

  /**
   * The PIN screen has just been replaced by the shell: say where the person is now. Focus goes to the new screen's heading (it takes the green ring
   * only for someone on the keyboard), so a screen reader reads "Today" and the Tab key carries on from there. (Phase 8: focus used to fall to the page.)
   */
  async function newScreen() {
    await tick();
    const heading = document.querySelector<HTMLElement>('#admin-panel h2');
    if (heading) {
      heading.tabIndex = -1;
      focusHeading(heading);
    } else document.getElementById('admin-panel')?.focus({ preventScroll: true });
  }

  function showToast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
    toastMessage = message;
    toastKind = kind;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toastMessage = ''; }, kind === 'error' ? 6000 : 2500);
  }

  async function lock() {
    // A screen with unsaved changes (Brand Studio) asks first.
    if (!(await mayLeave())) return;
    admin = null;
    printing = false;
    liveDisplay = null;
    wallPage = false;
    activeTab = 'today';
    // Back at the PIN screen: focus its heading, as the screen's first thing to be read.
    await tick();
    focusHeading(loginHeading);
  }

  /** Opens the Live display for a session ('' for whichever is live). It is a view of Results, so the address keeps it. */
  async function openLiveDisplay(sessionId: string, wall = false) {
    if (activeTab !== 'results' && !(await mayLeave())) return;
    activeTab = 'results';
    liveDisplay = sessionId;
    wallPage = wall && sessionId !== '';
    try { window.history.replaceState(window.history.state, '', wallPage ? wallHash(sessionId) : liveDisplayHash(sessionId)); } catch { /* the view still opens */ }
    window.scrollTo({ top: 0 });
  }

  function closeLiveDisplay() {
    liveDisplay = null;
    wallPage = false;
    try { window.history.replaceState(window.history.state, '', '#results'); } catch { /* the list still shows */ }
  }

  function openPrintSheet() {
    printing = true;
    try { window.history.replaceState(window.history.state, '', PRINT_HASH); } catch { /* the view still opens */ }
    window.scrollTo({ top: 0 });
  }

  function closePrintSheet() {
    printing = false;
    activeTab = 'guests';
    try { window.history.replaceState(window.history.state, '', '#guests'); } catch { /* the tab still shows */ }
  }

  /** Opens a tab; the address keeps it, so a reload (after the PIN) comes back to the same screen. False when the person chose to stay (unsaved changes). */
  async function open(tab: string): Promise<boolean> {
    const next = tabs.find((entry) => entry.id === tab)?.id;
    if (!next) return false;
    if (next !== activeTab && !(await mayLeave())) return false;
    activeTab = next;
    liveDisplay = null;
    wallPage = false;
    try { window.history.replaceState(window.history.state, '', `#${next}`); } catch { /* the tab still switches */ }
    await tick();
    document.getElementById(`admin-tab-${next}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  /** The address was changed by hand or by a link in this page while it is open (a pasted #live-display/<id>): follow it. */
  function onHashChange() {
    if (!admin || printing) return;
    const view = liveOfHash(window.location.hash);
    if (view !== null) { if (view.sessionId !== liveDisplay || view.wall !== wallPage) void openLiveDisplay(view.sessionId, view.wall); return; }
    const tab = tabFromHash();
    if (tab && (tab !== activeTab || liveDisplay !== null)) void open(tab);
  }

  function onTabKeydown(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    void open(tabs[next].id).then((opened) => document.getElementById(`admin-tab-${opened ? tabs[next].id : activeTab}`)?.focus());
  }
</script>

<svelte:head>
  <title>{APP_NAME} Admin</title>
</svelte:head>

<svelte:window onhashchange={onHashChange} />

{#if !admin}
  <main class="login">
    <div class="login__brand"><div class="login__wordmark"><DeloitteWordmark /></div></div>
    <form class="login__card" autocomplete="off" onsubmit={unlock}>
      <h1 bind:this={loginHeading} tabindex="-1">Admin</h1>
      <p class="muted">Enter your PIN to continue.</p>
      <input class="login__pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="PIN" maxlength="12" bind:value={pin} bind:this={pinField} disabled={busy} />
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn btn--primary btn--block" type="submit" disabled={busy || !pin.trim()}>{busy ? 'Checking...' : 'Unlock'}</button>
      <p class="muted small">The PIN gates navigation only. SharePoint permissions control data access.</p>
    </form>
  </main>
{:else if printing}
  <PrintSheet onClose={closePrintSheet} />
{:else}
  <div class="shell">
    <header class="shell__bar">
      <div class="shell__brand">
        <div class="shell__wordmark"><DeloitteWordmark /></div>
        <strong class="shell__title">{APP_NAME} Admin</strong>
        {#if label}<span class="shell__label" data-testid="copy-label">{label}</span>{/if}
      </div>
      <span class="shell__user">{admin.name ?? ''}</span>
      <button class="btn btn--bar" type="button" onclick={() => void lock()}>Lock</button>
    </header>
    <nav class="shell__nav" aria-label="Admin sections">
      <div class="tabs" role="tablist">
        {#each tabs as tab, index (tab.id)}
          <button id={`admin-tab-${tab.id}`} class="tab" type="button" role="tab" aria-controls="admin-panel" aria-selected={activeTab === tab.id} tabindex={activeTab === tab.id ? 0 : -1} onkeydown={(event) => onTabKeydown(event, index)} onclick={() => void open(tab.id)}>{tab.title}</button>
        {/each}
      </div>
    </nav>

    <div id="admin-panel" class="shell__body" role="tabpanel" aria-labelledby={`admin-tab-${activeTab}`} tabindex="0">
      {#if activeTab === 'today'}
        <AdminToday onToast={showToast} onNavigate={(tab) => void open(tab)} onLiveDisplay={(sessionId) => void openLiveDisplay(sessionId)} />
      {:else if activeTab === 'clients'}
        <AdminClients onToast={showToast} adminName={admin.name ?? ''} />
      {:else if activeTab === 'content'}
        <AdminContent onToast={showToast} adminName={admin.name ?? ''} />
      {:else if activeTab === 'guests'}
        <AdminGuests onToast={showToast} onNavigate={(tab) => void open(tab)} onPrint={openPrintSheet} />
      {:else if activeTab === 'results'}
        {#if liveDisplay !== null}
          {#key `${liveDisplay}|${wallPage}`}
            <LiveDisplay sessionId={liveDisplay} {wallPage} onToast={showToast} onOpen={(sessionId) => void openLiveDisplay(sessionId)} onBack={closeLiveDisplay} />
          {/key}
        {:else}
          <AdminResults onToast={showToast} onLiveDisplay={(sessionId) => void openLiveDisplay(sessionId)} />
        {/if}
      {/if}
    </div>
    {#if toastMessage}<div class="toast toast--{toastKind} toast--show" role="status">{toastMessage}</div>{/if}
  </div>
{/if}
