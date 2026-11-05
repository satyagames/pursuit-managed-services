<script lang="ts">
  // The Live display's heading, inside LiveDisplay.svelte's header (Phase 17; Prompt 34 gave the admin view Prompt 33's title line). On the admin
  // view: the chart icon, "Live results" and one sentence on what the page is, with the client's logo and name on the right; on the wall page
  // (not yet full screen) its one main action, Show the wall full screen, beside them. In full screen: the client's logo and name, "Live results",
  // how many answered, and the way out. The steps and the downloads are LiveSteps.svelte's. Every press is LiveDisplay's. The rules for full
  // screen name the display (`.live--present`) as the ancestor it is.
  import Icon from './Icon.svelte';
  import { focusHeading } from '../lib/common/focus.js';
  import LookChoice, { type Look } from './LookChoice.svelte';

  let {
    wallLook, onWallLook, brand, failedLogo, clientName, wallPage, meta, phase, presenting,
    onLogoFailed, onEnter, onLeave,
  }: {
    /** The wall's look, chosen on the wall page before it goes full screen. */
    wallLook: Look;
    onWallLook: (look: Look) => void;
    /** The client's look as the display takes it: its name and its logo's address. */
    brand: { name: string; logoUrl: string | null };
    /** A logo address that could not be loaded: no empty chip is left for it. */
    failedLogo: string;
    /** The name beside the logo (the product's while nothing is loaded). */
    clientName: string;
    wallPage: boolean;
    /** How many answered, and when it was read (in full screen; the admin view says it in step 1). */
    meta: string;
    phase: string;
    presenting: boolean;
    onLogoFailed: () => void;
    onEnter: () => void;
    onLeave: () => void;
  } = $props();

  // Full screen focuses the heading as it opens (Prompt 34): the button that opened it has gone, and the next Tab is then the way out.
  let heading = $state<HTMLElement>();
  $effect(() => { if (presenting) focusHeading(heading); });
</script>

<div class="live__title">
  <h2 bind:this={heading} tabindex="-1">{#if !presenting}<Icon name="chart" />{/if}Live results{wallPage ? ' · Wall display' : ''}</h2>
  {#if !presenting}<p class="live__lead">{wallPage ? 'What the room sees, live. Nobody\'s name is on this page.' : 'What the room sees, live.'}</p>{/if}
  {#if presenting || wallPage}<p class="live__meta" aria-live="off">{meta}</p>{/if}
</div>
<div class="live__brand">
  {#if brand.logoUrl && failedLogo !== brand.logoUrl}<span class="live__logo"><img src={brand.logoUrl} alt={brand.name} onerror={onLogoFailed} /></span>{/if}
  <strong class="live__client">{clientName}</strong>
</div>
{#if presenting}
  <div class="live__actions"><button class="btn live__exit" type="button" onclick={onLeave}>Exit full screen</button></div>
{:else if wallPage && phase === 'display'}
  <div class="live__actions"><LookChoice label="Wall" value={wallLook} onChange={onWallLook} /><button class="btn btn--primary live__go" type="button" onclick={onEnter}><Icon name="screen" />Show the wall full screen</button></div>
{/if}

<style>
  .live__brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .live__logo {
    display: inline-flex;
    padding: 0.35rem 0.6rem;
    background: var(--adm-card);
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
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.4rem;
  }

  .live__title h2 > :global(.icon) {
    color: var(--adm-deep);
  }

  .live__lead {
    margin: 0.25rem 0 0;
    color: var(--adm-muted);
  }

  .live__meta {
    margin: 0.15rem 0 0;
    color: var(--adm-muted);
  }

  .live__go {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .live__actions {
    display: flex;
    align-items: center;
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
    font-weight: 600;
  }

  :global(.live--present) .live__meta {
    color: var(--wall-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .live__exit { transition: none; }
  }
</style>
