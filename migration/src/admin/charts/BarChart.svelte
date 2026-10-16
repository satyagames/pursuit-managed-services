<script lang="ts" module>
  /** One bar: what it says and how it looks. `fraction` is its length, 0 to 1 of the scale. */
  export type BarRow = {
    id: string;
    label: string;
    /** Written at the end of the bar: "2 · 50%". */
    value: string;
    fraction: number;
    /** The top choice is the full blue, the rest the tint, the correct answer Dark Green. */
    tone: 'top' | 'rest' | 'correct';
    /** Words beside the label: "Top choice", and "Correct" with a tick. */
    tags: { text: string; tick?: boolean }[];
    /** A ranking's place, "1" (a shared place is the same number on two bars). */
    rank?: string;
    /** What a screen reader says for the bar. */
    name: string;
    strong?: boolean;
    tip: { value: string; label: string; extra?: string };
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import ChartTip from './ChartTip.svelte';
  import { uid, type Tip } from './chart-ui.js';

  // Horizontal bars (single choice, multiple choice, a ranking's support scores): the label on the left (it wraps, and is never cut), the bar from one
  // baseline, its value written at its end, hairline gridlines at every quarter, and the scale under them. Every bar is a button: a pointer over it or the
  // keyboard on it lifts it and shows its tooltip, and pressing it opens the names of the people who picked it (when names are shown). The bars draw
  // in once, the first time (400 ms); after that a refresh moves them smoothly to their new length and nothing draws in again. In full screen (`fit`, Phase
  // 11a-2) the chart takes the height its card gives it: the rows share it out, each bar keeping its thickness in the middle of its row, so nothing is
  // left empty under the chart.
  let { rows, ticks, selected = null, onSelect, withNames = false, panelId = '', fit = false }: {
    rows: BarRow[];
    ticks: string[];
    selected?: string | null;
    onSelect?: (id: string | null) => void;
    withNames?: boolean;
    panelId?: string;
    fit?: boolean;
  } = $props();

  let frame = $state<HTMLDivElement>();
  let drawn = $state(false);
  let tip = $state<Tip | null>(null);
  const tipId = uid('bar-tip');
  const ranked = $derived(rows.some((row) => row.rank !== undefined));
  /** Where the gridlines are, as shares of the bars' room: every quarter. The figures of the scale under them sit on the lines they name. */
  const GRIDLINES = [0, 0.25, 0.5, 0.75, 1];

  onMount(() => {
    const frameId = requestAnimationFrame(() => requestAnimationFrame(() => { drawn = true; }));
    return () => cancelAnimationFrame(frameId);
  });

  // The tooltip keeps clear of the whole row (the bar's label is in it), centred over the bar's room.
  function show(row: BarRow, mark: HTMLElement) {
    tip = { id: tipId, mark: row.id, ...row.tip, target: mark, clear: [], centre: mark.querySelector<HTMLElement>('.bars__track') };
  }

  function hide(row: BarRow) {
    if (tip?.mark === row.id) tip = null;
  }

  // A tooltip opened by a touch stays until something else is touched (a finger has no "leave").
  function onDocumentPointer(event: PointerEvent) {
    if (tip && frame && !frame.contains(event.target as Node)) tip = null;
  }
</script>

<svelte:document onpointerdown={onDocumentPointer} />

<div class="bars" class:bars--ranked={ranked} class:bars--fit={fit} data-drawn={drawn || undefined} bind:this={frame}>
  <div class="bars__body">
    <div class="bars__grid" aria-hidden="true">
      {#if ranked}<span></span>{/if}<span></span><span class="bars__scale">{#each GRIDLINES as at (at)}<span class="bars__gridline" data-at={at} style:--at={at}></span>{/each}</span>
    </div>
    <ul class="bars__rows">
      {#each rows as row (row.id)}
        <li class="bars__item">
          <button
            type="button"
            class="bars__row"
            class:bars__row--strong={row.strong}
            data-mark={row.id}
            aria-label={row.name}
            aria-expanded={withNames ? selected === row.id : undefined}
            aria-controls={withNames && selected === row.id ? panelId : undefined}
            aria-describedby={tip?.mark === row.id ? tipId : undefined}
            style:--share={row.fraction}
            onpointerenter={(event) => show(row, event.currentTarget)}
            onpointerleave={(event) => { if (event.pointerType === 'mouse') hide(row); }}
            onfocus={(event) => show(row, event.currentTarget)}
            onblur={() => hide(row)}
            onclick={(event) => { show(row, event.currentTarget); if (withNames) onSelect?.(selected === row.id ? null : row.id); }}
          >
            {#if ranked}<span class="bars__rank">{row.rank}</span>{/if}
            <span class="bars__label" data-label-of={row.id}>
              <span class="bars__text" data-tip-soft>{row.label}</span>
              {#each row.tags as tag (tag.text)}
                <span class="bars__tag">{#if tag.tick}<svg class="bars__tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8.5l3.5 3.5 7.5-8" /></svg>{/if}{tag.text}</span>
              {/each}
            </span>
            <span class="bars__track">
              <span class="bars__bar bars__bar--{row.tone}"></span>
              <span class="bars__value" data-tip-soft>{row.value}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </div>
  <div class="bars__axis" aria-hidden="true">
    {#if ranked}<span></span>{/if}<span></span>
    <span class="bars__ticks">
      {#each ticks as label, index (index)}<span class="bars__tick-label" data-at={ticks.length > 1 ? index / (ticks.length - 1) : 0} style:--at={ticks.length > 1 ? index / (ticks.length - 1) : 0}>{label}</span>{/each}
    </span>
  </div>
  <ChartTip {tip} />
</div>

<style>
  /* The columns every row shares, so that the labels line up on the left and every bar starts on one baseline: the label, then the bar's room. A
     ranking has its place before the label. The bar's room keeps space at its right end for the value, so a full bar's value is never cut off. */
  .bars {
    --bars-columns: minmax(0, 38%) minmax(0, 1fr);
    --bars-gap: calc(0.75rem * var(--chart-scale, 1));
    --value-room: calc(6rem * var(--chart-scale, 1)); /* in rem: the scale under the bars has smaller type, and must line up */
    --bar-thickness: calc(24px * var(--chart-scale, 1));
    position: relative;
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .bars--ranked {
    --bars-columns: calc(2.6rem * var(--chart-scale, 1)) minmax(0, 34%) minmax(0, 1fr);
  }

  .bars__body {
    position: relative;
  }

  .bars__grid,
  .bars__axis {
    display: grid;
    grid-template-columns: var(--bars-columns);
    column-gap: var(--bars-gap);
  }

  .bars__grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  /* Gridlines at 0, 25, 50, 75 and 100: hairlines, solid, one colour; the line at 0 is the baseline. Each is a pixel wide, its left edge at its share of the
     room less that pixel, so the line at 100 ends where a full bar ends. */
  .bars__scale {
    position: relative;
    margin-right: var(--value-room);
  }

  .bars__gridline {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--at) * (100% - 1px));
    width: 1px;
    background: var(--viz-grid);
  }

  .bars__rows {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bars__row {
    display: grid;
    grid-template-columns: var(--bars-columns);
    column-gap: var(--bars-gap);
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    /* The admin page's target size, 44px (the bar itself is 24px at most); a card in full screen, where a bar opens nothing, sets 24px. */
    min-height: max(var(--mark-target, 44px), var(--bar-thickness));
    margin: 0;
    padding: calc(0.2rem * var(--chart-scale, 1)) 0;
    color: var(--viz-text);
    font: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 0.3rem;
    cursor: pointer;
  }

  .bars__rank {
    color: var(--viz-text);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .bars__label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.15rem 0.5rem;
    min-width: 0;
    line-height: 1.3;
  }

  .bars__text {
    overflow-wrap: anywhere;
  }

  .bars__row--strong .bars__text {
    font-weight: 700;
  }

  .bars__tag {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 700;
    white-space: nowrap;
  }

  .bars__tick {
    width: 1.1em;
    height: 1.1em;
    fill: none;
    stroke: var(--viz-correct);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .bars__track {
    position: relative;
    display: block;
    padding-right: var(--value-room);
  }

  .bars__bar {
    display: block;
    width: calc(var(--share) * 100%);
    height: var(--bar-thickness);
    background: var(--viz-primary-tint);
    border-radius: 0 4px 4px 0; /* rounded at the value's end, square on the baseline */
    transition: width 400ms ease-out;
  }

  .bars__bar--top {
    background: var(--viz-primary);
  }

  .bars__bar--correct {
    background: var(--viz-correct);
  }

  .bars:not([data-drawn]) .bars__bar {
    width: 0;
  }

  /* Full screen: the rows share out the height the card gives the chart (the gridlines run the whole height), and each bar stays in the middle of its row. */
  .bars--fit {
    display: flex;
    flex-direction: column;
  }

  .bars--fit .bars__body {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
  }

  .bars--fit .bars__rows {
    flex: 1 0 auto;
  }

  .bars--fit .bars__item {
    display: flex;
    flex: 1 0 auto;
  }

  .bars__value {
    position: absolute;
    top: 50%;
    left: calc(var(--share) * (100% - var(--value-room)) + 0.4em);
    color: var(--viz-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transform: translateY(-50%);
    transition: left 400ms ease-out;
  }

  .bars:not([data-drawn]) .bars__value {
    left: 0.4em;
  }

  /* A bar lifts when a pointer is over it, the keyboard is on it, or its names are open. */
  .bars__row:hover .bars__bar,
  .bars__row:focus-visible .bars__bar,
  .bars__row[aria-expanded='true'] .bars__bar {
    outline: 2px solid var(--viz-text);
    outline-offset: 1px;
  }

  .bars__axis {
    margin-top: calc(0.3rem * var(--chart-scale, 1));
  }

  .bars__ticks {
    position: relative;
    display: block;
    height: 1.4em;
    margin-right: var(--value-room);
    color: var(--viz-text-secondary);
    font-size: calc(0.8125rem * var(--chart-scale, 1));
  }

  /* Each figure is centred on the middle of its gridline, the ones at the ends too (Phase 11a-2: "100" sat 8px left of its line and "0" right of the
     baseline). The room kept at the right for a full bar's value is room enough for the last figure, and the gap before the bars for the first. */
  .bars__tick-label {
    position: absolute;
    top: 0;
    left: calc(var(--at) * (100% - 1px) + 0.5px);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transform: translateX(-50%);
  }

  /* A phone: the label above its bar, so the bar has the card's whole width (beside it, a 100% bar would be a few dozen pixels). Every bar still
     starts at the same left edge and has its value written at its end; the shared gridlines and the scale are left out, because they would run
     through the labels. */
  @media (max-width: 560px) {
    .bars {
      --bars-columns: minmax(0, 1fr);
    }

    .bars--ranked {
      --bars-columns: calc(2.2rem * var(--chart-scale, 1)) minmax(0, 1fr);
    }

    .bars__row {
      row-gap: 0.3rem;
    }

    .bars__track {
      grid-column: -2 / -1;
    }

    .bars__grid,
    .bars__axis {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bars__bar,
    .bars__value {
      transition: none;
    }
  }
</style>
