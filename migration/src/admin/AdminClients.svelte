<script lang="ts">
  import { errorText } from '../lib/admin/session-notice.js';
  import { onMount, tick } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { PER_PAGE, hashWithPage, pageOfHash, pageRows, pagerState } from '../lib/common/paging.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { heldRead, holdRead } from '../lib/admin/list-cache.js';
  import Pager from './Pager.svelte';
  import Icon from './Icon.svelte';
  import MoreMenu from './MoreMenu.svelte';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import { viewById } from '../lib/admin/admin-content-views.js';
  import SampleNotice from './SampleNotice.svelte';
  import ClientTagChips from './ClientTagChips.svelte';
  import ClientWorkspace from './ClientWorkspace.svelte';
  import { confirmSampleClient, readSessionResponses } from '../lib/admin/adminData.js';
  import { withoutRetiredLogo } from '../lib/brand/retired-logos.js';
  import {
    MAX_CLIENT_NAME, clientProblems, clientRows, clientUsage, createClientRecord, defaultEventTitle, formOf, isClientLive, recentCodes, setClientStatus, slugProblem,
    updateClientRecord,
  } from '../lib/admin/admin-clients.js';
  import { liveStatus } from '../lib/admin/admin-today.js';
  import { copyText, participantPageUrl, qrImage } from '../lib/admin/admin-links.js';

  type Client = {
    id: string; name: string; slug?: string; status?: string; logoUrl?: string | null; primaryColor?: string; secondaryColor?: string; createdAt?: string;
    theme?: unknown; themeVersion?: number; industry?: string | null; region?: string | null;
  };
  type Session = { id: string; clientId: string; date?: string; status?: string };
  type Section = { id: string; clientId?: string | null; enabled?: boolean };
  type Track = { clientId: string };
  type Token = { id: string; clientId: string; sessionId: string; used?: boolean; expiredAt?: string | null; createdAt?: string };
  type CreatedToken = { id: string; sessionId: string };

  let { onToast, adminName = '', access = null, onNavigate = () => {} }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    adminName?: string;
    /** The signed-in person's access (lib/access), for the client's page: who may plan sessions and pick the team (Prompt 21, Phase 3). */
    access?: any;
    /** Opens another tab: Brand opens Content's Brand view on that client (Phase 18). */
    onNavigate?: (tab: string, to?: { view?: string; clientId?: string; rows?: { settings: unknown[]; clients: unknown[]; sections: unknown[] } }) => void;
  } = $props();
  /** Content's view of a client's look, which Brand opens. */
  type ClientRead = [{ id: string; activeSessionId?: string; activeClientId?: string }[], Client[], Session[], Section[]];
  const brand = viewById('brand');
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];

  let clients = $state<Client[]>([]);
  let clientsHeading = $state<HTMLElement>();
  let page = $state(pageOfHash(window.location.hash));
  let sessions = $state<Session[]>([]);
  let sections = $state<Section[]>([]);
  let liveClientId = $state<string | null>(null);
  /** AppSettings as last read: handed to Content with the clients and the activities when Brand opens a client there. */
  let settingsRows = $state<unknown[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let editorOpen = $state(false);
  let editing = $state<Client | null>(null);
  let name = $state('');
  let slug = $state('');
  let eventTitle = $state('');
  let eventSubtitle = $state('');
  let welcomeLine = $state('');
  let slugTouched = $state(false);
  let titleTouched = $state(false);
  /** More details: open when editing, shut for a new client; after that the person decides (an expression here was re-applied on each key). */
  let moreOpen = $state(false);
  let submitted = $state(false);
  let formError = $state('');
  let qrClient = $state<Client | null>(null);
  let qrToken = $state<CreatedToken | null>(null);
  let qrBase = $state('');
  let qrUrl = $state('');
  let qrSvg = $state('');
  let qrWarning = $state('');
  let qrSessionDate = $state('');
  let qrCodes = $state<Token[]>([]);
  /** The client whose page (its sessions and team) is open, Prompt 21 Phase 3: beside the list on a laptop, in its place below 1,100 px (Prompt 32). */
  let workspace = $state<Client | null>(null);
  /** (Prompt 33) The client's own details are being edited from its page: the editor is drawn there, under Client details. */
  const inWorkspace = $derived(Boolean(workspace && editing && editing.id === workspace.id));

  const rows = $derived(clientRows({ clients, sessions, sections, liveClientId }));
  const where = $derived(pagerState({ total: rows.length, pageSize: PER_PAGE.clients, page }));
  const shownRows = $derived(pageRows(rows, where));
  /** A change of page: kept in the address, so a reload comes back to it. */
  function goToPage(next: number) {
    page = next;
    try { window.history.replaceState(window.history.state, '', hashWithPage(window.location.hash, next)); } catch { /* the page still changes */ }
    void tick().then(() => { if (clientsHeading) focusHeading(clientsHeading); });
  }
  const editingRow = $derived(editing ? rows.find((row) => row.client.id === editing!.id) ?? null : null);
  const slugLocked = $derived(Boolean(editingRow?.slugLocked));
  const slugText = $derived(slugProblem(slug, { api: dataService, clients, editingId: editing?.id ?? null }));
  const problems = $derived(clientProblems({ name, slug, eventTitle, eventSubtitle, welcomeLine }, { api: dataService, clients, editingId: editing?.id ?? null }));

  onMount(() => {
    let active = true;
    void refresh().catch((cause) => { if (active) error = errorText(cause, 'Could not load clients.'); })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  /** One batch on SharePoint: the clients, who is live, and what the derived columns are made from. */
  async function refresh() {
    // (Prompt 26: drawn at once from what this page last read, while the read goes on behind; lib/admin/list-cache.js. A write this page sent means it is not held.)
    const held = heldRead('clients', dataService.writesSent() as number);
    if (held) { adopt(held as ClientRead); loading = false; }
    // (Each client's counts come from these two grouped reads, never one read a client. The sessions are an index since Prompt 26.)
    const read = await dataService.readLists([
      { list: 'appsettings' }, { list: 'clients' }, { list: 'sessions', columns: ['clientId', 'date', 'status', 'endedAt'] }, { list: 'sections' },
    ] as never) as unknown as ClientRead;
    if (holdRead('clients', read, dataService.writesSent() as number)) adopt(read);
    error = '';
  }

  function adopt([settingRows, clientRowsRead, sessionRows, sectionRows]: ClientRead) {
    clients = clientRowsRead;
    settingsRows = settingRows;
    sessions = sessionRows;
    sections = sectionRows;
    const settings = settingRows.find((row) => row.id === 'default') ?? null;
    const active = settings?.activeSessionId ? sessionRows.find((session) => session.id === settings.activeSessionId) ?? null : null;
    const status = liveStatus({ settings, session: active, clients: clientRowsRead } as never);
    liveClientId = status.live ? status.client.id : null;
  }

  /** "Mark as confirmed" on a sample client (Phase 9b, SAM-2): who and when are stored in its ThemeJson. */
  async function confirmSample(client: Client) {
    if (busy) return;
    busy = true;
    try {
      await confirmSampleClient(client.id, adminName);
      await refresh();
      onToast(`${client.name}: sample content confirmed`, 'success');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not record the confirmation.', 'error');
    } finally {
      busy = false;
    }
  }

  function openEditor(client: Client | null) {
    editing = client;
    const form = formOf(client);
    name = form.name;
    // A client made before slugs existed has none stored; its session ids use the one its name makes.
    slug = form.slug || (client ? dataService.slugify(client.name) as string : '');
    eventTitle = form.eventTitle || (client ? '' : defaultEventTitle(form.name));
    eventSubtitle = form.eventSubtitle;
    welcomeLine = form.welcomeLine;
    slugTouched = Boolean(client);
    titleTouched = Boolean(client);
    moreOpen = Boolean(client);
    submitted = false;
    formError = '';
    editorOpen = true;
  }

  /** A new client's slug and event title follow its name until someone types in them. */
  function nameChanged() {
    if (editing) return;
    if (!slugTouched) slug = dataService.slugify(name) as string;
    if (!titleTouched) eventTitle = defaultEventTitle(name);
  }

  async function saveClient(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    submitted = true;
    if (Object.keys(problems).length > 0) {
      formError = problems.name ?? problems.slug ?? 'Check the form.';
      return;
    }
    busy = true;
    formError = '';
    const form = { name, slug, eventTitle, eventSubtitle, welcomeLine };
    try {
      const added = !editing;
      if (editing) await updateClientRecord(dataService, editing, form, { slugLocked });
      else await createClientRecord(dataService, form);
      editorOpen = false;
      onToast(`Saved ${form.name}`, 'success');
      await refresh();
      if (workspace) workspace = clients.find((each) => each.id === workspace?.id) ?? workspace;
      // (Prompt 38: a new client opens on its own page, where its sessions, team and QR check-in are the next steps.)
      else if (added) workspace = clients.find((each) => each.slug === form.slug) ?? null;
    } catch (cause) {
      formError = cause instanceof Error ? cause.message : 'Could not save this client.';
    } finally {
      busy = false;
    }
  }

  async function changeStatus(client: Client, status: 'active' | 'archived') {
    if (busy) return;
    if (status === 'archived' && !window.confirm(`Archive ${client.name}? It stops appearing on Today and cannot go live until you restore it. Nothing is deleted.`)) return;
    busy = true;
    try {
      await setClientStatus(dataService, client, status);
      onToast(status === 'archived' ? `${client.name} archived` : `${client.name} restored`, 'success');
      await refresh();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not change this client.', 'error');
    } finally {
      busy = false;
    }
  }

  async function removeClient(client: Client) {
    if (busy) return;
    busy = true;
    try {
      // What is live and what refers to this client, read now: a client that is live today is never deleted, whatever else is
      // true of it. Its sessions are read by the client, and the visits, codes and answers by those sessions: no whole list.
      const usage = await clientUsage(dataService, client.id) as { live: boolean; sessions: Session[]; tracks: Track[]; tokens: Token[] };
      const answers = (await Promise.all(usage.sessions.map((session) => readSessionResponses(session.id))))
        .flat().filter((response) => response.clientId === client.id).length;
      const activities = sections.filter((section) => section.clientId === client.id).length;
      const usedBy = [
        usage.sessions.length > 0 && 'a session',
        usage.tracks.length > 0 && 'a client track',
        usage.tokens.length > 0 && 'a QR token',
        usage.live && "today's live session",
        activities > 0 && `${activities} activit${activities === 1 ? 'y' : 'ies'}`,
        answers > 0 && `${answers} recorded answer${answers === 1 ? '' : 's'}`,
      ].filter(Boolean);
      if (usedBy.length) {
        onToast(`Can't delete ${client.name}: it's used by ${usedBy.join(', ')}.`, 'error');
        return;
      }
      if (!window.confirm(`Delete ${client.name}?`)) return;
      await dataService.deleteClient(client.id);
      onToast('Client deleted', 'success');
      await refresh();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not delete this client.', 'error');
    } finally {
      busy = false;
    }
  }

  // ---- Check-in codes for iPads (staff sign-in). Guests with personal codes are under Guests and QR. ----

  function qrFailure(cause: unknown, client: Client) {
    const code = (cause as { code?: string } | null)?.code;
    if (['session-not-active', 'session-missing', 'client-session-mismatch'].includes(code ?? '')) return `${client.name} is not live. Go live with it on Today first; a check-in code joins the live session.`;
    if (code === 'visitor-required') return 'The live session is set to guests with personal codes. Make their codes under Guests and QR.';
    return cause instanceof Error ? cause.message : 'Could not create a check-in code.';
  }

  async function generateQr(client: Client) {
    busy = true;
    error = '';
    try {
      qrClient = client;
      if (!await isClientLive(dataService, client.id)) {
        throw Object.assign(new Error('not live'), { code: 'session-not-active' });
      }
      qrBase = await participantPageUrl();
      qrToken = await dataService.provisionQrToken(client.id) as CreatedToken;
      await paintQr();
    } catch (cause) {
      qrClient = null;
      onToast(qrFailure(cause, client), 'error');
    } finally {
      busy = false;
    }
  }

  async function paintQr() {
    if (!qrClient || !qrToken) return;
    qrWarning = '';
    qrSvg = '';
    const session = await dataService.getSession(qrToken.sessionId) as Session | null;
    qrSessionDate = session?.date ?? '';
    const base = (() => { try { const value = new URL(qrBase); return /^https?:$/.test(value.protocol) ? value : null; } catch { return null; } })();
    if (!base) qrWarning = 'Enter a full address, like https://your-site/path/index.html.';
    else if (localHosts.includes(base.hostname)) qrWarning = `Participant devices cannot open ${base.hostname}. Enter the address they use.`;
    if (base) {
      qrUrl = (dataService.qrUrl as (id: string, base: string) => string)(qrToken.id, qrBase);
      try {
        qrSvg = await qrImage(qrUrl);
      } catch (cause) {
        qrWarning = cause instanceof Error ? `Could not render the QR image: ${cause.message}` : 'Could not render the QR image.';
      }
    }
    qrCodes = await recentCodes(dataService, qrToken.sessionId, qrClient.id) as Token[];
  }

  async function createNewToken() {
    if (!qrClient || busy) return;
    busy = true;
    try {
      qrToken = await dataService.provisionQrToken(qrClient.id) as CreatedToken;
      await paintQr();
    } catch (cause) {
      onToast(qrFailure(cause, qrClient), 'error');
    } finally {
      busy = false;
    }
  }

  async function copyQrLink() {
    await copyText(qrUrl, document.querySelector<HTMLInputElement>('#qr-url'));
    onToast('Link copied', 'success');
  }

  function statusOf(token: Token) { return dataService.qrTokenStatus(token); }
</script>

{#snippet clientEditor()}
    <section class="content-editor" aria-labelledby="client-editor-heading">
      <h3 id="client-editor-heading">{editing ? `Edit client details: ${editing.name}` : 'Add a client'}</h3>
      <form class="editor-form" onsubmit={saveClient} novalidate>
        <div class="field"><span class="field__line"><label class="field__label" for="client-name">Name</label><span class="field__required">Required</span></span>
          <input id="client-name" class="input" bind:value={name} oninput={nameChanged} required maxlength={MAX_CLIENT_NAME} disabled={busy} aria-invalid={submitted && Boolean(problems.name)} aria-describedby={submitted && problems.name ? 'name-problem' : name.length >= MAX_CLIENT_NAME ? 'name-limit' : undefined} />
          {#if submitted && problems.name}<span id="name-problem" class="error small">{problems.name}</span>
          {:else if name.length >= MAX_CLIENT_NAME}<span id="name-limit" class="muted small">{MAX_CLIENT_NAME} characters: the most a client's name can hold.</span>{/if}
        </div>
        <span class="muted small" id="name-seen">Participants see this name on their screens.{editing ? '' : ' Sessions, the team and QR check-in come next, on the client\'s page.'}</span>
        <!-- (Prompt 38: a new client needs its name only; the rest is folded, with a line of what it holds now. Editing shows it open.) -->
        <details class="adm-fold client-more" bind:open={moreOpen}>
          <summary><Icon name="chevron-right" />More details <span class="adm-fold__summary">Short name {slug || 'from the name'} · title {eventTitle || defaultEventTitle(name) || 'from the name'}</span></summary>
          <div class="editor-form">
        <div class="field"><label class="field__label" for="client-slug">Short name in session ids</label>
          <input id="client-slug" class="input mono" bind:value={slug} oninput={() => { slugTouched = true; }} disabled={busy || slugLocked} autocapitalize="off" autocorrect="off" spellcheck="false" aria-invalid={Boolean(slug) && Boolean(slugText)} aria-describedby="slug-help" />
          <span id="slug-help" class="small" class:muted={!slugText || !slug} class:error={Boolean(slug) && Boolean(slugText)}>
            {#if slugLocked}Locked: this client already has sessions, and their ids start with the slug.
            {:else if slug && slugText}{slugText}
            {:else}Session ids are the slug, the date and the start time, like {slug || 'kroger'}-2026-10-11-0930. a to z, 0 to 9 and hyphens.{/if}
          </span>
        </div>
        <label class="field"><span class="field__label">Event title</span><input class="input" bind:value={eventTitle} oninput={() => { titleTouched = true; }} disabled={busy} placeholder={defaultEventTitle(name) || 'KROGER TRIVIA NIGHT'} /></label>
        <label class="field"><span class="field__label">Subtitle</span><input class="input" bind:value={eventSubtitle} disabled={busy} placeholder="One line under the title on the activities screen" /></label>
        <label class="field"><span class="field__label">Welcome line</span><input class="input" bind:value={welcomeLine} disabled={busy} placeholder={`Welcome to the ${name.trim() || 'Kroger'} experience.`} /></label>
          </div>
        </details>
        <p class="muted small">Colours, the logo, hero art and the background are set in Brand Studio{editing ? '' : ' once the client is added'}.</p>
        {#if formError}<p class="error" role="alert">{formError}</p>{/if}
        <div class="dialog__actions"><button class="btn" type="button" onclick={() => { editorOpen = false; }} disabled={busy}>Cancel</button><button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving...' : editing ? 'Save client' : 'Add client'}</button></div>
      </form>
    </section>
{/snippet}

<!-- Prompt 39: the title and Add client on one row above both columns; with a client open, the list is 4 of the 12 columns (at least 340 px)
     and its sessions and team 8, both on one top line. -->
<div class="clients" class:clients--open={workspace !== null}>
  <header class="panel__head clients__head">
    <div>
      <h2 bind:this={clientsHeading} tabindex="-1"><Icon name="building" />Clients</h2>
      <p class="muted">The clients you visit: open one to plan its sessions and choose its team, or open its Brand to set its look.</p>
    </div>
    <button class="btn btn--primary btn--with-icon" type="button" onclick={() => openEditor(null)} disabled={busy}><Icon name="plus" /> Add client</button>
  </header>
<section class="panel clients-panel clients__list" aria-busy={loading || busy} aria-label="Clients">
  {#if loading}<div class="adm-card adm-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p class="sr-only" role="status">Loading clients...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if clients.length === 0}<div class="adm-empty"><Icon name="building" /><p>No clients yet. Add the first one you are visiting.</p><button class="btn btn--with-icon" type="button" onclick={() => openEditor(null)} disabled={busy}><Icon name="plus" />Add client</button></div>
  {:else}
    <ul class="rows">
      {#each shownRows as row (row.client.id)}
        {@const client = row.client}
        <li class="row client-row" class:client-row--archived={row.archived} class:row--open={workspace?.id === client.id} aria-current={workspace?.id === client.id ? 'true' : undefined}>
          {#if withoutRetiredLogo(client.logoUrl)}<img class="logo" src={embeddedAssetUrl(withoutRetiredLogo(client.logoUrl) ?? '') ?? ''} alt="" onerror={(event) => { (event.currentTarget as HTMLImageElement).hidden = true; }} />{/if}
          <div class="row__main">
            <span class="row__title">{client.name}
              {#if row.liveNow}<span class="pill pill--live">LIVE NOW</span>{/if}
              <span class="pill" class:pill--archived={row.archived}>{row.archived ? 'Archived' : 'Active'}</span>
            </span>
            <ClientTagChips {client} />
            <span class="muted small">{row.activities} activit{row.activities === 1 ? 'y' : 'ies'} ({row.liveActivities} live) · Last live {row.lastLive ?? 'never'}{client.slug ? ` · ${client.slug}` : ''}</span>
            <SampleNotice {client} {busy} onConfirm={() => void confirmSample(client)} />
          </div>
          <div class="row__actions">
            <button class="btn" id="sessions-{client.id}" type="button" onclick={() => { workspace = client; }} disabled={busy} aria-label="Sessions and team: {client.name}">Sessions and team</button>
            <button class="btn" type="button" onclick={() => onNavigate('content', { view: brand.id, clientId: client.id, rows: { settings: settingsRows, clients, sections } })} disabled={busy} aria-label="{brand.label}: {client.name}">{brand.label}</button>
            <button class="btn" type="button" onclick={() => void generateQr(client)} disabled={busy || row.archived}>Generate QR</button>
            <button class="btn" type="button" onclick={() => openEditor(client)} disabled={busy}>Edit</button>
            <!-- (Prompt 38: Archive, Restore and Delete, needed now and then, are in the row's more menu; each still asks first.) -->
            <MoreMenu label="More actions for {client.name}" items={[
              row.archived
                ? { label: 'Restore', icon: 'refresh', onclick: () => void changeStatus(client, 'active'), disabled: busy }
                : { label: row.liveNow ? 'Archive (not while live)' : 'Archive', icon: 'eye-off', onclick: () => void changeStatus(client, 'archived'), disabled: busy || row.liveNow },
              { label: 'Delete', icon: 'trash', danger: true, onclick: () => void removeClient(client), disabled: busy },
            ]} />
          </div>
        </li>
      {/each}
    </ul>
    <Pager state={where} label="Pages of clients" onPage={goToPage} />
  {/if}

  {#if editorOpen && !inWorkspace}{@render clientEditor()}{/if}

  {#if qrClient && qrToken}
    <section class="content-editor qr-editor" aria-labelledby="qr-title">
      <h3 id="qr-title">QR check-in · {qrClient.name}</h3>
      <p class="muted">Joins the {qrSessionDate} session. One code per iPad.</p>
      {#if qrSvg}<img class="qr__image" src={qrSvg} alt="QR code that checks an iPad in" />{/if}
      {#if qrWarning}<p class="qr__warn" role="alert">{qrWarning}</p>{/if}
      <label class="field"><span class="field__label">Address the iPads use</span><input class="input" bind:value={qrBase} oninput={() => void paintQr()} inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" /></label>
      <div class="qr__url"><input id="qr-url" class="input" value={qrUrl} readonly aria-label="Check-in link" /><button class="btn" type="button" onclick={() => void copyQrLink()}>Copy</button><a class="btn" href={qrUrl} target="_blank" rel="noopener">Open</a></div>
      <ul class="rows rows--flat">
        {#each qrCodes as token (token.id)}
          <li class="row"><span>...{token.id.slice(-8)}{token.id === qrToken.id ? ' (showing)' : ''}</span><span class="pill pill--{statusOf(token)}">{statusOf(token)}</span>{#if statusOf(token) === 'unused' && token.id !== qrToken.id}<button class="btn btn--small" type="button" onclick={() => { qrToken = { id: token.id, sessionId: token.sessionId }; void paintQr(); }}>Show</button>{/if}</li>
        {/each}
      </ul>
      <div class="dialog__actions"><button class="btn" type="button" onclick={() => void createNewToken()} disabled={busy}>New code</button><button class="btn btn--primary" type="button" onclick={() => { qrClient = null; qrToken = null; }}>Done</button></div>
    </section>
  {/if}
</section>
{#if workspace}
  <div class="clients__detail">
    {#key workspace.id}
      <ClientWorkspace client={workspace} {clients} {access} {onToast} onEdit={() => { if (workspace) openEditor(workspace); }} editor={editorOpen && inWorkspace ? clientEditor : undefined} onBack={() => { const back = workspace?.id; workspace = null; void refresh().catch(() => {}); void tick().then(() => document.getElementById(`sessions-${back}`)?.focus()); }} />
    {/key}
  </div>
{/if}
</div>

<style>
  .clients {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0 var(--adm-gutter);
    align-items: start;
  }

  .clients > * {
    grid-column: 1 / -1;
    min-width: 0;
  }

  /* Below 1,100 px a client's page replaces the list, as before. */
  @media (max-width: 1099px) {
    .clients--open .clients__list {
      display: none;
    }
  }

  /* On a laptop the list stays on the left (4 of 12, at least 340 px) and the client's sessions and team open on the right (8 of 12). */
  @media (min-width: 1100px) {
    .clients--open {
      grid-template-columns: minmax(340px, 4fr) minmax(0, 8fr);
    }

    .clients--open .clients__list {
      grid-column: 1;
      grid-row: 2;
    }

    .clients--open .clients__detail {
      grid-column: 2;
      grid-row: 2;
    }

    .row--open {
      border-color: var(--adm-deep);
      box-shadow: inset 4px 0 0 var(--adm-deep);
    }
  }

  /* The actions right-aligned; in the full list, from 1,280 px, on one line. */
  .client-row {
    flex-wrap: wrap;
  }

  .client-row .row__actions {
    justify-content: flex-end;
    margin-left: auto;
  }

  @media (min-width: 1280px) {
    .clients:not(.clients--open) .client-row {
      flex-wrap: nowrap;
    }

    .clients:not(.clients--open) .client-row .row__actions {
      flex: none;
      flex-wrap: nowrap;
    }
  }

  .client-row--archived .row__title {
    color: var(--adm-muted);
  }

  .row__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--adm-s2);
  }

  .row__title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .pill--live {
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
    letter-spacing: 0.03em;
  }

  .pill--archived {
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .error {
    color: var(--adm-bad-ink);
  }
</style>
