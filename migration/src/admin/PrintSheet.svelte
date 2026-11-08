<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { loadGuestState } from '../lib/admin/adminData.js';
  import { participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import { completedTrackIds, guestRows, paginate, printCards } from '../lib/admin/admin-content.js';
  import { pageSizeFor, pageStorage, prefsKeyOf, recall, remember } from '../lib/admin/admin-defaults.js';
  import StickyBar from './StickyBar.svelte';

  // The guest QR sheet: a card for each guest who holds a code nobody has scanned. Prompt 38: 6 to a page (2 columns by 3 rows, larger codes) by
  // default, or 12 (3 by 4); the paper is A4, or US Letter where the browser's language says Letter is the paper, and the last choice is remembered.
  // Print is the sticky bar's one primary action. It is the page itself, with the print
  // stylesheet doing the rest, so Print works from a laptop and from iPad Safari (Share, then Print or
  // Save as PDF). No PDF library: the browser's own print makes the PDF.
  let { onClose, person = null }: { onClose: () => void; person?: { key?: string; email?: string } | null } = $props();

  const prefsKey = $derived(prefsKeyOf(person));
  /** The person's last choice, else the locale's paper and six to a page. */
  const saved = (name: string, fallback?: unknown) => recall(pageStorage(), prefsKeyOf(person), name, fallback);
  let paper = $state(String(saved('paper', pageSizeFor(typeof navigator === 'undefined' ? '' : navigator.language))) === 'Letter' ? 'Letter' : 'A4');
  let perPage = $state(Number(saved('perPage', 6)) === 12 ? 12 : 6);
  $effect(() => { remember(pageStorage(), prefsKey, 'paper', paper); remember(pageStorage(), prefsKey, 'perPage', perPage); });

  type Card = { id: string; name: string; url: string; image: string };
  let loading = $state(true);
  let error = $state('');
  let clientName = $state('');
  let date = $state('');
  let cards = $state<Card[]>([]);
  let left = $state({ none: 0, joined: 0, disabled: 0 });
  let guestMode = $state(true);
  let wrap = $state<HTMLElement>();
  let zoom = $state(1);

  const pages = $derived(paginate(cards, perPage));
  // A page is 207 mm wide on screen (191 mm of cards and 8 mm either side): on a narrower screen it is shown smaller, never when printing.
  const SHEET_PX = 784;

  onMount(() => {
    let active = true;
    void build().catch((cause) => { if (active) error = cause instanceof Error ? cause.message : 'Could not build the sheet.'; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });

  // The sheet is built once the guests are read, so what it sits in does not exist at mount: watch it when it does.
  $effect(() => {
    const host = wrap;
    if (!host) return;
    let width = 0;
    let frame = 0;
    // Resizing the sheet resizes what is observed, so the update waits for the next frame: changing it
    // inside the callback is a "ResizeObserver loop" error in WebKit.
    const watch = new ResizeObserver(() => {
      if (host.clientWidth === width) return;
      width = host.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { zoom = Math.min(1, Math.max(0.3, (width - 34) / SHEET_PX)); });
    });
    watch.observe(host);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  });

  async function build() {
    const state = await loadGuestState();
    if (!state?.session || !state.client) throw new Error('Nothing is live, so there is nothing to print. Go live on Today first.');
    clientName = state.client.name;
    date = state.session.date ?? '';
    guestMode = state.session.participationMode === 'client-visit';
    const completed = completedTrackIds({ tracks: state.tracks, responses: state.responses, sections: state.sections });
    const rows = guestRows({ visitors: state.visitors, tokens: state.tokens, tracks: state.tracks, completed });
    const base = await participantPageUrl();
    const made = printCards(rows, (tokenId) => (dataService.qrUrl as (id: string, base: string) => string)(tokenId, base));
    left = made.left;
    cards = await Promise.all(made.cards.map(async (card) => ({ ...card, image: await qrImage(card.url) })));
  }
</script>

<div class="print-view" data-testid="print-view">
  <header class="print-toolbar no-print">
    <h1 class="print-toolbar__title">QR sheet</h1>
    <div class="print-choices">
      <fieldset class="print-choice"><legend class="field__label">Paper</legend>
        {#each ['A4', 'Letter'] as size (size)}<label class="tick"><input type="radio" name="paper" value={size} bind:group={paper} />{size === 'Letter' ? 'US Letter' : size}</label>{/each}
      </fieldset>
      <fieldset class="print-choice"><legend class="field__label">Cards to a page</legend>
        {#each [6, 12] as count (count)}<label class="tick"><input type="radio" name="per-page" value={count} bind:group={perPage} />{count}</label>{/each}
      </fieldset>
    </div>
  </header>

  {#if loading}
    <p role="status" class="no-print print-note">Building the sheet...</p>
  {:else if error}
    <p class="error print-note no-print" role="alert">{error}</p>
  {:else}
    <div class="no-print print-note">
      <p data-testid="print-summary">
        <strong>{cards.length} card{cards.length === 1 ? '' : 's'}</strong> on {pages.length} page{pages.length === 1 ? '' : 's'}, {perPage} to a page, for {clientName}{date ? `, ${date}` : ''}.
        {#if left.none + left.joined + left.disabled > 0}
          Not on the sheet:
          {[left.none ? `${left.none} with no code` : '', left.joined ? `${left.joined} who already joined` : '', left.disabled ? `${left.disabled} disabled` : ''].filter(Boolean).join(', ')}.
        {/if}
      </p>
      {#if !guestMode}<p class="notice" role="note">Staff sign in is on, so these codes would not be accepted. Choose "Guests scan a personal QR" on Today first.</p>{/if}
      <p class="muted small">Print on {paper === 'Letter' ? 'US Letter' : 'A4'} at 100% (not "fit to page"), with headers and footers off. On an iPad, tap Print, or Share and then Print; pinch the preview to save it as a PDF.</p>
    </div>
    {#if cards.length === 0}
      <p class="muted print-note no-print">No guest has a code waiting. Make the codes on Guests and QR, then come back.</p>
    {/if}
    <div class="print-sheet-wrap" bind:this={wrap}>
      <div class="print-sheet" style:--sheet-zoom={zoom}>
        {#each pages as page, pageIndex (pageIndex)}
          <section class="print-page" class:print-page--6={perPage === 6} aria-label={`Page ${pageIndex + 1} of ${pages.length}`} data-page={pageIndex + 1}>
            {#each page as card (card.id)}
              <article class="print-card" data-card>
                <h2 class="print-card__name" class:print-card__name--long={card.name.length > 20 && card.name.length <= 40} class:print-card__name--longest={card.name.length > 40}>{card.name}</h2>
                <img class="print-card__qr" src={card.image} alt={`QR code for ${card.name}`} data-qr-url={card.url} />
                <p class="print-card__client">{clientName}</p>
                <p class="print-card__cta">Scan to begin</p>
              </article>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  {/if}
</div>
<StickyBar label="QR sheet" icon="printer" context={loading ? 'Building the sheet...' : `${cards.length} card${cards.length === 1 ? '' : 's'} · ${paper === 'Letter' ? 'US Letter' : 'A4'}, ${perPage} to a page`}
  primary={{ label: 'Print or save as PDF', icon: 'printer', onclick: () => window.print(), disabled: loading || cards.length === 0 }}
  secondary={{ label: 'Back to Guests and QR', icon: 'arrow-left', onclick: onClose }} />
<svelte:head>{@html `<style>@page { size: ${paper === 'Letter' ? 'letter' : 'A4'}; }</style>`}</svelte:head>
