<script lang="ts">
  import { people } from '../../lib/results/results-chart-model.js';
  import BarChart, { type BarRow } from './BarChart.svelte';
  import MatrixChart from './MatrixChart.svelte';
  import ChartTable from './ChartTable.svelte';
  import NamesPanel from './NamesPanel.svelte';
  import ScaleChart from './ScaleChart.svelte';
  import SplitBar, { type Side } from './SplitBar.svelte';
  import WordsChart from './WordsChart.svelte';
  import { VIEW_NUMBERS, isLatestPanel, notePanel, uid, type Chart, type Who } from './chart-ui.js';

  // One question's results on the admin page (Phase 11a): the headline in plain words, the question, how many answered, a 4px Deloitte Green rule on
  // the card's top edge, and the chart that fits the question (lib/results/results-chart-model.js works out every number): bars for single and multiple choice,
  // one split bar for true or false, columns for a confidence scale, support scores for a ranking, and the words and comments of written answers.
  // A button swaps the chart for its numbers (its accessible twin). On the admin view a bar opens the names of the people who picked it, under the card; on the wall
  // display (full screen, and the page "Open in a new tab" opens) there are no names anywhere in the page: the card is given a model without them.
  // On the wall a graded question's correct answer is not marked until the presenter presses Show answer on its card (a choice kept in memory only).
  //
  // (The label of the numbers button is spelt in two parts in chart-ui.ts: Tailwind reads every file under migration/ for class names, and that one
  // word would add a rule to the participant page, which must not change.)
  let { chart, wall = false, withNames = false, marked, onToggleAnswer, selected = null, onSelect, scale = 1, fit = false, spill = false, level = 4 }: {
    chart: Chart;
    /** The wall display: no names, and Show answer on a graded question. */
    wall?: boolean;
    /** The names panel can be opened (the admin view with Names shown on). */
    withNames?: boolean;
    /** The correct answer is marked (always on the admin view; on the wall once Show answer is pressed). */
    marked: boolean;
    onToggleAnswer?: () => void;
    /** The open answer (its names panel), or for written answers the chosen word: kept by the page, so a refresh keeps it. */
    selected?: string | null;
    onSelect?: (id: string | null) => void;
    scale?: number;
    /** Full screen: the card fills the height it is given, and its chart takes what the words above it leave. */
    fit?: boolean;
    /** Full screen, for a question too long for the screen even at the smallest type: the card is as tall as it needs, and the screen scrolls as one page. */
    spill?: boolean;
    /** The heading level of the question. */
    level?: number;
  } = $props();

  let card = $state<HTMLElement>();
  let numbers = $state(false);
  const promptId = uid('result-prompt');
  const panelId = uid('names');

  const barRows = $derived.by((): BarRow[] => {
    if (chart.kind === 'ranking') {
      return chart.options.map((item: any) => ({
        id: item.id,
        label: item.label,
        value: String(item.score),
        fraction: Math.max(0, Math.min(1, item.score / 100)),
        tone: item.rank === 1 && chart.answered > 0 ? 'top' : 'rest',
        tags: [],
        rank: item.rankLabel,
        name: `${item.rankLabel} ${item.label}: support score ${item.score}`,
        tip: { value: `Support score ${item.score}`, label: item.label, extra: `${item.points} points · ${item.firsts} first ${item.firsts === 1 ? 'place' : 'places'} · ${people(item.rankers)} ranked it` },
      }));
    }
    if (chart.kind === 'matrix') return [];
    return chart.options.map((option: any) => {
      const correct = marked && option.isCorrect;
      const tags = [...(correct ? [{ text: 'Correct', tick: true }] : []), ...(option.isTop ? [{ text: 'Top choice' }] : [])];
      return {
        id: option.id,
        label: option.label,
        value: `${option.count} · ${option.percent}%`,
        fraction: Math.max(0, Math.min(1, option.share)),
        tone: correct ? 'correct' : option.isTop ? 'top' : 'rest',
        tags,
        strong: correct,
        name: `${option.label}: ${people(option.count)}, ${option.percent}%${option.isTop ? ', top choice' : ''}${correct ? ', the correct answer' : ''}`,
        tip: { value: `${people(option.count)} · ${option.percent}%`, label: option.label },
      };
    });
  });

  const sides = $derived.by((): [Side, Side] | null => {
    if (chart.kind !== 'truefalse') return null;
    const [left, right] = chart.sides.map((side: any): Side => {
      const correct = marked && side.isCorrect;
      return {
        id: side.id, label: side.label, percent: side.percent, fraction: Math.max(0, Math.min(1, side.share)), count: side.count, correct,
        name: `${side.label}: ${people(side.count)}, ${side.percent}%${correct ? ', the correct answer' : ''}`,
        tip: { value: `${people(side.count)} · ${side.percent}%`, label: side.label },
      };
    });
    return [left, right];
  });

  // The open answer's names, from the model; when that answer has gone (deleted while open) the panel closes by itself.
  const open = $derived(chart.kind === 'text' || chart.kind === 'matrix' || !withNames || !selected ? null : (chart.options as { id: string; label: string; who: Who[] }[]).find((option) => option.id === selected) ?? null);
  const announce = $derived(open ? `${chart.kind === 'ranking' ? 'How people ranked' : 'Who picked'} ${open.label}: ${people(open.who.length)}` : '');

  function close() {
    const id = selected;
    onSelect?.(null);
    if (id) card?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(id)}"]`)?.focus();
  }

  $effect(() => {
    notePanel(promptId, open !== null);
    return () => notePanel(promptId, false);
  });

  // Esc closes this card's names when the keyboard is in this card, or, when the keyboard is in no card, when they are the most recently opened
  // (Safari does not focus a button that is clicked, so after a click the keyboard is wherever it was before).
  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open || event.defaultPrevented) return;
    const inCard = (document.activeElement as HTMLElement | null)?.closest?.('.result-card');
    if (inCard ? inCard !== card : !isLatestPanel(promptId)) return;
    event.preventDefault();
    close();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<article
  class="result-card"
  class:result-card--fit={fit}
  class:result-card--spill={fit && spill}
  data-kind={chart.kind}
  data-question={chart.id}
  aria-labelledby={promptId}
  style:--chart-scale={scale}
  bind:this={card}
>
  {#if fit}
    <!-- Full screen (Prompt 34): the headline's figures in Bold and its measure underlined, where the chart model's template puts them, and the
         question's one hero figure beside it with the line saying what it is. The same words as the admin view's. -->
    <div class="result-card__top">
      <div class="result-card__words">
        <p class="result-card__headline" data-tip-avoid>{#each chart.headlineParts as part, index (index)}{#if part.strong}<strong class="result-card__figure">{part.text}</strong>{:else if part.measure}<span class="result-card__measure">{part.text}</span>{:else}{part.text}{/if}{/each}</p>
        <svelte:element this={`h${level}`} class="result-card__prompt" id={promptId} data-tip-avoid>{chart.prompt}</svelte:element>
      </div>
      {#if chart.hero}<p class="result-card__hero" data-tip-avoid data-testid="wall-hero"><span class="result-card__hero-figure">{chart.hero.figure}</span><span class="result-card__hero-context">{chart.hero.context}</span></p>{/if}
    </div>
  {:else}
    <p class="result-card__headline" data-tip-avoid>{chart.headline}</p>
    <svelte:element this={`h${level}`} class="result-card__prompt" id={promptId} data-tip-avoid>{chart.prompt}</svelte:element>
  {/if}
  <!-- (The two buttons say what they will do, so they carry no aria-pressed: a toggle changes its words or its pressed state, never both.) -->
  <!-- (Prompt 39: an Art of the Possibility card on the admin page draws this row above its grid, Sort by beside it.) -->
  {#snippet metaLine()}<p class="result-card__meta" data-tip-avoid>{#if chart.kind === 'matrix'}{wall ? chart.wallLine : chart.metaLine}{:else}{chart.answered} answered{marked && chart.gradedLine ? ` · ${chart.gradedLine}` : ''}{/if}</p>{/snippet}
  {#snippet numbersTool()}<button type="button" class="result-card__tool" data-tip-avoid onclick={() => { numbers = !numbers; }}>{numbers ? 'View as chart' : VIEW_NUMBERS}</button>{/snippet}
  {#if !(chart.kind === 'matrix' && !fit && !numbers)}
  <div class="result-card__bar">
    <p class="result-card__meta" data-tip-avoid>{#if chart.kind === 'matrix'}{wall ? chart.wallLine : chart.metaLine}{:else}{chart.answered} answered{marked && chart.gradedLine ? ` · ${chart.gradedLine}` : ''}{/if}</p>
    <div class="result-card__tools">
      {#if wall && chart.graded}
        <button type="button" class="result-card__tool" data-tip-avoid onclick={() => onToggleAnswer?.()}>{marked ? 'Hide answer' : 'Show answer'}</button>
      {/if}
      {@render numbersTool()}
    </div>
  </div>
  {/if}

  <div class="result-card__body">
    {#if numbers}
      <ChartTable {chart} {marked} />
    {:else if chart.kind === 'matrix'}
      <MatrixChart {chart} withNames={withNames && !wall} fit={wall} level={level + 1} head={fit ? undefined : metaLine} tools={fit ? undefined : numbersTool} />
    {:else if chart.kind === 'text'}
      <WordsChart {chart} chosen={selected} onChoose={(word) => onSelect?.(word)} fit={fit && !spill} headingLevel={level + 1} />
    {:else if chart.kind === 'truefalse' && sides}
      <SplitBar {sides} {selected} {onSelect} {withNames} {panelId} fit={fit && !spill} />
    {:else if chart.kind === 'scale'}
      <ScaleChart {chart} {selected} {onSelect} {withNames} {panelId} fit={fit && !spill} />
    {:else}
      <BarChart rows={barRows} ticks={chart.kind === 'ranking' ? ['0', '50', '100'] : ['0%', '50%', '100%']} {selected} {onSelect} {withNames} {panelId} fit={fit && !spill} />
    {/if}
  </div>

  {#if chart.caption}<p class="result-card__caption" data-tip-avoid>{chart.caption}</p>{/if}
  {#if chart.removedLine}<p class="result-card__caption" data-tip-avoid>{chart.removedLine}</p>{/if}
  {#if open}
    <NamesPanel id={panelId} label={open.label} who={open.who} ranking={chart.kind === 'ranking'} headingLevel={level + 1} onClose={close} />
  {/if}
  {#if withNames}<p class="sr-only" aria-live="polite">{announce}</p>{/if}
</article>

<style>
  /* A white sheet with Deloitte Green along its top edge: the accent, never a bar. Every chart sits on it, on the admin page and on the wall alike. */
  .result-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: calc(0.5rem * var(--chart-scale, 1));
    box-sizing: border-box;
    min-width: 0;
    padding: calc(1.1rem * var(--chart-scale, 1)) calc(1.25rem * var(--chart-scale, 1)) calc(1.25rem * var(--chart-scale, 1));
    color: var(--viz-text);
    background: var(--viz-surface);
    border: 1px solid var(--viz-grid);
    border-top: 4px solid var(--viz-brand);
    border-radius: 0.6rem;
  }

  .result-card__headline {
    margin: 0;
    font-size: calc(1.15rem * var(--chart-scale, 1));
    font-weight: 700;
    line-height: 1.3;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .result-card__prompt {
    margin: 0;
    color: var(--viz-text);
    font-size: calc(1rem * var(--chart-scale, 1));
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .result-card__meta,
  .result-card__caption {
    margin: 0;
    color: var(--viz-text-secondary);
    font-size: calc(0.875rem * var(--chart-scale, 1));
    font-weight: 600;
  }

  /* How many answered on the left, and the card's buttons on the right of the same line (under it when the card is narrow). */
  .result-card__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
  }

  .result-card__tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-left: auto;
  }

  /* Prompt 39, a card on the admin page: the headline, the question, the meta line, then the numbers button on a row of its own, then the chart, in
     every card in that order (the wall keeps its own row). */
  .result-card:not(.result-card--fit) .result-card__bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .result-card:not(.result-card--fit) .result-card__tools {
    justify-content: flex-start;
    margin-left: 0;
  }

  .result-card__tool {
    min-height: 44px;
    padding: 0 0.9rem;
    color: var(--viz-text);
    font: inherit;
    font-size: calc(0.875rem * var(--chart-scale, 1));
    font-weight: 600;
    background: var(--viz-surface);
    border: 1px solid var(--viz-text-secondary);
    border-radius: 0.5rem;
    cursor: pointer;
  }

  .result-card__body {
    min-width: 0;
  }

  /* Full screen: the card is exactly as tall as the room it is given, and the chart takes what the words above it leave. */
  .result-card--fit {
    --mark-target: 24px; /* in full screen a bar opens no names: its row needs only the 24px hit area, and the room goes to the chart */
    flex: 1 1 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  /* The chart takes the room that is left and never less than it needs, so a card that is too tall overflows where the full screen's fit can see it
     (and make the type smaller) instead of drawing its chart over the words under it. Written answers are the exception: their room is what it is,
     and the comments that do not fit are counted, not drawn. Since Phase 11a-2 the chart itself fills that room (the bars share it out, a scale's
     plot is as tall as it allows, a true-or-false split sits in its middle): on the real site a confidence question had its plot at the top of the
     card and an empty white space under it. */
  .result-card--fit .result-card__body {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
  }

  .result-card--fit:not([data-kind='text']) .result-card__body > :global(*) {
    flex: 1 0 auto;
  }

  .result-card--fit[data-kind='text'] .result-card__body {
    flex: 1 1 0;
    min-height: 0;
  }

  /* A question too long for the screen even at the smallest type: the card is as tall as it needs, cuts nothing, and the screen scrolls as one page
     (LiveDisplay says "More below"). Never a scrolling box inside the card. */
  .result-card--fit.result-card--spill {
    flex: 0 0 auto;
    height: auto;
    overflow: visible;
  }

  .result-card--fit.result-card--spill .result-card__body {
    flex: 0 0 auto;
    min-height: auto;
  }

  /* ---- The wall's dark data look (Prompt 34): an outlined panel on black, a 1.5 px lime hairline and a 12 px radius; the headline and the hero
     figure side by side; small labels upper case and tracked, never under 28 px at 1080p (0.95rem at the wall's 1.9). Its colours are the wall's
     (LiveDisplay.svelte points the --viz-* names at the admin tokens while it is full screen). */
  .result-card--fit {
    border: 1.5px solid var(--wall-line, var(--adm-lime));
    border-radius: 12px;
  }

  .result-card__top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: calc(0.5rem * var(--chart-scale, 1)) calc(1.5rem * var(--chart-scale, 1));
  }

  .result-card__words {
    display: flex;
    flex-direction: column;
    gap: calc(0.5rem * var(--chart-scale, 1));
    min-width: 0;
  }

  .result-card--fit .result-card__headline {
    font-weight: var(--fw-regular, 400);
  }

  .result-card__figure {
    font-weight: 700;
  }

  /* The measure's name: a 4 px sky rule under its words, a mark that is never the only cue (the words say it). Drawn as a border: the one word
     for a text line would add a rule of that name to the participant page (Tailwind reads every file under migration/). */
  .result-card__measure {
    border-bottom: 4px solid var(--adm-sky);
    box-decoration-break: clone;
  }

  .result-card__hero {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    max-width: calc(12rem * var(--chart-scale, 1));
    text-wrap: balance;
    margin: 0;
    text-align: right;
  }

  .result-card__hero-figure {
    color: var(--wall-figure, var(--adm-ink));
    font-size: calc(3.2rem * var(--chart-scale, 1));
    font-weight: 600;
    font-variant-numeric: proportional-nums;
    line-height: 1;
  }

  .result-card__hero-context,
  .result-card--fit .result-card__meta {
    font-size: calc(0.95rem * var(--chart-scale, 1));
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .result-card--fit :is(.result-card__caption, .result-card__tool) {
    font-size: calc(0.95rem * var(--chart-scale, 1));
  }

  .result-card--fit .result-card__tool {
    border: 1.5px solid var(--wall-line, var(--adm-lime));
    border-radius: 12px;
  }

  /* The charts' own small words (a tag, an axis, a count) at the same least size on the wall. */
  .result-card--fit :global(:is(.bars__tag, .bars__ticks, .split__count, .scale__band-name, .words__more, .words__who, .aop__note, .aop__grid thead th, .numbers__grid thead th)) {
    font-size: max(0.875em, calc(0.95rem * var(--chart-scale, 1)));
  }

  @media (forced-colors: active) {
    .result-card__measure { border-bottom-color: CanvasText; }
    .result-card__hero-figure { color: CanvasText; }
  }
</style>
