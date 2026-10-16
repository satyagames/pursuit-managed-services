<script lang="ts">
  import type { Snippet } from 'svelte';
  import { SCRIM_ALPHA } from '../lib/scrim.js';
  import DeloitteWordmark from './DeloitteWordmark.svelte';

  let { background = null, focus = null, stage = 'narrow', contained = false, right, children }: {
    /**
     * Optional full-bleed picture behind the page. The page's own colours show until it has loaded, and if it
     * fails or never arrives they simply stay: nothing waits for it. Once it is showing, a dark scrim keeps
     * white text at 4.5:1 even over a pure white picture (lib/scrim.js works out how dark, not a guess).
     */
    background?: string | null;
    /** The part of the picture that should stay in view when the screen is not its shape: percentages, 50/50 is the middle. */
    focus?: { x: number; y: number } | null;
    /** `narrow` is the participant column (about 800px); `wide` is for the facilitator's displays. */
    stage?: 'narrow' | 'wide';
    /** Fills its parent instead of the viewport. Only for framing the shell inside the styleguide. */
    contained?: boolean;
    /** Header content on the right of the wordmark: a greeting, the sound switch. */
    right?: Snippet;
    children: Snippet;
  } = $props();

  // 'loading' until the picture reports in; a different picture starts again.
  let picture = $state<'loading' | 'ready' | 'failed'>('loading');
  let image = $state<HTMLImageElement>();
  // (Through $derived: the effect re-runs only when the address changes, not whenever the object it came from is rebuilt.)
  const source = $derived(background);
  $effect(() => { void source; picture = 'loading'; });
  // An image that finished before this element could hear about it.
  $effect(() => { if (image?.complete && image.naturalWidth > 0) picture = 'ready'; });
  const position = $derived(focus ? `${focus.x}% ${focus.y}%` : '50% 50%');
</script>

<div class="shell" class:contained data-stage={stage} data-background={background ? picture : 'none'} style:--scrim-alpha={SCRIM_ALPHA}>
  {#if background && picture !== 'failed'}
    <img
      bind:this={image}
      class="image"
      class:image-ready={picture === 'ready'}
      src={background}
      alt=""
      aria-hidden="true"
      decoding="async"
      fetchpriority="low"
      style:object-position={position}
      onload={() => { picture = 'ready'; }}
      onerror={() => { picture = 'failed'; }}
    />
    <div class="scrim" class:scrim-ready={picture === 'ready'} aria-hidden="true"></div>
  {/if}

  <header class="header">
    <div class="wordmark"><DeloitteWordmark /></div>
    <div class="right">{@render right?.()}</div>
  </header>

  <!-- A framed demo is not the page, so it gets no second main landmark or duplicate id. -->
  <svelte:element this={contained ? 'div' : 'main'} id={contained ? undefined : 'app-content'} class="stage">
    {@render children()}
  </svelte:element>
</div>

<style>
  .shell {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    color: var(--text);
    font-family: var(--font-sans);
    background: linear-gradient(to bottom, var(--bg-top) 0%, var(--bg-mid) 58%, var(--bg-bottom) 100%);
  }

  /* Until today's client is known (index.html starts with data-theme-pending and the boot
     sequence removes it) no client colour is painted at all: only the top of the gradient, which
     is the same near-black for everyone. So the first colour a participant sees is their client's. */
  :global(:root[data-theme-pending]) .shell {
    background: var(--bg-top);
  }

  .shell.contained {
    min-height: 100%;
    height: 100%;
    overflow: auto;
  }

  .image,
  .scrim {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity 400ms ease;
  }

  .image {
    z-index: -2;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* Flat, at the least opacity that keeps white text at 4.5:1 over a white picture (lib/scrim.js). */
  .scrim {
    z-index: -1;
    background: rgb(0 1 2 / var(--scrim-alpha));
  }

  .image-ready,
  .scrim-ready {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .image,
    .scrim { transition: none; }
  }

  /* Room, not a squeeze: when the wordmark, the greeting and the sound switch do not fit one row (a narrow window, a long name, larger text) the greeting and the
     switch go to a second row, whole, instead of the greeting being cut off or shrunk to a sliver (Phase 8). */
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding:
      max(1.25rem, env(safe-area-inset-top))
      calc(var(--header-pad-x) + env(safe-area-inset-right))
      0
      calc(var(--header-pad-x) + env(safe-area-inset-left));
  }

  .wordmark {
    flex: none;
    width: var(--wordmark-w);
  }

  .right {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem 0.75rem;
    min-width: 0;
    font-size: var(--fs-small);
    font-weight: var(--fw-bold);
  }

  /* The sound switch is created by lib sfx.js and dropped in here; it used to float fixed. */
  .right :global(.sound-toggle) {
    position: static;
    min-height: var(--target-min);
    color: var(--text);
    font-size: var(--fs-small);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    box-shadow: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  /* A column, so a screen can fill the height and keep its action bar at the bottom. */
  .stage {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
    max-width: calc(var(--stage-max) + 2 * var(--gutter));
    margin-inline: auto;
    padding:
      clamp(1.5rem, 6vw, 3.5rem)
      calc(var(--gutter) + env(safe-area-inset-right))
      calc(2rem + env(safe-area-inset-bottom))
      calc(var(--gutter) + env(safe-area-inset-left));
  }

  .shell[data-stage='wide'] .stage {
    max-width: calc(var(--stage-wide-max) + 2 * var(--gutter));
  }
</style>
