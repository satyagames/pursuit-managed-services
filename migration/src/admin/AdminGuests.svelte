<script lang="ts">
  import { errorText } from '../lib/admin/session-notice.js';
  import { onMount, tick } from 'svelte';
  import GuestAvatar from '../components/GuestAvatar.svelte';
  import GuestPicture from './GuestPicture.svelte';
  import { clearGuestPicture, picturesLine, setGuestPicture } from '../lib/admin/guest-picture.js';
  import type { Prepared } from '../lib/brand/asset-image.js';
  import * as dataService from '../lib/data/dataService.js';
  import { PER_PAGE, pageRows, pagerState } from '../lib/common/paging.js';
  import { focusHeading } from '../lib/common/focus.js';
  import Pager from './Pager.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import Fold from './Fold.svelte';
  import { loadGuestState, refreshGuestState, type GuestState, type GuestToken, type GuestVisitor } from '../lib/admin/adminData.js';
  import { copyText, participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import { isAccessDenied } from '../lib/access/access-denied.js';
  import { reachOf, readQueries } from '../lib/access/scope.js';
  import {
    MAX_GUEST_GROUP, MAX_GUEST_NAME, completedTrackIds, csvFileName, guestGroups, guestKey, guestRows, guestsCsv, inGroup, parseGuestList, parseGuestNames, pasteSummary, printCards, statusCounts, tidyGroup,
  } from '../lib/admin/admin-content.js';

  type QrDisplay = { visitor: GuestVisitor; url: string; image: string };
  type Progress = { label: string; done: number; total: number };
  let { access = null, onToast, onNavigate, onPrint }: {
    /** The signed-in person's access (Phase 4): the live session is shown only when it is one they hold. */
    access?: any;
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
  /** Add many at once: the person opens and shuts it; it opens by itself only to hand back names that were not added. */
  let pasteOpen = $state(false);
  /** A guest's group (Prompt 21, Phase 4): for the one added, and for each pasted line that names none; and the group the list is narrowed to. */
  let visitorGroup = $state('');
  let pasteGroup = $state('');
  let groupFilter = $state('');
  let qrDisplay = $state<QrDisplay | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let progress = $state<Progress | null>(null);
  let report = $state<{ level: 'success' | 'warning' | 'error'; text: string } | null>(null);
  let error = $state('');
  /** The live session is not one this role holds (Phase 4): nothing of it is read, and the screen says so. */
  let elsewhere = $state(false);
  let controller: AbortController | null = null;
  /** A guest's picture (Prompt 23): whose dialog is open, or the form's, and the one the form holds until its guest exists. */
  let picturing = $state<GuestVisitor | 'new' | null>(null);
  let newPicture = $state<Prepared | null>(null);
  let pictureBusy = $state(false);

  const session = $derived(guestState?.session ?? null);
  const client = $derived(guestState?.client ?? null);
  const guestMode = $derived(session?.participationMode === 'client-visit');
  const ended = $derived(session?.status === 'completed');
  const completed = $derived(guestState ? completedTrackIds({ tracks: guestState.tracks, responses: guestState.responses, sections: guestState.sections }) : new Set<string>());
  const rows = $derived(guestState ? guestRows({ visitors: guestState.visitors, tokens: guestState.tokens, tracks: guestState.tracks, completed }) : []);
  const counts = $derived(statusCounts(rows));
  const parsedList = $derived(parseGuestList(pasted, { existing: (guestState?.visitors ?? []).map((visitor) => visitor.displayName), group: pasteGroup }));
  const parsed = $derived({ ...parsedList, names: parsedList.guests.map((guest) => guest.name) });
  const groups = $derived(guestGroups(guestState?.visitors ?? []));
  let guestSearch = $state('');
  let guestPage = $state(1);
  let rosterHeading = $state<HTMLElement>();
  const matching = $derived(inGroup(rows.map((row) => ({ ...row, guestGroup: row.visitor.guestGroup })), groupFilter)
    .filter((row) => String(row.visitor.displayName ?? '').toLowerCase().includes(guestSearch.trim().toLowerCase())));
  const guestPager = $derived(pagerState({ total: matching.length, pageSize: PER_PAGE.guests, page: guestPage }));
  const shownRows = $derived(pageRows(matching, guestPager));
  const cardCount = $derived(printCards(rows, (id) => id).cards.length);
  const missing = $derived(counts.none);
  /** (Prompt 33) The three steps, in the order they are done: add the guests, make their codes, print or share them. */
  const addedDone = $derived(rows.length > 0);
  const codesDone = $derived(addedDone && missing === 0);
  const step = $derived(!addedDone ? 1 : !codesDone ? 2 : 3);
  const makeWhy = $derived(ended ? 'The session has ended.' : rows.length === 0 ? 'Add at least one guest first.' : missing === 0 ? 'Everyone who can scan already has a code.' : '');
  const printWhy = $derived(cardCount === 0 ? 'Make codes first: no guest has a code waiting to be scanned.' : '');
  /** Recent app entries, newest first: what the guest state already holds (nothing is read for the fold). */
  const recent = $derived((guestState?.visits ?? []).slice(-12).reverse());
  const recentSummary = $derived(recent.length === 0 ? 'none yet' : `${recent.length}, latest ${recent[0].visitedAt ? new Date(recent[0].visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'time unavailable'}`);

  onMount(() => {
    let active = true;
    let polling = false;
    void load().catch((cause) => { if (active) error = errorText(cause, 'Could not load Guests and QR.'); })
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
    // (A role that holds some places first reads their sessions, so that the data layer knows whose each is; the live session is then read only if it is theirs.)
    const reach = access ? reachOf(access) : null;
    try {
      if (reach && !reach.all) await dataService.readLists(readQueries(reach, 'sessions'));
      guestState = await loadGuestState();
    } catch (cause) {
      if (!isAccessDenied(cause)) throw cause;
      elsewhere = true;
    }
  }

  async function refresh() {
    if (!guestState) return;
    const next = await refreshGuestState(guestState);
    guestState = next ?? await loadGuestState();
  }

  function explain(cause: unknown, fallback: string) {
    const code = (cause as { code?: string } | null)?.code;
    if (code === 'session-not-active') return 'This session is no longer the live one. Go live with it on Today before creating codes.';
    return errorText(cause, fallback);
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
      const group = tidyGroup(visitorGroup);
      const visitor = await dataService.createVisitor({ sessionId: session.id, displayName: single.names[0], enabled: true, ...(group ? { guestGroup: group } : {}) }) as GuestVisitor;
      guestState = guestState ? { ...guestState, visitors: [...guestState.visitors, visitor] } : guestState;
      visitorName = '';
      visitorGroup = '';
      onToast('Visitor added', 'success');
      if (newPicture) {
        const held = newPicture;
        newPicture = null;
        await storePicture(visitor, held);
      }
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
      const result = await dataService.addGuests(session.id, parsedList.guests, { onProgress: (step: { done: number; total: number }) => { progress = { label: 'Adding guests', ...step }; }, signal: controller.signal }) as unknown as {
        added: unknown[]; skipped: string[]; failed: { name: string; error: Error }[]; notAttempted: string[]; stopped: string | null;
      };
      const problem = result.failed.length + result.notAttempted.length;
      report = problem
        ? { level: result.added.length ? 'warning' : 'error', text: `Added ${result.added.length} of ${parsed.names.length}. ${plural(problem, 'name was', 'names were')} not added (${result.failed[0]?.error.message ?? 'stopped'}). Press Add again: names already on the list are skipped.` }
        : { level: 'success', text: `Added ${plural(result.added.length, 'guest', 'guests')}.${result.skipped.length ? ` ${plural(result.skipped.length, 'name was', 'names were')} already on the list.` : ''}` };
      if (!problem) pasted = '';
      else pasteOpen = true;
      if (problem) pasted = [...result.failed.map((entry) => entry.name), ...result.notAttempted].map((name) => { const group = parsedList.guests.find((guest) => guest.name === name)?.group; return group ? `${name} | ${group}` : name; }).join('\n');
      await refresh();
    } catch (cause) {
      error = explain(cause, 'Could not add these guests.');
    } finally {
      busy = false;
      progress = null;
      controller = null;
    }
  }

  // ---- A guest's picture (Prompt 23) -----------------------------------------------------------------

  const withVisitor = (updated: GuestVisitor) => {
    guestState = guestState ? { ...guestState, visitors: guestState.visitors.map((visitor) => (visitor.id === updated.id ? updated : visitor)) } : guestState;
  };

  async function storePicture(visitor: GuestVisitor, prepared: Prepared) {
    pictureBusy = true;
    error = '';
    try {
      withVisitor(await setGuestPicture({ data: dataService, access, visitor, blob: prepared.blob }) as GuestVisitor);
      picturing = null;
      onToast('Picture saved', 'success');
    } catch (cause) {
      error = explain(cause, 'Could not save this picture.');
      picturing = null;
    } finally {
      pictureBusy = false;
      URL.revokeObjectURL(prepared.url);
    }
  }

  async function removePicture(visitor: GuestVisitor) {
    pictureBusy = true;
    error = '';
    try {
      withVisitor(await clearGuestPicture({ data: dataService, access, visitor }) as GuestVisitor);
      picturing = null;
      onToast('Picture removed', 'success');
    } catch (cause) {
      error = explain(cause, 'Could not remove this picture.');
    } finally {
      pictureBusy = false;
    }
  }

  function picturePicked(prepared: Prepared) {
    if (picturing === 'new') { newPicture = prepared; picturing = null; return; }
    if (picturing) void storePicture(picturing, prepared);
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
        ? { level: result.created.length ? 'warning' : 'error', text: `Made ${result.created.length} codes. ${plural(problem, 'guest has', 'guests have')} no code yet (${result.failed[0]?.error.message ?? 'stopped'}). Press Make QR codes again: guests who have a code are skipped.` }
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
  // (Prompt 38: each state is a chip with its own shape and word, never a colour alone: no code a warning, not scanned information, joined a tick,
  // completed a ringed tick, disabled the power mark.)
  const chipOf: Record<string, { tone: string; icon: IconName }> = {
    none: { tone: 'chip--warn', icon: 'alert-triangle' }, waiting: { tone: 'chip--info', icon: 'info' }, joined: { tone: 'chip--primary', icon: 'check' },
    completed: { tone: 'chip--ok', icon: 'check-circle' }, disabled: { tone: '', icon: 'power' },
  };
</script>

<section class="panel guests-panel" aria-busy={loading || busy}>
  <header class="panel__head">
    <div><h2><Icon name="qr" />Guests and QR codes</h2><p class="muted">Add the people you expect, make a QR code for each, then print or share them.</p></div>
    {#if session && guestMode}<div class="panel__actions"><button class="btn" type="button" onclick={() => void refresh()} disabled={busy}>Refresh</button></div>{/if}
  </header>
  {#if loading}<div class="adm-card adm-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p class="sr-only" role="status">Loading Guests and QR...</p>
  {:else if elsewhere}<p class="notice" role="status" data-testid="guests-elsewhere">A session you have not been given is live. Guests and QR works on the live session of the clients and sessions you hold.</p>
  {:else if error && !session}<p class="error" role="alert">{error}</p>
  {:else if !session}
    <div class="adm-empty"><Icon name="broadcast" /><p>Nothing is live, so there is no session to add guests to. Go live on Today first.</p><button class="btn btn--primary btn--with-icon" type="button" onclick={() => onNavigate('today')}><Icon name="calendar-check" />Open Today</button></div>
  {:else}
    <p class="muted">Live session: <strong>{client?.name ?? session.clientId}</strong>, {session.date ?? 'undated'}{ended ? ' (ended)' : ''}. Only this session is offered on participant devices; how guests are identified is chosen on Today.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if guestMode}
      <ol class="steps" aria-label="Steps">
        <li class="step" aria-current={step === 1 ? 'step' : undefined} data-done={addedDone}>
          <h3 class="step__title"><span class="step__mark" aria-hidden="true">{#if addedDone}<Icon name="check" size={18} />{:else}1{/if}</span><span class="sr-only">Step 1{addedDone ? ', done' : ''}:</span>Add guests{#if step === 1}<span class="step__now">Do this now</span>{/if}</h3>
          <p class="muted step__summary">{addedDone ? `${plural(rows.length, 'guest', 'guests')} added.` : 'Paste the names you expect, one per line.'}</p>
          <!-- (Prompt 38: a guest needs a name only; the group and the picture are folded, and pasting a list is the folded bulk tool.) -->
          <form class="guest-one" onsubmit={addVisitor}>
            <div class="guest-one__line">
              <label class="field"><span class="field__label">Visitor name</span><input class="input" bind:value={visitorName} maxlength={MAX_GUEST_NAME} autocomplete="off" disabled={busy || ended} /></label>
              <button class="btn btn--with-icon" class:btn--primary={step === 1} type="submit" disabled={busy || ended || !visitorName.trim()}><Icon name="plus" />Add visitor</button>
            </div>
            <details class="adm-fold">
              <summary><Icon name="chevron-right" />Group and picture <span class="adm-fold__summary">{[visitorGroup.trim() ? `Group ${visitorGroup.trim()}` : 'No group', newPicture ? 'picture chosen' : 'no picture'].join(' · ')}</span></summary>
              <div class="field-row">
                <label class="field"><span class="field__label">Group (optional)</span><input class="input" bind:value={visitorGroup} maxlength={MAX_GUEST_GROUP} autocomplete="off" disabled={busy || ended} /></label>
                <button class="btn guest-picture-pick" type="button" aria-label={newPicture ? 'Picture chosen. Change it' : 'Picture, optional'} onclick={() => { picturing = 'new'; }} disabled={busy || ended}><GuestAvatar src={newPicture?.url ?? null} size={32} /> Picture</button>
              </div>
            </details>
          </form>
          <details class="adm-fold" bind:open={pasteOpen}>
            <summary><Icon name="chevron-right" />Add many at once <span class="adm-fold__summary">{pasted.trim() ? pasteSummary(parsed) : 'Paste a list of names'}</span></summary>
          <div class="guests-add">
            <div class="field">
              <label class="field__label" for="paste-names">Paste names</label>
              <textarea id="paste-names" class="input" rows="4" bind:value={pasted} placeholder={'One name per line, or separated by commas. A group may follow a bar:\nJordan Lee | Finance\nCasey Park, Morgan Day'} disabled={busy || ended} aria-describedby="paste-summary"></textarea>
              <span id="paste-summary" class="muted small" data-testid="paste-summary">{pasted.trim() ? `${pasteSummary(parsed)} Commas separate names, so write "Jordan Lee", not "Lee, Jordan". A name is kept to ${MAX_GUEST_NAME} characters.` : `One name per line, or separated by commas. Names already on the list are skipped. A name is kept to ${MAX_GUEST_NAME} characters.`}</span>
            </div>
            <label class="field"><span class="field__label">Group for lines with none (optional)</span><input class="input" bind:value={pasteGroup} maxlength={MAX_GUEST_GROUP} autocomplete="off" disabled={busy || ended} /></label>
            <button class="btn" type="button" onclick={() => void addPasted()} disabled={busy || ended || parsed.names.length === 0}>{parsed.names.length > 0 ? `Add ${plural(parsed.names.length, 'guest', 'guests')}` : 'Add guests'}</button>
          </div>
          </details>
        </li>
        <li class="step" aria-current={step === 2 ? 'step' : undefined} data-done={codesDone}>
          <h3 class="step__title"><span class="step__mark" aria-hidden="true">{#if codesDone}<Icon name="check" size={18} />{:else}2{/if}</span><span class="sr-only">Step 2{codesDone ? ', done' : ''}:</span>Make codes{#if step === 2}<span class="step__now">Do this now</span>{/if}</h3>
          <p class="muted step__summary">{codesDone ? 'Every guest has a code.' : addedDone ? `${plural(missing, 'guest has', 'guests have')} no code yet.` : 'Each guest gets a single-use QR code.'}</p>
          <div class="step__actions">
            <button class="btn" class:btn--primary={step === 2} type="button" onclick={() => void generateAll()} disabled={busy || Boolean(makeWhy)} aria-describedby={makeWhy ? 'make-why' : undefined}>{missing ? `Make ${plural(missing, 'QR code', 'QR codes')}` : 'Make QR codes'}</button>
          </div>
          {#if makeWhy}<p id="make-why" class="step__why">{makeWhy}</p>{/if}
        </li>
        <li class="step" aria-current={step === 3 ? 'step' : undefined}>
          <h3 class="step__title"><span class="step__mark" aria-hidden="true">3</span><span class="sr-only">Step 3:</span>Print or share{#if step === 3}<span class="step__now">Do this now</span>{/if}</h3>
          <p class="muted step__summary">{cardCount ? `${plural(cardCount, 'code is', 'codes are')} ready to print.` : "Print a sheet of the codes, or share one guest's link."}</p>
          <div class="step__actions">
            <button class="btn" class:btn--primary={step === 3} type="button" onclick={onPrint} disabled={busy || cardCount === 0} aria-describedby={printWhy ? 'print-why' : undefined}><Icon name="printer" /> Print QR sheet{cardCount ? ` (${cardCount})` : ''}</button>
            <button class="btn" type="button" onclick={exportCsv} disabled={rows.length === 0}><Icon name="download" /> Export CSV</button>
          </div>
          {#if printWhy}<p id="print-why" class="step__why">{printWhy}</p>{/if}
          <p class="muted">To share one guest's link, choose Show QR beside their name, then Copy link.</p>
        </li>
      </ol>

        {#if progress}
          <div role="status" class="guests-progress" data-testid="guest-progress">
            <p><strong>{progress.label}</strong>: {progress.done} of {progress.total}</p>
            <progress max={progress.total} value={progress.done} aria-label={progress.label}></progress>
          </div>
        {/if}
        {#if report}<p class="guests-report guests-report--{report.level}" role="status" data-testid="guest-report">{report.text}</p>{/if}

      <section class="user-setup__roster" aria-labelledby="roster-heading">
        <div class="panel__head">
          <div>
            <h3 id="roster-heading" bind:this={rosterHeading} tabindex="-1">Guest list</h3>
            <p class="muted" data-testid="guest-summary">
              {#if rows.length === 0}No guests yet.{:else}{plural(rows.length, 'guest', 'guests')}: {counts.none} no code, {counts.waiting} not scanned, {counts.joined} joined, {counts.completed} completed{counts.disabled ? `, ${counts.disabled} disabled` : ''}.{/if}
            </p>
            {#if rows.length > 0}<p class="muted small" data-testid="guest-pictures-line">{picturesLine(guestState?.visitors ?? [])}</p>{/if}
          </div>
        </div>
        <div class="guests__codes">

        {#if groups.length > 0}
          <div class="field">
            <label class="field__label" for="guest-group-filter">Show guests in</label>
            <select id="guest-group-filter" class="select" bind:value={groupFilter}>
              <option value="">All groups</option>
              {#each groups as group (group)}<option value={group}>{group}</option>{/each}
            </select>
          </div>
        {/if}
        {#if rows.length === 0}<div class="adm-empty"><Icon name="users" /><p>No visitors added for this session. Add the first by name above.</p></div>
        {:else}
          {#if rows.length > PER_PAGE.guests}
            <div class="field"><label class="field__label" for="guest-search">Search guests</label>
              <input id="guest-search" class="input" type="search" autocomplete="off" bind:value={guestSearch} oninput={() => { guestPage = 1; }} /></div>
          {/if}
          <!-- Prompt 39: rows the width of the page, in columns: the guest, their group, their status, their code, what can be done. -->
          <div class="guests__scroll">
          <table class="guests__table">
            <thead><tr><th scope="col">Guest</th><th scope="col">Group</th><th scope="col">Status</th><th scope="col">Code</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
            {#each shownRows as row (row.visitor.id)}
              {@const visitor = row.visitor}
              <tr data-guest={guestKey(visitor.displayName)} data-status={row.key}>
                <th scope="row"><span class="guests__who"><GuestAvatar src={visitor.pictureUrl} size={40} /><span class="row__title">{visitor.displayName}</span></span></th>
                <td>{#if visitor.guestGroup}<span class="tag" data-testid="guest-group">{visitor.guestGroup}</span>{:else}<span class="muted">None</span>{/if}</td>
                <td><span class="chip pill {pillClass[row.key]} {chipOf[row.key]?.tone ?? ''}"><Icon name={chipOf[row.key]?.icon ?? 'info'} size={16} />{row.label}</span></td>
                <td class="guests__code">{#if row.code}...{row.code.id.slice(-8)}{:else}<span class="muted">None</span>{/if}</td>
                <td><div class="row__actions">
                  <button class="btn btn--small" type="button" onclick={() => { picturing = visitor; }} disabled={busy || ended}>{visitor.pictureUrl ? 'Replace picture' : 'Add picture'}</button>
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
                </div></td>
              </tr>
            {/each}
            </tbody>
          </table>
          </div>
          <Pager state={guestPager} label="Pages of guests" onPage={(next) => { guestPage = next; void tick().then(() => { if (rosterHeading) focusHeading(rosterHeading); }); }} />
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
        </div>
      </section>
    {:else}
      <p class="hint">Staff sign in is on: participants are greeted by their signed-in SharePoint display name and need no code. To use personal QR codes for guests, choose "Guests scan a personal QR" on Today.</p>
      <button class="btn" type="button" onclick={() => onNavigate('today')}>Open Today</button>
    {/if}
    <Fold title="Recent app entries" icon="clock" summary={recentSummary} testid="visits-fold">
      {#if recent.length === 0}<p class="muted">Entries appear here as guests scan their codes; none yet.</p>
      {:else}<ul class="rows rows--flat">{#each recent as visit (visit.id)}
        <li class="row"><div class="row__main"><span class="row__title">{visit.visitorName || visit.displayName || 'Signed-in user'}</span><span class="muted">{visit.entryMode === 'client-visit' ? 'Client visit' : 'SharePoint account'} · {visit.visitedAt ? new Date(visit.visitedAt).toLocaleString() : 'Time unavailable'}</span></div></li>
      {/each}</ul>{/if}
    </Fold>
  {/if}
</section>

{#if picturing}
  <GuestPicture
    name={picturing === 'new' ? visitorName : picturing.displayName}
    current={picturing === 'new' ? newPicture?.url ?? null : picturing.pictureUrl ?? null}
    busy={pictureBusy}
    onpick={picturePicked}
    onremove={picturing === 'new' ? undefined : () => { if (picturing && picturing !== 'new') void removePicture(picturing); }}
    onclose={() => { picturing = null; }}
  />
{/if}
