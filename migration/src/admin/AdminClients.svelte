<script lang="ts">
  import { errorText } from '../lib/admin/session-notice.js';
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import { viewById } from '../lib/admin/admin-content-views.js';
  import SampleNotice from './SampleNotice.svelte';
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
    theme?: unknown; themeVersion?: number;
  };
  type Session = { id: string; clientId: string; date?: string; status?: string };
  type Section = { id: string; clientId?: string | null; enabled?: boolean };
  type Track = { clientId: string };
  type Token = { id: string; clientId: string; sessionId: string; used?: boolean; expiredAt?: string | null; createdAt?: string };
  type CreatedToken = { id: string; sessionId: string };

  let { onToast, adminName = '', onNavigate = () => {} }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    adminName?: string;
    /** Opens another tab: Brand opens Content's Brand view on that client (Phase 18). */
    onNavigate?: (tab: string, to?: { view?: string; clientId?: string; rows?: { settings: unknown[]; clients: unknown[]; sections: unknown[] } }) => void;
  } = $props();
  /** Content's view of a client's look, which Brand opens. */
  const brand = viewById('brand');
  const localHosts = ['localhost', '127.0.0.1', '[::1]'];

  let clients = $state<Client[]>([]);
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

  const rows = $derived(clientRows({ clients, sessions, sections, liveClientId }));
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
    const [settingRows, clientRowsRead, sessionRows, sectionRows] = await dataService.readLists([
      { list: 'appsettings' }, { list: 'clients' }, { list: 'sessions' }, { list: 'sections' },
    ]) as [{ id: string; activeSessionId?: string; activeClientId?: string }[], Client[], Session[], Section[]];
    clients = clientRowsRead;
    settingsRows = settingRows;
    sessions = sessionRows;
    sections = sectionRows;
    const settings = settingRows.find((row) => row.id === 'default') ?? null;
    const active = settings?.activeSessionId ? sessionRows.find((session) => session.id === settings.activeSessionId) ?? null : null;
    const status = liveStatus({ settings, session: active, clients: clientRowsRead } as never);
    liveClientId = status.live ? status.client.id : null;
    error = '';
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
      if (editing) await updateClientRecord(dataService, editing, form, { slugLocked });
      else await createClientRecord(dataService, form);
      editorOpen = false;
      onToast('Saved', 'success');
      await refresh();
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

<section class="panel clients-panel" aria-busy={loading || busy}>
  <header class="panel__head">
    <div>
      <h2>Clients</h2>
      <p class="muted">Add, edit and archive clients, with each one's event title, subtitle, welcome line. <strong>{brand.label}</strong> opens the client's {brand.label} view in Content, beside its activities: the colours, logo, hero art and background, with a preview on a phone, an iPad and a desktop. A new client starts with the standard blue. Check-in codes for iPads (staff sign-in) are made here; personal codes for guests are under Guests and QR.</p>
    </div>
    <button class="btn btn--primary" type="button" onclick={() => openEditor(null)} disabled={busy}>Add client</button>
  </header>
  {#if loading}<p role="status">Loading clients...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if clients.length === 0}<p class="muted">No clients yet.</p>
  {:else}
    <ul class="rows">
      {#each rows as row (row.client.id)}
        {@const client = row.client}
        <li class="row client-row" class:client-row--archived={row.archived}>
          {#if withoutRetiredLogo(client.logoUrl)}<img class="logo" src={embeddedAssetUrl(withoutRetiredLogo(client.logoUrl) ?? '') ?? ''} alt="" onerror={(event) => { (event.currentTarget as HTMLImageElement).hidden = true; }} />{/if}
          <div class="row__main">
            <span class="row__title">{client.name}
              {#if row.liveNow}<span class="pill pill--live">LIVE NOW</span>{/if}
              <span class="pill" class:pill--archived={row.archived}>{row.archived ? 'Archived' : 'Active'}</span>
            </span>
            <span class="muted small">{row.activities} activit{row.activities === 1 ? 'y' : 'ies'} ({row.liveActivities} live) · Last live {row.lastLive ?? 'never'}{client.slug ? ` · ${client.slug}` : ''}</span>
            <SampleNotice {client} {busy} onConfirm={() => void confirmSample(client)} />
          </div>
          <div class="row__actions">
            <button class="btn" type="button" onclick={() => onNavigate('content', { view: brand.id, clientId: client.id, rows: { settings: settingsRows, clients, sections } })} disabled={busy} aria-label="{brand.label}: {client.name}">{brand.label}</button>
            <button class="btn" type="button" onclick={() => void generateQr(client)} disabled={busy || row.archived}>Generate QR</button>
            <button class="btn" type="button" onclick={() => openEditor(client)} disabled={busy}>Edit</button>
            {#if row.archived}
              <button class="btn" type="button" onclick={() => void changeStatus(client, 'active')} disabled={busy}>Restore</button>
            {:else}
              <button class="btn" type="button" onclick={() => void changeStatus(client, 'archived')} disabled={busy || row.liveNow} title={row.liveNow ? 'A live client cannot be archived' : undefined}>Archive</button>
            {/if}
            <button class="btn btn--danger" type="button" onclick={() => void removeClient(client)} disabled={busy}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if editorOpen}
    <section class="content-editor" aria-labelledby="client-editor-heading">
      <h3 id="client-editor-heading">{editing ? 'Edit client' : 'Add client'}</h3>
      <form class="editor-form" onsubmit={saveClient} novalidate>
        <div class="field"><label class="field__label" for="client-name">Name</label>
          <input id="client-name" class="input" bind:value={name} oninput={nameChanged} required maxlength={MAX_CLIENT_NAME} disabled={busy} aria-invalid={submitted && Boolean(problems.name)} aria-describedby={submitted && problems.name ? 'name-problem' : name.length >= MAX_CLIENT_NAME ? 'name-limit' : undefined} />
          {#if submitted && problems.name}<span id="name-problem" class="error small">{problems.name}</span>
          {:else if name.length >= MAX_CLIENT_NAME}<span id="name-limit" class="muted small">{MAX_CLIENT_NAME} characters: the most a client's name can hold.</span>{/if}
        </div>
        <div class="field"><label class="field__label" for="client-slug">Slug</label>
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
        <p class="muted small">Colours, the logo, hero art and the background are set in Brand Studio{editing ? '' : ' once the client is added'}.</p>
        {#if formError}<p class="error" role="alert">{formError}</p>{/if}
        <div class="dialog__actions"><button class="btn" type="button" onclick={() => { editorOpen = false; }} disabled={busy}>Cancel</button><button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
    </section>
  {/if}

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

<style>
  .client-row {
    flex-wrap: wrap;
  }

  .client-row--archived .row__title {
    color: var(--adm-muted);
  }

  .row__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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
