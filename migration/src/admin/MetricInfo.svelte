<script lang="ts" module>
  /** The one bubble open on the page (Prompt 26): another opening closes it. */
  let closeOpen: (() => void) | null = null;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { metricWords } from '../lib/results/metric-words.js';
  import { placeTip } from '../lib/results/tip-place.js';

  // The i button beside every figure of the Leadership dashboard (Prompt 21, Phase 5; boards 9 and 12): hover or focus shows what the figure is, its
  // formula, what it means and an example, in the words of lib/results/metric-words.js; Escape hides them; the button names the figure for a screen reader,
  // and the words are its description. Pressing it keeps them open (a touch screen has no hover). Since Prompt 26 the bubble is in the layer fixed to the window that the
  // chart tooltips use, placed by lib/results/tip-place.js: no card or scrolling box can cut it, and it never covers its own button. It closes on a scroll, a resize and a tap
  // elsewhere, and only one is open at a time.
  let { id }: { id: string } = $props();
  const words = $derived(metricWords(id));
  // (Prompt 22: one figure's i is on a tile and beside every client and session, so each words' id is its own: an id is never on the page twice.)
  const uid = $props.id();
  const tipId = $derived(`metric-tip-${id}-${uid}`);
  let shown = $state(false);
  let pinned = $state(false);
  let button = $state<HTMLElement>();
  let tip = $state<HTMLElement>();
  let at = $state<{ left: number; top: number } | null>(null);
  const open = $derived(shown || pinned);
  const close = () => { shown = false; pinned = false; };

  $effect(() => {
    if (!open) { at = null; return undefined; }
    if (closeOpen !== close) closeOpen?.();
    closeOpen = close;
    void tick().then(() => {
      if (!tip || !button) return;
      const own = tip.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      const placed = placeTip({ width: own.width, height: own.height }, { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, box.left + box.width / 2, { width: document.documentElement.clientWidth, height: window.innerHeight });
      at = { left: placed.left, top: placed.top };
    });
    const elsewhere = (event: Event) => { if (!button?.contains(event.target as Node) && !tip?.contains(event.target as Node)) close(); };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', elsewhere);
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', elsewhere);
      if (closeOpen === close) closeOpen = null;
    };
  });
</script>

{#if words}
  <span class="metric-info">
    <button class="metric-info__button" bind:this={button} type="button" aria-label="About {words.label}" aria-describedby={tipId} aria-expanded={open}
      onmouseenter={() => { shown = true; }} onmouseleave={() => { shown = false; }} onfocus={() => { shown = true; }} onblur={() => { shown = false; pinned = false; }}
      onclick={() => { pinned = !pinned; }} onkeydown={(event) => { if (event.key === 'Escape') close(); }}>i</button>
    <span class="metric-info__tip" bind:this={tip} id={tipId} role="tooltip" data-open={open} style={at ? `left: ${at.left}px; top: ${at.top}px;` : 'visibility: hidden; left: 0; top: 0;'}>
      <strong>{words.label}</strong>
      <span>{words.formula}</span>
      <span>{words.meaning}</span>
      <span class="metric-info__example">For example: {words.example}</span>
    </span>
  </span>
{/if}

<style>
  .metric-info {
    position: relative;
    display: inline-flex;
    flex: none; /* (its 44 px is kept in the line: the words beside it wrap round it, never under it) */
    vertical-align: middle;
  }

  .metric-info__button {
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    font-style: italic;
    cursor: pointer;
  }

  .metric-info__button::before {
    content: '';
    position: absolute;
    inset: 10px;
    border: 2px solid currentColor;
    border-radius: 50%;
    pointer-events: none;
  }

  .metric-info__tip {
    position: fixed;
    z-index: 50;
    display: none;
    width: min(22rem, calc(100vw - 16px));
    padding: 0.75rem;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: #fff;
    color: var(--ink);
    font-size: 1rem;
    font-weight: 400;
    font-style: normal;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
  }

  .metric-info__tip[data-open='true'] {
    display: grid;
    gap: 0.35rem;
  }

  .metric-info__example {
    color: var(--muted, #53565a);
  }
</style>
