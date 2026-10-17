<script lang="ts" module>
  /** One side of a true-or-false split: True is always the left side and the blue, False the right and the tint (colour follows the side). */
  export type Side = {
    id: string;
    label: string;
    percent: number;
    fraction: number;
    count: number;
    /** Marked as the correct answer: Dark Green, with a tick and the word. */
    correct: boolean;
    name: string;
    tip: { value: string; label: string; extra?: string };
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import ChartTip from './ChartTip.svelte';
  import { people } from '../../lib/results/results-chart-model.js';
  import { uid, type Tip } from './chart-ui.js';

  // True or false: ONE bar split in two, True from the left and False from the right, each labelled directly ("True 72%") above its own end. The labels
  // are the buttons (a thin slice of the bar would be too small to press); a pointer or the keyboard on a label lifts its slice of the bar. In full screen
  // (`fit`, Phase 11a-2) the bar keeps its thickness and the split sits in the middle of the room its card gives it.
  let { sides, selected = null, onSelect, withNames = false, panelId = '', fit = false }: {
    sides: [Side, Side];
    selected?: string | null;
    onSelect?: (id: string | null) => void;
    withNames?: boolean;
    panelId?: string;
    fit?: boolean;
  } = $props();

  let bar = $state<HTMLDivElement>();

  let frame = $state<HTMLDivElement>();
  let drawn = $state(false);
  let hot = $state('');
  let tip = $state<Tip | null>(null);
  const tipId = uid('split-tip');

  onMount(() => {
    const frameId = requestAnimationFrame(() => requestAnimationFrame(() => { drawn = true; }));
    return () => cancelAnimationFrame(frameId);
  });

  // The tooltip keeps clear of the side's label (the button) and of the bar under the labels.
  function show(side: Side, mark: HTMLElement) {
    hot = side.id;
    tip = { id: tipId, mark: side.id, ...side.tip, target: mark, clear: bar ? [bar] : [] };
  }

  function hide(side: Side) {
    if (hot === side.id) hot = '';
    if (tip?.mark === side.id) tip = null;
  }

  function onDocumentPointer(event: PointerEvent) {
    if (tip && frame && !frame.contains(event.target as Node)) { tip = null; hot = ''; }
  }
</script>

<svelte:document onpointerdown={onDocumentPointer} />

<div class="split" class:split--fit={fit} data-drawn={drawn || undefined} bind:this={frame}>
  <div class="split__labels">
    {#each sides as side, index (side.id)}
      <button
        type="button"
        class="split__side"
        class:split__side--right={index === 1}
        class:split__side--correct={side.correct}
        data-mark={side.id}
        aria-label={side.name}
        aria-expanded={withNames ? selected === side.id : undefined}
        aria-controls={withNames && selected === side.id ? panelId : undefined}
        aria-describedby={tip?.mark === side.id ? tipId : undefined}
        onpointerenter={(event) => show(side, event.currentTarget)}
        onpointerleave={(event) => { if (event.pointerType === 'mouse') hide(side); }}
        onfocus={(event) => show(side, event.currentTarget)}
        onblur={() => hide(side)}
        onclick={(event) => { show(side, event.currentTarget); if (withNames) onSelect?.(selected === side.id ? null : side.id); }}
      >
        <span class="split__word" data-label-of={side.id}>
          {#if side.correct}<svg class="split__tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8.5l3.5 3.5 7.5-8" /></svg>{/if}{side.label} {side.percent}%
        </span>
        <span class="split__count">{people(side.count)}{side.correct ? ' · Correct' : ''}</span>
      </button>
    {/each}
  </div>
  <div class="split__bar" aria-hidden="true" bind:this={bar}>
    {#each sides as side, index (side.id)}
      <span
        class="split__slice"
        class:split__slice--true={index === 0}
        class:split__slice--correct={side.correct}
        class:split__slice--hot={hot === side.id || selected === side.id}
        style:--share={side.fraction}
      ></span>
    {/each}
  </div>
  <ChartTip {tip} />
</div>

<style>
  .split {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: calc(0.4rem * var(--chart-scale, 1));
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .split--fit {
    justify-content: center;
  }

  .split__labels {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .split__side {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: 44px;
    padding: 0.15rem 0.25rem;
    color: var(--viz-text);
    font: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 0.3rem;
    cursor: pointer;
  }

  .split__side--right {
    align-items: flex-end;
    text-align: right;
  }

  .split__word {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 1.15em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .split__count {
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 600;
  }

  .split__side--correct .split__count {
    color: var(--viz-text);
    font-weight: 700;
  }

  .split__tick {
    width: 1.1em;
    height: 1.1em;
    fill: none;
    stroke: var(--viz-correct);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The bar: True grows from the left edge, False from the right, with the card's white between them (2px at least, more when some answers
     were to an answer that has since gone). Square where a slice meets the edge of the bar, rounded where it ends. */
  .split__bar {
    display: flex;
    justify-content: space-between;
    gap: 2px;
    height: calc(24px * var(--chart-scale, 1));
    border-left: 1px solid var(--viz-grid);
    border-right: 1px solid var(--viz-grid);
  }

  .split__slice {
    display: block;
    width: calc(var(--share) * (100% - 2px));
    background: var(--viz-primary-tint);
    border-radius: 4px 0 0 4px;
    transition: width 400ms ease-out;
  }

  .split__slice--true {
    background: var(--viz-primary);
    border-radius: 0 4px 4px 0;
  }

  .split__slice--correct {
    background: var(--viz-correct);
  }

  .split:not([data-drawn]) .split__slice {
    width: 0;
  }

  .split__slice--hot {
    outline: 2px solid var(--viz-text);
    outline-offset: 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .split__slice {
      transition: none;
    }
  }
</style>
