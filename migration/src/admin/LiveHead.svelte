<script lang="ts">
  // The Live display's heading, inside LiveDisplay.svelte's header: the client's logo and name, "Live results" and the line under it, and the
  // buttons (the exports, Refresh, Open in a new tab, Full screen, and the way out) (Phase 17: moved out of LiveDisplay.svelte unchanged, its
  // markup and its styles). Every press is LiveDisplay's. The rules for full screen name the display (`.live--present`) as the ancestor it is.
  let {
    brand, failedLogo, clientName, wallPage, meta, phase, presenting, exporting, newTabAddress,
    onLogoFailed, onExport, onRefresh, onEnter, onLeave, onBack,
  }: {
    /** The client's look as the display takes it: its name and its logo's address. */
    brand: { name: string; logoUrl: string | null };
    /** A logo address that could not be loaded: no empty chip is left for it. */
    failedLogo: string;
    /** The name beside the logo (the product's while nothing is loaded). */
    clientName: string;
    wallPage: boolean;
    /** The line under the heading. */
    meta: string;
    phase: string;
    presenting: boolean;
    /** The export in progress ('' when none). */
    exporting: string;
    newTabAddress: string;
    onLogoFailed: () => void;
    onExport: (kind: 'csv' | 'pdf' | 'pptx') => void;
    onRefresh: () => void;
    onEnter: () => void;
    onLeave: () => void;
    onBack: () => void;
  } = $props();
</script>

<div class="live__brand">
  {#if brand.logoUrl && failedLogo !== brand.logoUrl}<span class="live__logo"><img src={brand.logoUrl} alt={brand.name} onerror={onLogoFailed} /></span>{/if}
  <strong class="live__client">{clientName}</strong>
</div>
<div class="live__title">
  <h2>Live results{wallPage ? ' · Wall display' : ''}</h2>
  <p class="live__meta" aria-live="off">{meta}</p>
</div>
<div class="live__actions">
  {#if phase === 'display' && !presenting}
    <button class="btn btn--primary" type="button" onclick={() => onExport('csv')} disabled={!!exporting}>{exporting === 'csv' ? 'Exporting...' : 'Export CSV'}</button>
    <button class="btn" type="button" onclick={() => onExport('pdf')} disabled={!!exporting}>{exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}</button>
    <button class="btn" type="button" onclick={() => onExport('pptx')} disabled={!!exporting}>{exporting === 'pptx' ? 'Exporting...' : 'Export PPT'}</button>
    <button class="btn" type="button" onclick={onRefresh} title="Read the questions and answers again now">Refresh</button>
    <a class="btn" href={newTabAddress} target="_blank" rel="noopener" title="The wall display: the charts with no names">Open in a new tab</a>
    <button class="btn btn--primary" type="button" onclick={onEnter}>Full screen</button>
  {/if}
  {#if presenting}
    <button class="btn live__exit" type="button" onclick={onLeave}>Exit full screen</button>
  {:else}
    <button class="btn" type="button" onclick={onBack}>← Results</button>
  {/if}
</div>

<style>
  .live__brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .live__logo {
    display: inline-flex;
    padding: 0.35rem 0.6rem;
    background: #fff;
    border: 1px solid var(--adm-line);
    border-radius: 0.6rem;
  }

  /* A definite height, so that a picture with only a viewBox (an SVG logo) still gets a width from its shape. */
  .live__logo img {
    display: block;
    width: auto;
    max-width: 12rem;
    height: 2.5rem;
    object-fit: contain;
  }

  .live__client {
    font-size: 1.1rem;
  }

  .live__title {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .live__title h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .live__meta {
    margin: 0.15rem 0 0;
    color: var(--adm-muted);
  }

  .live__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* The way out is shown in full screen, and fades (and the pointer hides) after a few idle seconds; any movement, touch, key or focus brings it back.
     It stays in the page for the keyboard and the screen reader the whole time. */
  .live__exit {
    transition: opacity 160ms ease;
  }

  :global(.live--present[data-idle='true']) .live__exit:not(:focus-visible) {
    opacity: 0;
  }

  :global(.live--present) .live__client {
    font-size: calc(1.1rem * var(--chart-scale, 1));
  }

  :global(.live--present) .live__logo img {
    height: calc(2.5rem * var(--chart-scale, 1));
    max-width: calc(12rem * var(--chart-scale, 1));
  }

  :global(.live--present) .live__title h2 {
    font-size: calc(1.4rem * var(--chart-scale, 1));
  }

  :global(.live--present) .live__meta {
    color: rgb(255 255 255 / 0.92);
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .live__exit { transition: none; }
  }
</style>
