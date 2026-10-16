<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import { loadGuestState } from '../lib/adminData.js';
  import { participantPageUrl, qrImage } from '../lib/admin-links.js';
  import { CARDS_PER_PAGE, completedTrackIds, guestRows, paginate, printCards } from '../lib/admin-content.js';

  // The guest QR sheet: a card for each guest who holds a code nobody has scanned, 3 columns by 4
  // rows to a page, the same size on A4 and on US Letter. It is the page itself, with the print
  // stylesheet doing the rest, so Print works from a laptop and from iPad Safari (Share, then Print or
  // Save as PDF). No PDF library: the browser's own print makes the PDF.
  let { onClose }: { onClose: () => void } = $props();

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

  const pages = $derived(paginate(cards, CARDS_PER_PAGE));
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
    <button class="btn" type="button" onclick={onClose}>Back to Guests and QR</button>
    <h1 class="print-toolbar__title">QR sheet</h1>
    <button class="btn btn--primary" type="button" onclick={() => window.print()} disabled={loading || cards.length === 0}>Print or save as PDF</button>
  </header>

  {#if loading}
    <p role="status" class="no-print print-note">Building the sheet...</p>
  {:else if error}
    <p class="error print-note no-print" role="alert">{error}</p>
  {:else}
    <div class="no-print print-note">
      <p data-testid="print-summary">
        <strong>{cards.length} card{cards.length === 1 ? '' : 's'}</strong> on {pages.length} page{pages.length === 1 ? '' : 's'}, {CARDS_PER_PAGE} to a page, for {clientName}{date ? `, ${date}` : ''}.
        {#if left.none + left.joined + left.disabled > 0}
          Not on the sheet:
          {[left.none ? `${left.none} with no code` : '', left.joined ? `${left.joined} who already joined` : '', left.disabled ? `${left.disabled} disabled` : ''].filter(Boolean).join(', ')}.
        {/if}
      </p>
      {#if !guestMode}<p class="notice" role="note">Staff sign in is on, so these codes would not be accepted. Choose "Guests scan a personal QR" on Today first.</p>{/if}
      <p class="muted small">Print on A4 or US Letter at 100% (not "fit to page"), with headers and footers off. On an iPad, tap Print, or Share and then Print; pinch the preview to save it as a PDF.</p>
    </div>
    {#if cards.length === 0}
      <p class="muted print-note no-print">No guest has a code waiting. Make the codes on Guests and QR, then come back.</p>
    {/if}
    <div class="print-sheet-wrap" bind:this={wrap}>
      <div class="print-sheet" style:--sheet-zoom={zoom}>
        {#each pages as page, pageIndex (pageIndex)}
          <section class="print-page" aria-label={`Page ${pageIndex + 1} of ${pages.length}`} data-page={pageIndex + 1}>
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
