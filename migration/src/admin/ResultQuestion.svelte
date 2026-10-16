<script lang="ts">
  import { onDestroy } from 'svelte';
  import { destroyResults, renderResults } from '../../../public/js/resultsRenderer.js';
  import type { AdminQuestion } from '../lib/adminData.js';

  // One question of the Live display: its prompt, how many answered, and the chart. The chart is drawn by the shared renderer
  // (public/js/resultsRenderer.js), which reads --brand-primary, --text, --text-muted, --border and --chart-scale from this card.
  // In `fit` mode (full screen) the card takes the height it is given, whatever it is: the chart gets what the prompt and the count leave, so the
  // whole card is on the screen at once, and a list of written answers shows the ones that fit and says how many it could not.
  let { question, scale = 1, fit = false }: { question: AdminQuestion; /** Larger type for a projector (the renderer's --chart-scale). */ scale?: number; /** The card fills the height it is given. */ fit?: boolean } = $props();
  let container = $state<HTMLDivElement>();
  let renderedSignature = '';
  let more = $state(0);

  /**
   * Written answers that do not fit the card (fit mode only): the ones whose bottom edge is below the list's. They are not drawn (a row cut in
   * half reads as a mistake), and the card says how many there are.
   */
  function measure() {
    const list = container?.querySelector<HTMLElement>('.results__comments');
    if (!fit || !list) { more = 0; return; }
    const items = [...list.children] as HTMLElement[];
    for (const item of items) item.style.visibility = ''; // measure them all as they would be drawn
    const limit = list.getBoundingClientRect().bottom + 1;
    const cut = items.filter((item) => item.getBoundingClientRect().bottom > limit);
    for (const item of cut) item.style.visibility = 'hidden';
    more = cut.length;
  }

  $effect(() => {
    const target = container;
    const value = question;
    const size = scale;
    if (!target) return;
    const signature = JSON.stringify([value, size]);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    renderResults(value, target);
    measure();
  });

  $effect(() => {
    // The card changes size with the window and with its own prompt: look again at what fits.
    const target = container;
    if (!target || !fit || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(target);
    return () => watch.disconnect();
  });

  onDestroy(() => {
    if (container) destroyResults(container);
  });
</script>

<article class="live-question" class:live-question--fit={fit} style:--chart-scale={scale}>
  <header class="live-question__head">
    <h3 class="live-question__prompt">{question.prompt}</h3>
    <span class="live-question__count">{question.respondents} answered</span>
  </header>
  <div class="live-question__results" bind:this={container}></div>
  {#if more > 0}<p class="live-question__more">{more === 1 ? '1 more written answer is not shown' : `${more} more written answers are not shown`}</p>{/if}
</article>

<style>
  /* Each card is a white sheet that redefines the names the chart reads, so a chart looks the same on the page and on the projector. */
  .live-question {
    --text: #0b1f3a;
    --text-muted: #475569;
    --border: #cfd8e3;
    display: flex;
    flex-direction: column;
    gap: calc(0.75rem * var(--chart-scale, 1));
    min-width: 0; /* lets the chart shrink with the grid cell */
    padding: calc(1.25rem * var(--chart-scale, 1));
    color: var(--text);
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 1rem;
  }

  .live-question__head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem 1rem;
  }

  .live-question__prompt {
    margin: 0;
    font-size: calc(1.15rem * var(--chart-scale, 1));
    line-height: 1.25;
  }

  .live-question__count {
    color: var(--text-muted);
    font-size: calc(0.95rem * var(--chart-scale, 1));
    white-space: nowrap;
  }

  /* What the renderer puts inside the card (its own elements, so the rules are global to this card). */
  .live-question :global(.results__summary) {
    margin: 0.5rem 0 0;
    font-size: calc(1rem * var(--chart-scale, 1));
    font-weight: 600;
    text-align: center;
  }

  .live-question :global(.results__summary:empty),
  .live-question :global(.results__empty[hidden]) {
    display: none;
  }

  .live-question :global(.results__empty) {
    margin: 0.5rem 0 0;
    color: var(--text-muted);
    font-size: calc(1rem * var(--chart-scale, 1));
    text-align: center;
  }

  .live-question :global(.results__comments) {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: calc(21rem * var(--chart-scale, 1));
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .live-question :global(.results__comments li) {
    padding: 0.6rem 0.9rem;
    font-size: calc(1rem * var(--chart-scale, 1));
    background: #eef2f7;
    border-radius: 0.5rem;
    overflow-wrap: anywhere;
  }

  /* ---- Fit: the card is exactly as tall as the room it is given (full screen, one question at a time) ------------------------------ */

  .live-question--fit {
    flex: 1 1 0;
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .live-question--fit .live-question__head {
    flex: 0 0 auto;
  }

  /* The chart takes what is left. The renderer gives its box a fixed height of its own; the card's size is the one that counts here. */
  .live-question--fit .live-question__results {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-height: 0;
  }

  .live-question--fit .live-question__results :global(.results__canvas) {
    flex: 1 1 0;
    height: auto !important;
    min-height: calc(6rem * var(--chart-scale, 1));
    overflow: hidden;
  }

  .live-question--fit .live-question__results :global(.results__canvas canvas) {
    position: absolute;
    top: 0;
    left: 0;
  }

  .live-question--fit .live-question__results :global(.results__summary),
  .live-question--fit .live-question__results :global(.results__empty) {
    flex: 0 0 auto;
  }

  .live-question--fit :global(.results__comments) {
    display: grid;
    flex: 1 1 0;
    grid-template-columns: repeat(auto-fill, minmax(calc(18rem * var(--chart-scale, 1)), 1fr));
    align-content: start;
    max-height: none;
    min-height: 0;
    overflow: hidden;
  }

  .live-question__more {
    flex: 0 0 auto;
    margin: 0;
    color: var(--text-muted);
    font-size: calc(0.95rem * var(--chart-scale, 1));
    text-align: right;
  }
</style>
