<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { loadGuestState, refreshGuestState, type GuestState, type GuestToken, type GuestVisitor } from '../lib/admin/adminData.js';
  import { copyText, participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import {
    MAX_GUEST_NAME, completedTrackIds, csvFileName, guestKey, guestRows, guestsCsv, parseGuestNames, pasteSummary, printCards, statusCounts,
  } from '../lib/admin/admin-content.js';

  type QrDisplay = { visitor: GuestVisitor; url: string; image: string };
  type Progress = { label: string; done: number; total: number };
  let { onToast, onNavigate, onPrint }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    onNavigate: (tab: string) => void;
    /** Opens the print-optimised view of the QR cards. */
    onPrint: () => void;
  } = $props();

  // Guests and QR works on the session that is live. A personal code can only be made for the live
  // session (provisionQrToken and provisionGuestCodes refuse any other), and the live session is the
  // one Today governs. Every status here is read from the roster, the codes, the tracks and the answers.
  let guestState = $state<GuestState | null>(null);
  let visitorName = $state('');
  let pasted = $state('');
  let qrDisplay = $state<QrDisplay | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let progress = $state<Progress | null>(null);
  let report = $state<{ level: 'success' | 'warning' | 'error'; text: string } | null>(null);
  let error = $state('');
  let controller: AbortController | null = null;

  const session = $derived(guestState?.session ?? null);
  const client = $derived(guestState?.client ?? null);
  const guestMode = $derived(session?.participationMode === 'client-visit');
  const ended = $derived(session?.status === 'completed');
  const completed = $derived(guestState ? completedTrackIds({ tracks: guestState.tracks, responses: guestState.responses, sections: guestState.sections }) : new Set<string>());
  const rows = $derived(guestState ? guestRows({ visitors: guestState.visitors, tokens: guestState.tokens, tracks: guestState.tracks, completed }) : []);
  const counts = $derived(statusCounts(rows));
  const parsed = $derived(parseGuestNames(pasted, { existing: (guestState?.visitors ?? []).map((visitor) => visitor.displayName) }));
  const cardCount = $derived(printCards(rows, (id) => id).cards.length);
  const missing = $derived(counts.none);

  onMount(() => {
    let active = true;
    let polling = false;
    void load().catch((cause) => { if (active) error = cause instanceof Error ? cause.message : 'Could not load Guests and QR.'; })
      .finally(() => { if (active) loading = false; });

    // Who has joined, and who has finished, while the tab is on show: the roster, the codes and the
    // tracks in one request every 15 s, the answers too once a guest has joined; nothing while hidden or busy.
    const timer = window.setInterval(() => {
      if (document.hidden || polling || busy || loading || !guestState) return;
      polling = true;
      void refresh().catch(() => {}).finally(() => { polling = false; });
    }, 15_000);
    return () => { active = false; window.clearInterval(timer); controller?.abort(); };
  });

  async function load() {
    guestState = await loadGuestState();
  }

  async function refresh() {
    if (!guestState) return;
    const next = await refreshGuestState(guestState);
    guestState = next ?? await loadGuestState();
  }

  function explain(cause: unknown, fallback: string) {
    const code = (cause as { code?: string } | null)?.code;
    if (code === 'session-not-active') return 'This session is no longer the live one. Go live with it on Today before creating codes.';
    return cause instanceof Error ? cause.message : fallback;
  }

  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  // ---- Adding guests ---------------------------------------------------------------------------------

  async function addVisitor(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !session || !visitorName.trim()) return;
    busy = true;
    error = '';
    try {
      const single = parseGuestNames(visitorName.replace(/[,;]/g, ' '), { existing: (guestState?.visitors ?? []).map((visitor) => visitor.displayName) });
      if (single.names.length === 0) throw new Error(`${single.duplicates[0]?.name ?? visitorName.trim()} is already on the list.`);
      const visitor = await dataService.createVisitor({ sessionId: session.id, displayName: single.names[0], enabled: true }) as GuestVisitor;
      guestState = guestState ? { ...guestState, visitors: [...guestState.visitors, visitor] } : guestState;
      visitorName = '';
      onToast('Visitor added', 'success');
    } catch (cause) {
      error = explain(cause, 'Could not add this visitor.');
    } finally {
      busy = false;
    }
  }

  async function addPasted() {
    if (busy || !session || parsed.names.length === 0) return;
    busy = true;
    error = '';
    report = null;
    controller = new AbortController();
    progress = { label: 'Adding guests', done: 0, total: parsed.names.length };
    try {
      const result = await dataService.addGuests(session.id, parsed.names, { onProgress: (step: { done: number; total: number }) => { progress = { label: 'Adding guests', ...step }; }, signal: controller.signal }) as unknown as {
        added: unknown[]; skipped: string[]; failed: { name: string; error: Error }[]; notAttempted: string[]; stopped: string | null;
      };
      const problem = result.failed.length + result.notAttempted.length;
      report = problem
        ? { level: result.added.length ? 'warning' : 'error', text: `Added ${result.added.length} of ${parsed.names.length}. ${plural(problem, 'name was', 'names were')} not added (${result.failed[0]?.error.message ?? 'stopped'}). Press Add again: names already on the list are skipped.` }
        : { level: 'success', text: `Added ${plural(result.added.length, 'guest', 'guests')}.${result.skipped.length ? ` ${plural(result.skipped.length, 'name was', 'names were')} already on the list.` : ''}` };
      if (!problem) pasted = '';
      else pasted = [...result.failed.map((entry) => entry.name), ...result.notAttempted].join('\n');
      await refresh();
    } catch (cause) {
      error = explain(cause, 'Could not add these guests.');
    } finally {
      busy = false;
      progress = null;
      controller = null;
    }
  }

  // ---- Codes -------------------------------------------------------------------------------------------

  function tokenFor(visitorId: string): GuestToken | null {
    return rows.find((row) => row.visitor.id === visitorId)?.code ?? null;
  }

  async function generateAll() {
    if (busy || !session || missing === 0) return;
    busy = true;
    error = '';
    report = null;
    qrDisplay = null;
    controller = new AbortController();
    progress = { label: 'Making codes', done: 0, total: missing };
    try {
      const result = await dataService.provisionGuestCodes(session.id, { onProgress: (step: { done: number; total: number }) => { progress = { label: 'Making codes', ...step }; }, signal: controller.signal }) as unknown as {
        created: unknown[]; alreadyHad: number; failed: { error: Error }[]; notAttempted: string[]; stopped: string | null;
      };
      const problem = result.failed.length + result.notAttempted.length;
      report = problem
        ? { level: result.created.length ? 'warning' : 'error', text: `Made ${result.created.length} codes. ${plural(problem, 'guest has', 'guests have')} no code yet (${result.failed[0]?.error.message ?? 'stopped'}). Press Generate all codes again: guests who have a code are skipped.` }
        : { level: 'success', text: result.created.length ? `Made ${plural(result.created.length, 'code', 'codes')}. Everyone who can scan has one.` : 'Nobody was missing a code.' };
      await refresh();
    } catch (cause) {
      error = explain(cause, 'Could not make the codes.');
    } finally {
      busy = false;
      progress = null;
      controller = null;
    }
  }

  async function setVisitorEnabled(visitor: GuestVisitor) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await dataService.setVisitorEnabled(visitor.id, visitor.enabled === false);
      await refresh();
    } catch (cause) {
      error = explain(cause, 'Could not update this visitor.');
    } finally {
      busy = false;
    }
  }

  async function showQr(visitor: GuestVisitor, replace = false) {
    if (busy || !session || !guestState) return;
    busy = true;
    error = '';
    qrDisplay = null;
    try {
      let token = tokenFor(visitor.id);
      const generated = replace || !token || token.used === true;
      if (generated) {
        if (replace && token && !token.used) await dataService.updateQrToken(token.id, { used: true, expiredAt: new Date().toISOString() });
        token = await dataService.provisionQrToken(session.clientId, session.id, { visitorId: visitor.id }) as GuestToken;
      }
      if (!token || token.expiredAt) throw new Error('This visitor code is no longer available. Generate a new code.');
      const url = (dataService.qrUrl as (id: string, base: string) => string)(token.id, await participantPageUrl());
      qrDisplay = { visitor, url, image: await qrImage(url) };
      await refresh();
      onToast(generated ? 'New visitor code generated' : 'Visitor code opened', 'info');
    } catch (cause) {
      error = explain(cause, 'Could not generate the visitor QR code.');
    } finally {
      busy = false;
    }
  }

  // ---- The list, as a file ---------------------------------------------------------------------------

  function exportCsv() {
    const blob = new Blob([guestsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const address = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = address;
    link.download = csvFileName({ clientName: client?.name ?? '', date: session?.date ?? '' });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(address), 2000);
    onToast(`Saved ${link.download}`, 'success');
  }

  async function copyLink() {
    if (!qrDisplay) return;
    await copyText(qrDisplay.url, document.querySelector<HTMLInputElement>('#guest-qr-url'));
    onToast('Link copied', 'success');
  }

  const pillClass: Record<string, string> = { none: '', waiting: 'pill--unused', joined: 'pill--in-progress', completed: 'pill--completed', disabled: '' };
</script>

<section class="panel guests-panel" aria-busy={loading || busy}>
  <header class="panel__head">
    <div><h2>Guests and QR</h2><p class="muted">Add the guests for the live session, give each a single-use QR code, and print the codes. Who is identified how is set on Today.</p></div>
  </header>
  {#if loading}<p role="status">Loading Guests and QR...</p>
  {:else if error && !session}<p class="error" role="alert">{error}</p>
  {:else if !session}
    <p class="muted">Nothing is live, so there is no session to add guests to. Go live on Today first; codes can only be made for the live session.</p>
    <button class="btn btn--primary" type="button" onclick={() => onNavigate('today')}>Open Today</button>
  {:else}
    <p class="muted">Live session: <strong>{client?.name ?? session.clientId}</strong>, {session.date ?? 'undated'}{ended ? ' (ended)' : ''}. Only this session is offered on participant devices.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if guestMode}
      <section class="user-setup__roster" aria-labelledby="roster-heading">
        <div class="panel__head">
          <div>
            <h3 id="roster-heading">Visitor roster</h3>
            <p class="muted" data-testid="guest-summary">
              {#if rows.length === 0}No guests yet.{:else}{plural(rows.length, 'guest', 'guests')}: {counts.none} no code, {counts.waiting} not scanned, {counts.joined} joined, {counts.completed} completed{counts.disabled ? `, ${counts.disabled} disabled` : ''}.{/if}
            </p>
          </div>
          <div class="panel__actions guests-actions">
            <button class="btn btn--primary" type="button" onclick={() => void generateAll()} disabled={busy || ended || missing === 0} title={missing === 0 ? 'Everyone who can scan already has a code' : undefined}>Generate all codes{missing ? ` (${missing})` : ''}</button>
            <button class="btn" type="button" onclick={onPrint} disabled={busy || cardCount === 0} title={cardCount === 0 ? 'Make codes first: no guest has a code waiting to be scanned' : undefined}>Print QR sheet{cardCount ? ` (${cardCount})` : ''}</button>
            <button class="btn" type="button" onclick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
            <button class="btn" type="button" onclick={() => void refresh()} disabled={busy}>Refresh</button>
          </div>
        </div>

        {#if progress}
          <div role="status" class="guests-progress" data-testid="guest-progress">
            <p><strong>{progress.label}</strong>: {progress.done} of {progress.total}</p>
            <progress max={progress.total} value={progress.done} aria-label={progress.label}></progress>
          </div>
        {/if}
        {#if report}<p class="guests-report guests-report--{report.level}" role="status" data-testid="guest-report">{report.text}</p>{/if}

        <div class="guests-add">
          <div class="field">
            <label class="field__label" for="paste-names">Paste names</label>
            <textarea id="paste-names" class="input" rows="4" bind:value={pasted} placeholder={'One name per line, or separated by commas:\nJordan Lee\nCasey Park, Morgan Day'} disabled={busy || ended} aria-describedby="paste-summary"></textarea>
            <span id="paste-summary" class="muted small" data-testid="paste-summary">{pasted.trim() ? `${pasteSummary(parsed)} Commas separate names, so write "Jordan Lee", not "Lee, Jordan". A name is kept to ${MAX_GUEST_NAME} characters.` : `One name per line, or separated by commas. Names already on the list are skipped. A name is kept to ${MAX_GUEST_NAME} characters.`}</span>
          </div>
          <button class="btn" type="button" onclick={() => void addPasted()} disabled={busy || ended || parsed.names.length === 0}>{parsed.names.length > 0 ? `Add ${plural(parsed.names.length, 'guest', 'guests')}` : 'Add guests'}</button>
        </div>
        <form class="field-row" onsubmit={addVisitor}>
          <label class="field"><span class="field__label">Visitor name</span><input class="input" bind:value={visitorName} maxlength={MAX_GUEST_NAME} autocomplete="off" disabled={busy || ended} /></label>
          <button class="btn" type="submit" disabled={busy || ended || !visitorName.trim()}>Add visitor</button>
        </form>

        {#if rows.length === 0}<p class="muted">No visitors added for this session.</p>
        {:else}
          <ul class="rows rows--flat">
            {#each rows as row (row.visitor.id)}
              {@const visitor = row.visitor}
              <li class="row" data-guest={guestKey(visitor.displayName)} data-status={row.key}>
                <div class="row__main"><span class="row__title">{visitor.displayName}</span><span class="muted"><span class="pill {pillClass[row.key]}">{row.label}</span></span></div>
                <div class="row__actions">
                  <button class="btn btn--small" type="button" onclick={() => void setVisitorEnabled(visitor)} disabled={busy || ended}>{visitor.enabled === false ? 'Enable' : 'Disable'}</button>
                  {#if row.key === 'disabled'}
                    <!-- nothing else for a guest who is switched off -->
                  {:else if row.joined && !row.code?.used}
                    <button class="btn btn--small" type="button" onclick={() => void showQr(visitor)} disabled={busy || ended}>Show QR</button>
                    <button class="btn btn--small" type="button" onclick={() => void showQr(visitor, true)} disabled={busy || ended}>Replace code</button>
                  {:else if row.joined}
                    <button class="btn btn--small" type="button" onclick={() => void showQr(visitor, true)} disabled={busy || ended}>New visit code</button>
                  {:else}
                    <button class="btn btn--small" type="button" onclick={() => void showQr(visitor)} disabled={busy || ended}>{row.code ? 'Show QR' : 'Generate QR'}</button>{#if row.code}<button class="btn btn--small" type="button" onclick={() => void showQr(visitor, true)} disabled={busy || ended}>Replace code</button>{/if}
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
        {#if qrDisplay}
          <section class="content-editor user-setup__qr" aria-labelledby="visitor-qr-heading">
            <h3 id="visitor-qr-heading">Check-in code for {qrDisplay.visitor.displayName}</h3>
            <img class="qr__image" src={qrDisplay.image} alt={`Single-use check-in QR code for ${qrDisplay.visitor.displayName}`} />
            <div class="field"><label class="field__label" for="guest-qr-url">Participant link</label>
              <div class="qr__url qr__url--short"><input id="guest-qr-url" class="input" readonly value={qrDisplay.url} /><button class="btn" type="button" onclick={() => void copyLink()}>Copy link</button></div>
            </div>
          </section>
        {/if}
      </section>
    {:else}
      <p class="hint">Staff sign in is on: participants are greeted by their signed-in SharePoint display name and need no code. To use personal QR codes for guests, choose "Guests scan a personal QR" on Today.</p>
      <button class="btn" type="button" onclick={() => onNavigate('today')}>Open Today</button>
    {/if}
    <section class="user-setup__visits" aria-labelledby="visit-log-heading">
      <h3 id="visit-log-heading">Recent app entries</h3>
      {#if (guestState?.visits ?? []).length === 0}<p class="muted">No visits recorded for this session yet.</p>
      {:else}<ul class="rows rows--flat">{#each (guestState?.visits ?? []).slice(-12).reverse() as visit (visit.id)}
        <li class="row"><div class="row__main"><span class="row__title">{visit.visitorName || visit.displayName || 'Signed-in user'}</span><span class="muted">{visit.entryMode === 'client-visit' ? 'Client visit' : 'SharePoint account'} · {visit.visitedAt ? new Date(visit.visitedAt).toLocaleString() : 'Time unavailable'}</span></div></li>
      {/each}</ul>{/if}
    </section>
  {/if}
</section>
