<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { activitiesOfClient, defaultClientId, lastClientId, rememberClient } from '../lib/admin/admin-content.js';
  import { CONTENT_VIEWS, DEFAULT_VIEW, lookWord, stepView, viewBadge, viewById } from '../lib/admin/admin-content-views.js';
  import { mayLeave } from '../lib/admin/unsaved.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import { withoutRetiredLogo } from '../lib/brand/retired-logos.js';
  import ActivityPreview from './ActivityPreview.svelte';
  import BrandStudio from './BrandStudio.svelte';
  import ContentActivities from './ContentActivities.svelte';
  import ContentView from './ContentView.svelte';

  type Client = { id: string; name: string; status?: string; theme?: unknown; themeVersion?: number | null; logoUrl?: string | null };
  type Section = { id: string; title: string; enabled: boolean; order?: number; questionIds?: string[]; clientId?: string | null; description?: string | null };
  type Settings = { id: string; activeSessionId?: string | null; activeClientId?: string | null };

  let { onToast, adminName = '', view = DEFAULT_VIEW, clientRequest = null, onView = () => {} }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    adminName?: string;
    /** The view showing (CONTENT_VIEWS); the shell keeps it in the address. */
    view?: string;
    /** A client to open on, once (Clients' Brand button), before the one remembered. */
    clientRequest?: string | null;
    /** The person chose another view on the strip. */
    onView?: (view: string) => void;
  } = $props();

  // One client's workspace (Phase 18). The client header (its logo or initial, the picker, Live now or Archived) and the strip of views stay
  // at the top; under them, the views of CONTENT_VIEWS: Activities (ContentActivities.svelte) and Brand (BrandStudio.svelte). A view is made
  // the first time it is opened and then kept, out of sight, while another one shows, so a switch loses nothing and asks nothing; both are
  // made afresh when the client changes, after their guards have asked. Everything here is read once, in one batch.
  let clients = $state<Client[]>([]);
  let sections = $state<Section[]>([]);
  let liveClientId = $state<string | null>(null);
  let clientId = $state('');
  let loading = $state(true);
  let loadError = $state('');
  /** The Activities view is changing something: the picker waits. */
  let busy = $state(false);
  /** Brand holds unsaved changes (its strip tab says so while another view shows). */
  let brandDirty = $state(false);
  /** The views made for this client so far. */
  let opened = $state<string[]>([]);
  /** Where the page was scrolled to in each view, to come back to it. */
  const scrolled: Record<string, number> = {};
  /** What the status line last said: "Showing <client>" after a change of client. */
  let showing = $state('');
  let logoFailed = $state(false);
  /** "Preview an activity in this look...", from the Brand view: the activity chosen, and the preview open. */
  let bridgeId = $state('');
  let bridgePreview = $state<Section | null>(null);

  const client = $derived(clients.find((entry) => entry.id === clientId) ?? null);
  const owned = $derived(activitiesOfClient(sections, clientId));
  const isLive = $derived(client !== null && client.id === liveClientId);
  const archived = $derived(client?.status === 'archived');
  const logo = $derived(client ? withoutRetiredLogo(client.logoUrl) : null);
  const look = $derived(lookWord(client));
  const bridgeSection = $derived(owned.find((section) => section.id === bridgeId) ?? owned[0] ?? null);

  const byName = (a: Client, b: Client) => a.name.localeCompare(b.name);
  const tabId = (id: string) => `content-tab-${id}`;
  const panelId = (id: string) => `content-view-${id}`;

  // The view showing is one of the views made.
  $effect(() => {
    const current = view;
    if (!untrack(() => opened).includes(current)) opened = [...untrack(() => opened), current];
  });

  onMount(() => {
    let active = true;
    void load().catch((cause) => { if (active) loadError = cause instanceof Error ? cause.message : 'Could not load content.'; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  /** One batch on SharePoint: who is live, the clients, and every activity. */
  async function load() {
    const [settingRows, clientRows, sectionRows] = await dataService.readLists([{ list: 'appsettings' }, { list: 'clients' }, { list: 'sections' }]) as unknown as [Settings[], Client[], Section[]];
    const settings = settingRows.find((row) => row.id === 'default');
    // (The live client is the one AppSettings names: Go live writes it beside the session.)
    const live = settings?.activeSessionId ? settings.activeClientId ?? null : null;
    clients = [...clientRows].sort(byName);
    sections = sectionRows;
    liveClientId = live;
    const asked = untrack(() => clientRequest);
    clientId = asked && clients.some((entry) => entry.id === asked) ? asked : defaultClientId({ clients, liveClientId: live, last: lastClientId(live) });
    rememberClient(clientId, live);
  }

  /** The picker changed: the views of the old client ask first (unsaved Brand changes, a question being edited), then everything follows the new one. */
  async function chooseClient(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const id = select.value;
    if (id === clientId) return;
    if (!(await mayLeave())) { select.value = clientId; return; }
    clientId = id;
    rememberClient(id, liveClientId);
    brandDirty = false;
    logoFailed = false;
    bridgeId = '';
    opened = [view];
    for (const key of Object.keys(scrolled)) delete scrolled[key];
    showing = `Showing ${clients.find((entry) => entry.id === id)?.name ?? ''}`;
  }

  /**
   * Shows a view. The page comes back to where it was in that view; a view not seen yet starts where the page is, moved only if its heading is
   * out of sight. `focus` 'heading' moves focus there (a click or Enter on the strip); the arrow keys keep it on the strip.
   */
  async function show(id: string, focus: 'heading' | 'tab' | 'none' = 'heading') {
    if (id !== view) {
      scrolled[view] = window.scrollY;
      onView(id);
      await tick();
      const back = scrolled[id];
      if (back !== undefined) window.scrollTo({ top: back });
    }
    const heading = document.getElementById(viewById(id).heading);
    if (heading && scrolled[id] === undefined) {
      const box = heading.getBoundingClientRect();
      const strip = document.querySelector('.content-strip')?.getBoundingClientRect().bottom ?? 0;
      if (box.top < strip || box.bottom > window.innerHeight) heading.scrollIntoView({ block: 'nearest' });
    }
    if (focus === 'heading' && heading) {
      heading.tabIndex = -1;
      focusHeading(heading);
    } else if (focus === 'tab') document.getElementById(tabId(id))?.focus();
  }

  function onStripKeydown(event: KeyboardEvent, index: number) {
    const next = stepView(event.key, index);
    if (next === null) return;
    event.preventDefault();
    void show(CONTENT_VIEWS[next].id, 'tab');
  }

  /** A guard in a view out of sight is about to ask: show that view first. */
  async function reveal(id: string) {
    if (id !== view) await show(id, 'none');
  }
</script>

<section class="panel content-panel" aria-busy={loading || busy}>
  <header class="panel__head">
    <div>
      <h2>Content</h2>
      <p class="muted">Each client's activities, with their questions and options, and the client's look beside them. Switch an activity on to put it on that client's participant agenda; changes to a live activity are live at once.</p>
    </div>
  </header>

  {#if loading}
    <p role="status">Loading content...</p>
  {:else if loadError}
    <div class="panel-error" role="alert"><h2>Could not load content</h2><p class="muted">{loadError}</p></div>
  {:else if clients.length === 0 || !client}
    <p class="muted">There are no clients yet. Add one on Clients.</p>
  {:else}
    <div class="content-spine">
      <div class="content-client">
        <span class="content-client__chip" data-testid="content-chip" data-logo={logo && !logoFailed ? 'true' : 'false'} aria-hidden="true">
          {#if logo && !logoFailed}
            <img class="content-client__logo" src={embeddedAssetUrl(logo) ?? ''} alt="" onerror={() => { logoFailed = true; }} />
          {:else}
            {client.name.trim().charAt(0).toUpperCase()}
          {/if}
        </span>
        <label class="field__label content-client__label" for="content-client">Client</label>
        <select id="content-client" class="select content-client__pick" value={clientId} onchange={(event) => void chooseClient(event)} disabled={busy}>
          {#each clients as entry (entry.id)}<option value={entry.id}>{entry.name}</option>{/each}
        </select>
        {#if isLive}<span class="pill pill--live">LIVE NOW</span>{/if}
        {#if archived}<span class="pill pill--archived">Archived</span>{/if}
      </div>
      <div class="content-strip">
        <div class="content-strip__track" role="tablist" aria-label={`${client.name}: views`}>
        {#each CONTENT_VIEWS as entry, index (entry.id)}
          {@const badge = viewBadge(entry.id, { sections, clientId, client, brandDirty })}
          <button id={tabId(entry.id)} class="content-strip__tab" type="button" role="tab" aria-selected={view === entry.id} aria-controls={panelId(entry.id)}
            tabindex={view === entry.id ? 0 : -1} data-view={entry.id} onkeydown={(event) => onStripKeydown(event, index)} onclick={() => void show(entry.id)}>
            <span class="content-strip__label">{entry.label}</span>
            <span class="content-strip__badge" data-testid={`content-badge-${entry.id}`}>{badge.text}</span>
            {#if badge.flag}<span class="content-strip__flag" data-testid={`content-flag-${entry.id}`}><span class="content-strip__dot" aria-hidden="true"></span>{badge.flag}</span>{/if}
          </button>
        {/each}
        </div>
      </div>
    </div>
    <p class="sr-only" role="status">{showing}</p>

    {#key clientId}
      {#each CONTENT_VIEWS as entry (entry.id)}
        <ContentView id={panelId(entry.id)} labelledBy={tabId(entry.id)} shown={view === entry.id} onReveal={() => reveal(entry.id)}>
          {#if opened.includes(entry.id) || view === entry.id}
            {#if entry.component === 'activities'}
              <ContentActivities bind:clients bind:sections bind:busy {client} shown={view === entry.id} {look} {onToast} {adminName}
                onEditBrand={() => void show('brand')} />
            {:else if entry.component === 'brand'}
              <BrandStudio embedded client={client as never} clients={clients as never} {onToast} onDirty={(dirty) => { brandDirty = dirty; }}
                onSaved={(record) => { clients = clients.map((item) => (item.id === record.id ? { ...item, ...record } : item)); }} />
              <section class="card content-bridge" aria-labelledby="content-bridge-title">
                <h3 id="content-bridge-title">Preview an activity in this look...</h3>
                {#if owned.length === 0}
                  <p class="muted">{client.name} has no activities yet. Add one under {viewById('activities').label}.</p>
                {:else}
                  <div class="content-bridge__pick">
                    <label class="field__label" for="content-bridge-activity">Activity</label>
                    <select id="content-bridge-activity" class="select" value={bridgeSection?.id ?? ''} onchange={(event) => { bridgeId = event.currentTarget.value; }} aria-describedby="content-bridge-why">
                      {#each owned as section (section.id)}<option value={section.id}>{section.title}</option>{/each}
                    </select>
                    <button class="btn" type="button" disabled={brandDirty || !bridgeSection} aria-describedby="content-bridge-why" onclick={() => { bridgePreview = bridgeSection; }}>Preview</button>
                  </div>
                  <p id="content-bridge-why" class="muted" data-testid="content-bridge-why">{brandDirty ? 'Save to preview your activities in this look.' : `Shows ${client.name}'s saved look (not unsaved changes), with the activity's real questions.`}</p>
                {/if}
              </section>
            {/if}
          {/if}
        </ContentView>
      {/each}
    {/key}
  {/if}

  {#if bridgePreview && client}
    <ActivityPreview section={bridgePreview} {client} onClose={() => { bridgePreview = null; }} {onToast}
      onChange={() => { void dataService.readLists([{ list: 'sections' }]).then((result) => { sections = (result as unknown as [Section[]])[0]; }).catch(() => {}); }} />
  {/if}
</section>

<style>
  /* The sticky part of the workspace (Phase 18): on a window wide and tall enough, the client header and the strip in one row under the top
     tabs; elsewhere only the strip. Its height is a custom property on the page, so the page's scroll padding and Brand's sticky preview allow
     for it (admin.css: --adm-nav-height, --adm-sticky-room). With the top tabs it takes at most a fifth of the window at 1366 by 768 and 1180
     by 820 (content-brand.spec.ts measures it). */
  :global(html:has(.content-spine)) {
    /* The strip alone: its track (a target and 3px round it) and the ring's room above and below, as the top tabs have it. */
    --adm-content-sticky: calc(var(--target-min) + 6px + 18px);
    --adm-sticky-top: calc(var(--adm-nav-height) + var(--adm-content-sticky));
    --adm-sticky-room: calc(5.5rem + var(--adm-content-sticky));
  }

  .content-spine {
    display: contents;
  }

  .content-client {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    margin-bottom: 0.5rem;
  }

  .content-client__chip {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--target-min);
    height: var(--target-min);
    overflow: clip;
    border: 1px solid var(--adm-line);
    border-radius: 8px;
    background: var(--adm-card);
    color: var(--adm-ink);
    font-size: 1.25rem;
    font-weight: var(--fw-bold);
  }

  .content-client__logo {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .content-client__label {
    margin: 0;
  }

  .content-client__pick {
    width: auto;
    min-width: 8rem;
    max-width: 16rem;
  }

  .content-strip {
    position: sticky;
    top: var(--adm-nav-height);
    z-index: 4;
    margin: 0 -0.75rem 1rem;
    padding: 9px 0.75rem;
    overflow-x: auto;
    scrollbar-width: thin;
    background: var(--adm-bg);
  }

  /* A second level, so it does not look like the top tabs (a line under the chosen one): a segmented control, the chosen view raised in
     white and in bold. */
  .content-strip__track {
    display: flex;
    gap: 3px;
    width: max-content;
    padding: 3px;
    border-radius: 0.75rem;
    background: var(--adm-idle-bg);
  }

  .content-strip__tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    min-height: var(--target-min);
    padding: 0 0.9rem;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--adm-ink);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .content-strip__tab[aria-selected='true'] {
    border-color: var(--adm-line);
    background: var(--adm-card);
    box-shadow: 0 1px 2px rgb(11 31 58 / 0.15);
  }

  .content-strip__label {
    font-weight: var(--fw-semibold);
  }

  .content-strip__tab[aria-selected='true'] .content-strip__label {
    font-weight: var(--fw-bold);
  }

  .content-strip__flag {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: var(--fw-semibold);
  }

  .content-strip__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--adm-warn-ink);
  }

  .content-bridge {
    display: grid;
    gap: 0.6rem;
    margin-top: 1.5rem;
    padding: 1rem;
  }

  .content-bridge h3,
  .content-bridge p {
    margin: 0;
  }

  .content-bridge__pick {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.6rem;
  }

  .content-bridge__pick .field__label {
    flex: 1 0 100%;
  }

  .content-bridge__pick .select {
    width: auto;
    min-width: 12rem;
    max-width: 100%;
  }

  /* Wide and tall enough: the header and the strip in one row, which sticks as one. */
  @media (min-width: 1100px) and (min-height: 700px) {
    :global(html:has(.content-spine)) {
      --adm-content-sticky: calc(var(--target-min) + 6px + 0.75rem + 1px);
    }

    .content-spine {
      position: sticky;
      top: var(--adm-nav-height);
      z-index: 4;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      height: var(--adm-content-sticky);
      margin-bottom: 1rem;
      padding: 0.375rem 0;
      border-bottom: 1px solid var(--adm-line);
      background: var(--adm-bg);
    }

    .content-client {
      flex-wrap: nowrap;
      margin-bottom: 0;
    }

    .content-strip {
      position: static;
      flex: none;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
  }
</style>
