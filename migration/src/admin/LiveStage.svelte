<script lang="ts">
  // The Live display in full screen: ONE question, its activity and place over it, and at the foot "More below", Previous, Next and the
  // Auto-advance switch (Phase 17: moved out of LiveDisplay.svelte unchanged, its markup and its styles). Which question, its fit, the timer and
  // the full screen itself are LiveDisplay's: it binds the stage it measures and the height of the foot, and this hands each press back.
  // The rules that hang on the display's own state (`.live--present`, `.live--spill`, its idle flag) name it as the ancestor it is.
  import ResultCard from './charts/ResultCard.svelte';
  import type { Chart } from './charts/chart-ui.js';

  let {
    stage = $bindable(), footHeight = $bindable(), current, currentChart, currentTitle, at, count, revealed, selected, scale, spill, atEnd, autoAdvance,
    onToggleAnswer, onSelect, onGo, onToggleAuto,
  }: {
    stage?: HTMLElement;
    footHeight: number;
    /** The question on screen, if there is one. */
    current: { id: string } | undefined;
    currentChart: Chart | null;
    /** The title of its activity, or ''. */
    currentTitle: string;
    at: number;
    count: number;
    revealed: Record<string, boolean>;
    selected: Record<string, string | null>;
    scale: number;
    spill: boolean;
    atEnd: boolean;
    autoAdvance: boolean;
    onToggleAnswer: (questionId: string) => void;
    onSelect: (questionId: string, id: string | null) => void;
    /** Previous (-1) or Next (1). */
    onGo: (step: number) => void;
    onToggleAuto: () => void;
  } = $props();
</script>

<div class="live__stage" bind:this={stage}>
  {#if current}
    <p class="live__eyebrow">{currentTitle ? `${currentTitle} · ` : ''}Question {at + 1} of {count}</p>
    {#key current.id}
      {#if currentChart}<ResultCard chart={currentChart} wall marked={!!revealed[currentChart.id]} onToggleAnswer={() => onToggleAnswer(current.id)} selected={selected[current.id] ?? null} onSelect={(id) => onSelect(current.id, id)} {scale} fit {spill} level={3} />{/if}
    {/key}
  {:else}
    <p class="live__status">This session has no live questions yet.</p>
  {/if}
</div>
{#if count > 0}
  <div class="live__foot" bind:clientHeight={footHeight}>
    <!-- (It floats over the page just above the controls and takes no room, so nothing moves under the pointer when it goes.) -->
    {#if spill}<p class="live__more" data-testid="more-below" style:visibility={atEnd ? 'hidden' : null}>More below <span aria-hidden="true">↓</span></p>{/if}
    <div class="live__pager" role="group" aria-label="Question controls">
      <button class="btn" type="button" aria-label="Previous question" onclick={() => onGo(-1)} disabled={count < 2}>← Previous</button>
      <button class="btn" type="button" aria-label="Next question" onclick={() => onGo(1)} disabled={count < 2}>Next →</button>
      <button class="btn live__auto" type="button" role="switch" aria-checked={autoAdvance} onclick={onToggleAuto} disabled={count < 2}>Auto-advance every 15 s <span class="live__auto-state" aria-hidden="true">{autoAdvance ? 'On' : 'Off'}</span></button>
    </div>
  </div>
{/if}

<style>
  .live__status {
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.5rem;
  }

  /* The way out is shown in full screen, and fades (and the pointer hides) after a few idle seconds; any movement, touch, key or focus brings it back.
     It stays in the page for the keyboard and the screen reader the whole time. */
  .live__pager {
    transition: opacity 160ms ease;
  }

  /* The room for the card: what is left between the heading and the controls. */
  .live__stage {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: calc(0.5rem * var(--chart-scale, 1));
    min-height: 0;
  }

  .live__eyebrow {
    flex: 0 0 auto;
    margin: 0;
    color: rgb(255 255 255 / 0.92);
    font-size: calc(1.1rem * var(--chart-scale, 1));
    font-weight: 600;
  }

  .live__foot {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  /* A question too long for the screen: the screen scrolls as one page, the controls stay at its foot, and "More below" says there is more. */
  :global(.live--spill) .live__stage {
    flex: 0 0 auto;
  }

  /* Solid, so that the card's words do not show through behind the controls, and down to the screen's edge (a sticky box keeps clear of its scroller's
     padding unless told otherwise). */
  :global(.live--spill) .live__foot {
    position: sticky;
    bottom: calc(-1 * var(--live-pad));
    padding: 0.5rem 0;
    background: #000102;
    border-radius: 0.6rem;
  }

  .live__more {
    position: absolute;
    bottom: calc(100% + 0.5rem);
    margin: 0;
    padding: 0.25rem 0.9rem;
    color: #fff;
    font-size: calc(1rem * var(--chart-scale, 1));
    font-weight: 700;
    white-space: nowrap;
    background: #000102;
    border: 1px solid rgb(255 255 255 / 0.7);
    border-radius: 999px;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.3);
    pointer-events: none;
  }

  .live__pager {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
  }

  .live__auto-state {
    display: inline-block;
    min-width: 2.2rem;
    margin-left: 0.4rem;
    padding: 0.1rem 0.5rem;
    font-weight: 700;
    text-align: center;
    border: 1px solid currentcolor;
    border-radius: 999px;
  }

  :global(.live--present[data-idle='true']) .live__pager:not(:has(:focus-visible)) {
    opacity: 0;
  }

  :global(.live--present) .live__status {
    color: var(--adm-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .live__pager { transition: none; }
  }
</style>
