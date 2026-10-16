<script lang="ts">
  import { onMount } from 'svelte';
  import ChartTip from './ChartTip.svelte';
  import { people } from '../../lib/results-chart-model.js';
  import { labelOf, rampColour, uid, type Chart, type Tip } from './chart-ui.js';

  // A confidence scale: one column for each step, low on the left and high on the right, in the blue ramp (lighter for low, darker for high: the
  // colour is the step's place, never its count), the count above each column, three light bands behind them (the lowest third, the middle and the
  // top, named under the axis from the question's own first and last answers, when a band holds more than one step: with three steps or fewer each
  // step is its own band and its label says it), and the average as a Dark Green line at its true place between the steps, labelled "Average 2.0
  // of 3" above the chart and marked with a pointer on the axis. The line runs behind the columns, so it never crosses a column or its count.
  // Each column is a button, as a bar is. In full screen (`fit`, Phase 11a-2) the plot takes the height its card gives it, so nothing is left empty under it.
  let { chart, selected = null, onSelect, withNames = false, panelId = '', fit = false }: {
    chart: Chart;
    selected?: string | null;
    onSelect?: (id: string | null) => void;
    withNames?: boolean;
    panelId?: string;
    fit?: boolean;
  } = $props();

  let frame = $state<HTMLDivElement>();
  let drawn = $state(false);
  let tip = $state<Tip | null>(null);
  const tipId = uid('scale-tip');
  const scale = $derived(chart.scale);
  const steps = $derived(scale.steps as { id: string; label: string; count: number; percent: number; share: number; tone: number; band: number }[]);
  const at = $derived(scale.averageAt === null ? null : (scale.averageAt + 0.5) / Math.max(1, steps.length));
  // The tallest column fills the plot and the others are in proportion: the count is written above each, and a scale has no axis of shares (drawn
  // as a share of everyone, 12 of 60 people at each of five steps was a row of stubs at the foot of an empty plot).
  const peak = $derived(Math.max(1, ...steps.map((step) => step.count)));
  // The bands are shaded in turn (the first, the third), so a count sits on the colour of its own band.
  const shaded = $derived(new Set((scale.bands as { band: number }[]).filter((_, index) => index % 2 === 0).map((band) => band.band)));

  onMount(() => {
    const frameId = requestAnimationFrame(() => requestAnimationFrame(() => { drawn = true; }));
    return () => cancelAnimationFrame(frameId);
  });

  // The tooltip is about the column as it is drawn (its count and its fill, not the empty room above them) and keeps clear of the step's own label under
  // it and of the average's label over the plot: above them, or under the step's label when there is no room above (Phase 11a-2: on the real site it
  // lay over the middle step's label).
  function show(step: (typeof steps)[number], mark: HTMLElement) {
    const drawn = [...mark.querySelectorAll<HTMLElement>('.scale__count, .scale__fill')];
    const label = labelOf(frame, step.id);
    const average = frame?.querySelector<HTMLElement>('.scale__average-label') ?? null;
    tip = { id: tipId, mark: step.id, value: `${people(step.count)} · ${step.percent}%`, label: step.label, target: drawn[0] ?? mark, clear: [...drawn, ...(label ? [label] : []), ...(average ? [average] : [])], centre: mark };
  }

  function hide(step: (typeof steps)[number]) {
    if (tip?.mark === step.id) tip = null;
  }

  function onDocumentPointer(event: PointerEvent) {
    if (tip && frame && !frame.contains(event.target as Node)) tip = null;
  }
</script>

<svelte:document onpointerdown={onDocumentPointer} />

<div class="scale" class:scale--fit={fit} data-drawn={drawn || undefined} style:--steps={steps.length} bind:this={frame}>
  <div class="scale__average-row" aria-hidden="true">
    {#if at !== null}<span class="scale__average-label" style:--at={at}>{scale.averageText}</span>{/if}
  </div>
  <div class="scale__plot">
    {#each scale.bands as band, index (band.band)}
      <span class="scale__band" class:scale__band--shaded={index % 2 === 0} style:grid-column={`${band.from + 1} / ${band.to + 2}`} aria-hidden="true"></span>
    {/each}
    {#if at !== null}<span class="scale__average" style:--at={at} aria-hidden="true"></span>{/if}
    {#each steps as step, index (step.id)}
      <button
        type="button"
        class="scale__column"
        style:grid-column={`${index + 1}`}
        style:--share={step.count / peak}
        style:--fill={rampColour(step.tone, scale.tones)}
        style:--behind={shaded.has(step.band) ? 'var(--viz-band-shade)' : 'var(--viz-surface)'}
        data-mark={step.id}
        aria-label={`${step.label}: ${people(step.count)}, ${step.percent}%`}
        aria-expanded={withNames ? selected === step.id : undefined}
        aria-controls={withNames && selected === step.id ? panelId : undefined}
        aria-describedby={tip?.mark === step.id ? tipId : undefined}
        onpointerenter={(event) => show(step, event.currentTarget)}
        onpointerleave={(event) => { if (event.pointerType === 'mouse') hide(step); }}
        onfocus={(event) => show(step, event.currentTarget)}
        onblur={() => hide(step)}
        onclick={(event) => { show(step, event.currentTarget); if (withNames) onSelect?.(selected === step.id ? null : step.id); }}
      >
        <span class="scale__count">{step.count}</span>
        <span class="scale__fill"></span>
      </button>
    {/each}
  </div>
  <div class="scale__axis" aria-hidden="true">
    {#if at !== null}<span class="scale__pointer" style:--at={at}></span>{/if}
  </div>
  <div class="scale__steps" aria-hidden="true">
    {#each steps as step (step.id)}<span class="scale__step" data-label-of={step.id}>{step.label}</span>{/each}
  </div>
  {#if steps.length > 3}
    <div class="scale__bands" aria-hidden="true">
      {#each scale.bands as band (band.band)}
        <span class="scale__band-name" style:grid-column={`${band.from + 1} / ${band.to + 2}`}>{band.name}</span>
      {/each}
    </div>
  {/if}
  {#if scale.averageText}<p class="sr-only">{scale.averageText}</p>{/if}
  <ChartTip {tip} />
</div>

<style>
  /* Nothing in a chart scrolls (Phase 11a-2: a box that scrolls cut the tooltip in half on the real site, and on Windows drew a scrollbar beside the columns
     when its height was a fraction of a pixel over). Every column is a 44px target where the card is wide enough; a scale of more steps than a phone's
     card can hold that way shares the width out instead. */
  .scale {
    --plot-height: calc(9rem * var(--chart-scale, 1));
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .scale__plot,
  .scale__steps,
  .scale__bands {
    display: grid;
    grid-template-columns: repeat(var(--steps), minmax(min(44px, calc(100% / var(--steps))), 1fr));
  }

  .scale__average-row {
    position: relative;
    height: 1.6em;
  }

  /* The label slides with the line, and never leaves the chart: at the left edge it reaches right, at the right edge left. */
  .scale__average-label {
    position: absolute;
    bottom: 0.2em;
    left: calc(var(--at) * 100%);
    color: var(--viz-text);
    font-weight: 700;
    white-space: nowrap;
    transform: translateX(calc(var(--at) * -100%));
  }

  .scale__plot {
    position: relative;
    grid-template-rows: var(--plot-height);
    border-bottom: 1px solid var(--viz-grid);
  }

  /* Full screen: the plot takes what the card leaves it, and never less than its own height. */
  .scale--fit .scale__plot {
    flex: 1 0 auto;
    grid-template-rows: minmax(var(--plot-height), 1fr);
  }

  .scale__band {
    grid-row: 1;
    background: var(--viz-surface);
  }

  .scale__band--shaded {
    background: var(--viz-band-shade);
  }

  .scale__column {
    position: relative;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.2em;
    min-width: 0;
    height: 100%;
    margin: 0;
    padding: 0;
    color: var(--viz-text);
    font: inherit;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  /* On its band's own colour, so that the average's line, behind it, never runs through the number. */
  .scale__count {
    padding: 0 0.3em;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    background: var(--behind);
    border-radius: 0.2em;
  }

  /* A column is 40% of its step's width, at least 24px and at most 72px on the admin page, and as many times that in full screen as the type is
     (Phase 11a-2: a 16px column in a step 260px wide looked lost). Columns are not horizontal bars: the 24px limit on a bar's thickness is not theirs.
     Never wider than its step, however many steps there are. */
  .scale__fill {
    display: block;
    width: min(100%, clamp(calc(24px * var(--chart-scale, 1)), 40%, calc(72px * var(--chart-scale, 1))));
    height: calc(var(--share) * (100% - 1.6em));
    background: var(--fill);
    border-radius: 4px 4px 0 0;
    transition: height 400ms ease-out;
  }

  .scale:not([data-drawn]) .scale__fill {
    height: 0;
  }

  .scale__column:hover .scale__fill,
  .scale__column:focus-visible .scale__fill,
  .scale__column[aria-expanded='true'] .scale__fill {
    outline: 2px solid var(--viz-text);
    outline-offset: 1px;
  }

  /* Behind the columns (it comes before them, and they are drawn after it): it shows above a column, and in an empty step, never over one. */
  .scale__average {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--at) * 100%);
    width: 2px;
    margin-left: -1px;
    background: var(--viz-marker);
    pointer-events: none;
  }

  .scale__column {
    z-index: 1;
  }

  /* The average's exact place, marked on the axis under the columns: a small Dark Green pointer. */
  .scale__axis {
    position: relative;
    height: 0.55em;
  }

  .scale__pointer {
    position: absolute;
    top: 0;
    left: calc(var(--at) * 100%);
    width: 0;
    height: 0;
    margin-left: -0.45em;
    border-right: 0.45em solid transparent;
    border-bottom: 0.55em solid var(--viz-marker);
    border-left: 0.45em solid transparent;
  }

  /* No gap between the steps' columns, so that each label is centred under its own column (the plot has none either); the room between two
     labels is their own padding. */
  .scale__steps {
    margin-top: 0.35em;
  }

  .scale__step {
    padding: 0 0.25rem;
    color: var(--viz-text);
    text-align: center;
    overflow-wrap: anywhere;
    line-height: 1.3;
  }

  .scale__bands {
    margin-top: 0.35em;
    padding-top: 0.3em;
    border-top: 1px solid var(--viz-grid);
  }

  .scale__band-name {
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 700;
    text-align: center;
    overflow-wrap: anywhere;
  }

  @media (prefers-reduced-motion: reduce) {
    .scale__fill {
      transition: none;
    }
  }
</style>
