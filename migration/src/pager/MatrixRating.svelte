<script module lang="ts">
  // Which view this visit last chose, in memory only (Prompt 23): a new page starts from the width again.
  let chosenView: 'grid' | 'single' | null = null;
  // The first-box bubble has gone for this visit (Prompt 35): after the first rating it does not come back until the page is opened again.
  let taught = false;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PillButton } from '../components/index.js';
  import { cellsLeft, cycle, decodeAnswer, encodeAnswer, nextEmpty, type Grid } from '../lib/participant/aop-answer.js';
  import { LEVEL_LOOK } from '../lib/participant/aop-levels.js';
  import { defaultView, gridWidthFor, levelCounts, rowIsDone, setCell } from '../lib/participant/aop-view.js';
  import { motion } from '../lib/motion/motion.js';
  import type { Question } from '../lib/participant/pager-logic.js';
  import '../styles/aop-level-tokens.css';

  // An Art of Possibility question (Prompt 23, rebuilt in Prompt 35): a guest rates every sub-process against every criterion. Two views of one answer, All at once
  // and One at a time; the ratings are the pager's draft, as the stored answer's list of strings (lib/participant/aop-answer.js), so a reload, Send and Preview all
  // treat them as any other answer. The ratings are this component's own state, changed one box at a time (lib/participant/aop-view.js), and every change is
  // handed up encoded, exactly as Prompt 34 stored it. Three fixed colours on a white well (styles/aop-level-tokens.css), and every box also has its shape and
  // its letter: never colour alone.
  let { question, draft, labelledby, onchange }: {
    question: Question;
    draft: string[] | undefined;
    labelledby: string;
    onchange: (answer: string[]) => void;
  } = $props();

  const KEYS: Record<string, number> = { l: 1, m: 2, h: 3 };
  const uid = $props.id();

  const rows = $derived(question.options);
  const criteria = $derived(question.criteria ?? []);
  const shape = $derived({ rows, criteria });

  const keyOf = (list: unknown) => (Array.isArray(list) ? list.join('\n') : '');
  const decoded = () => decodeAnswer(draft, { rows: question.options, criteria: question.criteria ?? [] }).grid;
  const draftKey = () => keyOf(draft);
  /** The guest's ratings. A box changes in place, so only it, its row and the strip are drawn again. */
  let cells = $state<Grid>(decoded());
  /** What this component last handed up: a draft that differs (a reload's, Clear all's, a restored one) is read in again. */
  let sent = draftKey();
  $effect.pre(() => {
    const key = keyOf(draft);
    if (key !== sent) { cells = decodeAnswer(draft, shape).grid; sent = key; }
  });

  const total = $derived(rows.length * criteria.length);
  const left = $derived(cellsLeft(cells, shape));
  const rated = $derived(total - left);
  const counts = $derived(levelCounts(cells, shape));

  let view = $state<'grid' | 'single'>(chosenView ?? 'grid');
  /** The grid would need a sideways scroll at this width: only when the guest chose it on a narrow screen. */
  let cramped = $state(false);
  let rowAt = $state(0);
  /** The box the keyboard is on: the one tab stop of the grid. */
  let focusRow = $state(0);
  let focusColumn = $state(0);
  let host = $state<HTMLElement>();
  /** The criterion whose note is open beside its heading, or null. */
  let about = $state<string | null>(null);
  let moreOpen = $state(false);
  let confirmingClear = $state(false);
  let teach = $state(!taught);
  let stripHeight = $state(0);
  let spoken = $state('');
  let spokenAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const fit = () => { cramped = window.innerWidth < gridWidthFor(criteria.length); };
    if (!chosenView) view = defaultView({ width: window.innerWidth, height: window.innerHeight, criteria: criteria.length });
    fit();
    window.addEventListener('resize', fit, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener('resize', fit); };
  });

  function choose(next: 'grid' | 'single') {
    view = next;
    chosenView = next;
  }

  /** The counter, as a polite live region: at most one update a second, and the last one always arrives. */
  function say() {
    clearTimeout(timer);
    const wait = Math.max(0, spokenAt + 1000 - Date.now());
    timer = setTimeout(() => { spokenAt = Date.now(); spoken = left === 0 ? 'All rated.' : `${rated} of ${total} rated.`; }, wait);
  }

  function handUp() {
    const answer = encodeAnswer(cells);
    sent = keyOf(answer);
    onchange(answer);
    say();
  }

  function set(rowId: string, criterionId: string, level: number | undefined) {
    setCell(cells, rowId, criterionId, level);
    if (level !== undefined && teach) { teach = false; taught = true; }
    handUp();
  }

  const levelOf = (rowId: string, criterionId: string): number | undefined => cells[rowId]?.[criterionId];
  const cellName = (rowLabel: string, criterionLabel: string, level: number | undefined) => `${rowLabel}, ${criterionLabel}: ${level ? LEVEL_LOOK[level as 1 | 2 | 3].name : 'not rated'}`;
  const look = (level: number) => LEVEL_LOOK[level as 1 | 2 | 3];
  const rowDone = (rowId: string) => rowIsDone(cells, shape, rowId);
  /** The box the bubble points at: the first empty one, until the first rating. */
  const firstEmpty = $derived(teach && view === 'grid' ? nextEmpty(cells, shape) : null);

  async function focusCell(row: number, column: number) {
    focusRow = row;
    focusColumn = column;
    await tick();
    host?.querySelector<HTMLElement>(`[data-cell="${row}-${column}"]`)?.focus();
  }

  function onCellKey(event: KeyboardEvent, row: number, column: number) {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = moves[event.key];
    if (step) {
      event.preventDefault();
      void focusCell(Math.min(rows.length - 1, Math.max(0, row + step[0])), Math.min(criteria.length - 1, Math.max(0, column + step[1])));
      return;
    }
    const level = KEYS[event.key.toLowerCase()];
    const clearing = event.key === 'Delete' || event.key === 'Backspace';
    if ((level || clearing) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      set(rows[row].id, criteria[column].id, level);
    }
  }

  /** Next empty box: the strip's button, in either view. */
  async function goToEmpty() {
    const at = rows[view === 'grid' ? focusRow : rowAt];
    const from = at && criteria[focusColumn] ? { rowId: at.id, criterionId: criteria[focusColumn].id } : null;
    const box = nextEmpty(cells, shape, from);
    if (!box) return;
    const row = rows.findIndex((each) => each.id === box.rowId);
    const column = criteria.findIndex((each) => each.id === box.criterionId);
    if (view === 'grid') { await focusCell(row, column); return; }
    rowAt = row;
    focusColumn = column;
    await tick();
    host?.querySelector<HTMLElement>(`[data-segments="${column}"] button`)?.focus();
  }

  function clearAll() {
    confirmingClear = false;
    moreOpen = false;
    cells = {};
    handUp();
  }

  /** A note or the menu closes on Escape and on a tap anywhere else; a tap on its own button is that button's to handle. */
  function onDocumentDown(event: PointerEvent) {
    const target = event.target as Element | null;
    if (about !== null && !target?.closest('[data-about]')) about = null;
    if (moreOpen && !target?.closest('[data-more]')) { moreOpen = false; confirmingClear = false; }
  }
  function onDocumentKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (about !== null) {
      const open = about;
      about = null;
      host?.querySelector<HTMLElement>(`[data-about="${open}"] button`)?.focus();
    }
    if (moreOpen) { moreOpen = false; confirmingClear = false; host?.querySelector<HTMLElement>('[data-more] > button')?.focus(); }
  }

  const single = $derived(rows[Math.min(rowAt, rows.length - 1)]);
  const peopleOf = (value: unknown) => Number(value) || 0;
  const peopleWords = (value: unknown) => { const count = peopleOf(value); return `${count} ${count === 1 ? 'person' : 'people'} in scope`; };
</script>

<svelte:document onpointerdown={onDocumentDown} onkeydown={onDocumentKey} />

{#snippet mark(level: number, size: number)}
  <svg class="matrix-mark" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d={look(level).path} /></svg>
{/snippet}

<div class="matrix" bind:this={host} data-testid="matrix" data-view={view} style:--matrix-strip="{stripHeight}px" use:motion={{ role: 'options', type: question.type }}>
  <div class="matrix-top">
    <p class="matrix-how">{view === 'grid' ? 'Tap a box to rate it: Low, Medium, High, then clear.' : 'Choose Low, Medium or High for each criterion.'}</p>
    <div class="matrix-views" role="group" aria-label="How to rate">
      <button type="button" class="matrix-view" aria-pressed={view === 'grid'} onclick={() => choose('grid')}>All at once</button>
      <button type="button" class="matrix-view" aria-pressed={view === 'single'} onclick={() => choose('single')}>One at a time</button>
    </div>
    <div class="matrix-more" data-more>
      <button type="button" class="matrix-more-button" aria-label="More choices" aria-expanded={moreOpen} aria-controls="{uid}-more" onclick={() => { moreOpen = !moreOpen; confirmingClear = false; }}>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {#if moreOpen}
        <div class="matrix-more-panel" id="{uid}-more">
          {#if confirmingClear}
            <p>Clear every rating?</p>
            <button type="button" class="matrix-tool" onclick={clearAll}>Yes, clear all</button>
            <button type="button" class="matrix-tool" onclick={() => { confirmingClear = false; }}>Keep them</button>
          {:else}
            <button type="button" class="matrix-tool" disabled={rated === 0} onclick={() => { confirmingClear = true; }}>Clear all</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="matrix-strip" bind:clientHeight={stripHeight}>
    <p class="matrix-count" data-testid="matrix-count">{rated} of {total} rated</p>
    <div class="matrix-bar" aria-hidden="true"><span style:transform="scaleX({total ? rated / total : 0})"></span></div>
    <ul class="matrix-pills" aria-label="Your ratings so far">
      {#each [1, 2, 3] as level (level)}
        <li class="matrix-pill" data-testid="matrix-pill-{look(level).token}"><span class="matrix-chip" data-level={level}>{@render mark(level, 12)}</span><span>{look(level).name}</span> <b>{counts[level]}</b></li>
      {/each}
    </ul>
    <button type="button" class="matrix-next" disabled={left === 0} onclick={() => void goToEmpty()}>
      {#if left === 0}All rated{:else}Next empty box <span class="matrix-left">{left} left</span>{/if}
    </button>
    <p class="sr-only" role="status" aria-live="polite">{spoken}</p>
  </div>
  <p class="matrix-caption">Colour shows the rating, not good or bad.</p>

  {#if view === 'grid'}
    <div class="matrix-well" data-cramped={cramped || undefined}>
      <table class="matrix-grid" aria-labelledby={labelledby} style:--matrix-columns={criteria.length}>
        <colgroup>
          <col class="matrix-col-process" />
          <col class="matrix-col-people" />
          {#each criteria as criterion (criterion.id)}<col />{/each}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="matrix-corner">Sub-process</th>
            <th scope="col" class="matrix-people-head" title="People in scope"><span aria-hidden="true">People</span><span class="sr-only">People in scope</span></th>
            {#each criteria as criterion, c (criterion.id)}
              <th scope="col" class="matrix-head" data-about={criterion.hint ? criterion.id : undefined}>
                <span class="matrix-head-words">{criterion.label}</span>
                {#if criterion.hint}
                  <button type="button" class="matrix-info" aria-label={`About ${criterion.label}`} aria-expanded={about === criterion.id} aria-controls="{uid}-about-{c}" onclick={() => { about = about === criterion.id ? null : criterion.id; }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" /><path d="M10 9v5M10 6.2v.1" /></svg>
                  </button>
                  {#if about === criterion.id}
                    <div class="matrix-about" id="{uid}-about-{c}" role="note" data-testid="matrix-about" data-edge={c >= criteria.length - 2 ? 'end' : undefined}>
                      <p><b>{criterion.label}</b></p>
                      <p>{criterion.hint}</p>
                    </div>
                  {/if}
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row, r (row.id)}
            {@const done = rowDone(row.id)}
            <tr class="matrix-band" data-done={done || undefined} data-alt={r % 2 === 1 || undefined}>
              <th scope="row" class="matrix-row">
                <span class="matrix-row-name">
                  {#if done}<svg class="matrix-check" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" data-testid="matrix-row-done"><circle cx="10" cy="10" r="9" /><path d="M5.5 10.2l3 3 6-6.4" /></svg>{/if}
                  <span>{row.label}</span>{#if done}<span class="sr-only">, all rated</span>{/if}
                </span>
              </th>
              <td class="matrix-people">{peopleOf(row.value)}</td>
              {#each criteria as criterion, c (criterion.id)}
                {@const level = levelOf(row.id, criterion.id)}
                {@const first = firstEmpty?.rowId === row.id && firstEmpty?.criterionId === criterion.id}
                <td class="matrix-slot">
                  <button
                    type="button"
                    class="matrix-cell"
                    data-level={level ?? 0}
                    data-cell="{r}-{c}"
                    tabindex={r === focusRow && c === focusColumn ? 0 : -1}
                    aria-label={cellName(row.label, criterion.label, level)}
                    aria-describedby={first ? `${uid}-teach` : undefined}
                    onfocus={() => { focusRow = r; focusColumn = c; }}
                    onkeydown={(event) => onCellKey(event, r, c)}
                    onclick={() => set(row.id, criterion.id, cycle(level))}
                  >
                    {#if level}
                      {@render mark(level, 12)}<span class="matrix-letter">{look(level).letter}</span>
                    {:else}
                      <svg class="matrix-plus" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                    {/if}
                  </button>
                  {#if first}<p class="matrix-teach" id="{uid}-teach" data-testid="matrix-teach">Tap to rate.</p>{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if single}
    <div class="matrix-single">
      <p class="matrix-where">Sub-process {Math.min(rowAt, rows.length - 1) + 1} of {rows.length}</p>
      <h3 class="matrix-name">{single.label}</h3>
      <p class="matrix-people-line">{peopleWords(single.value)}</p>
      <div class="matrix-dots" aria-hidden="true">
        {#each rows as row, r (row.id)}<span class="matrix-dot" data-done={rowDone(row.id) || undefined} data-here={r === rowAt || undefined}></span>{/each}
      </div>
      {#each criteria as criterion, c (criterion.id)}
        {@const level = levelOf(single.id, criterion.id)}
        <div class="matrix-criterion" role="group" aria-label={criterion.label} data-segments={c}>
          <p class="matrix-label">{criterion.label}</p>
          {#if criterion.hint}<p class="matrix-hint">{criterion.hint}</p>{/if}
          <div class="matrix-segments">
            {#each [1, 2, 3] as choice (choice)}
              <button type="button" class="matrix-segment" data-level={level === choice ? choice : 0} aria-pressed={level === choice} onclick={() => set(single.id, criterion.id, level === choice ? undefined : choice)}>{@render mark(choice, 12)}{look(choice).name}</button>
            {/each}
          </div>
        </div>
      {/each}
      <div class="matrix-steps">
        <PillButton variant="secondary" disabled={rowAt === 0} onclick={() => { rowAt -= 1; }}>Previous</PillButton>
        {#if rowAt < rows.length - 1}<PillButton variant="secondary" onclick={() => { rowAt += 1; }}>Next</PillButton>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* A white well on the client's plate: the three level colours read the same on every client's colour (styles/aop-level-tokens.css). */
  .matrix {
    --matrix-wash: color-mix(in srgb, var(--aop-well-ink) 4%, var(--aop-well));
    --matrix-done: color-mix(in srgb, var(--aop-well-ink) 9%, var(--aop-well));
    --matrix-rule: color-mix(in srgb, var(--aop-well-ink) 14%, var(--aop-well));
    display: grid;
    gap: 8px;
    margin-top: 13px;
    padding: 8px;
    color: var(--aop-well-ink);
    font: var(--fw-regular) var(--fs-small) / 1.35 var(--font-sans);
    background: var(--aop-well);
    border-radius: 13px;
  }

  .matrix p {
    margin: 0;
  }

  .matrix-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 13px;
    align-items: center;
  }

  .matrix-how {
    flex: 1 1 18rem;
  }

  .matrix-views {
    display: inline-flex;
    padding: 2px;
    background: var(--matrix-wash);
    border: 1px solid var(--matrix-rule);
    border-radius: 10px;
  }

  .matrix-view,
  .matrix-tool,
  .matrix-segment,
  .matrix-next {
    min-height: 44px;
    padding: 0 13px;
    color: var(--aop-well-ink);
    font: inherit;
    font-weight: var(--fw-semibold);
    background: var(--aop-well);
    border: 1px solid var(--aop-empty-edge);
    border-radius: 8px;
    cursor: pointer;
  }

  .matrix-view {
    background: none;
    border-color: transparent;
  }

  .matrix-view[aria-pressed='true'] {
    color: var(--aop-well);
    background: var(--aop-well-ink);
  }

  .matrix-tool:disabled,
  .matrix-next:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .matrix-more {
    position: relative;
  }

  .matrix-more-button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    color: var(--aop-well-ink);
    background: none;
    border: 1px solid var(--matrix-rule);
    border-radius: 8px;
    cursor: pointer;
  }

  .matrix-more-button svg {
    fill: currentColor;
  }

  .matrix-more-panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 5;
    display: grid;
    gap: 8px;
    width: max-content;
    max-width: min(18rem, 80vw);
    padding: 8px;
    background: var(--aop-well);
    border: 1px solid var(--aop-empty-edge);
    border-radius: 10px;
  }

  /* The one row that stays on screen while the page scrolls. */
  .matrix-strip {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 13px;
    align-items: center;
    padding: 8px 0;
    background: var(--aop-well);
  }

  .matrix-count {
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .matrix-bar {
    flex: 1 1 8rem;
    height: 8px;
    overflow: hidden;
    background: var(--matrix-rule);
    border-radius: 4px;
  }

  .matrix-bar span {
    display: block;
    height: 100%;
    background: var(--aop-well-ink);
    transform-origin: left;
    transition: transform var(--motion-duration-cell) var(--motion-ease-enter);
  }

  .matrix-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .matrix-pill {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    min-height: 32px;
    padding: 0 10px 0 4px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    border: 1px solid var(--matrix-rule);
    border-radius: 16px;
  }

  /* The pill's coloured chip is the legend: the box's colour, edge and shape; its words stay in ink on the well. */
  .matrix-chip {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 12px;
  }

  .matrix-next {
    margin-left: auto;
  }

  .matrix-left {
    font-weight: var(--fw-regular);
  }

  .matrix-caption {
    color: var(--aop-well-ink);
  }

  /* The page scrolls once: the grid has no scroll of its own, unless a guest chose it on a screen too narrow for its columns. */
  .matrix-well[data-cramped] {
    overflow-x: auto;
  }

  .matrix-grid {
    width: 100%;
    min-width: calc(112px + 56px + var(--matrix-columns) * 96px);
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  .matrix-col-process {
    width: clamp(112px, 24%, 300px);
  }

  .matrix-col-people {
    width: 64px;
  }

  .matrix-corner,
  .matrix-people-head,
  .matrix-head {
    position: sticky;
    top: var(--matrix-strip, 0px);
    z-index: 2;
    padding: 8px 4px;
    font-weight: var(--fw-bold);
    text-align: left;
    vertical-align: bottom;
    background: var(--aop-well);
    border-bottom: 2px solid var(--aop-well-ink);
  }

  /* A heading is shown whole: words wrap between words, never inside one. */
  .matrix-head {
    hyphens: manual;
    overflow-wrap: normal;
    word-break: normal;
  }

  .matrix-people-head,
  .matrix-people {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .matrix-head-words {
    margin-right: 2px;
  }

  .matrix-info {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -12px -8px -12px -10px;
    vertical-align: middle;
    color: var(--aop-well-ink);
    background: none;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
  }

  .matrix-info svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .matrix-about {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 4;
    display: grid;
    gap: 4px;
    width: min(16rem, 70vw);
    padding: 10px 13px;
    font-weight: var(--fw-regular);
    text-align: left;
    background: var(--aop-well);
    border: 1px solid var(--aop-well-ink);
    border-radius: 10px;
  }

  .matrix-about[data-edge='end'] {
    right: 0;
    left: auto;
  }

  .matrix-band > * {
    border-block: 1px solid transparent;
  }

  .matrix-band[data-alt] > * {
    background: var(--matrix-wash);
  }

  .matrix-band[data-done] > * {
    background: var(--matrix-done);
  }

  /* The row under the finger or the keyboard is drawn round, so the eye keeps its place. */
  .matrix-band:is(:hover, :focus-within) > * {
    border-block-color: var(--aop-well-ink);
  }

  .matrix-row {
    padding: 4px 8px 4px 4px;
    font-weight: var(--fw-semibold);
    text-align: left;
    overflow-wrap: anywhere;
  }

  .matrix-row-name {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .matrix-check {
    flex: none;
    fill: var(--aop-well-ink);
    stroke: var(--aop-well);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .matrix-check circle {
    stroke: none;
  }

  .matrix-people {
    padding: 4px 13px 4px 4px;
  }

  .matrix-slot {
    position: relative;
    height: 52px;
    padding: 2px;
  }

  .matrix-cell {
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-width: 48px;
    height: 100%;
    min-height: 48px;
    scroll-margin-block: calc(var(--matrix-strip, 0px) + 72px) 96px;
    color: var(--aop-well-ink);
    font: inherit;
    background: var(--aop-well);
    border: 1.5px dashed var(--aop-empty-edge);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color var(--motion-duration-cell) var(--motion-ease-standard);
  }

  .matrix-cell:hover {
    border-color: var(--aop-well-ink);
  }

  .matrix-plus {
    fill: none;
    stroke: var(--aop-empty-edge);
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .matrix-letter {
    font-size: var(--aop-letter-size);
    font-weight: var(--aop-letter-weight);
    line-height: 1;
  }

  .matrix-mark {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  [data-level='1']:is(.matrix-cell, .matrix-chip, .matrix-segment) {
    color: var(--aop-on-low);
    background: var(--aop-low);
    border: 2px solid var(--aop-low-edge);
  }

  [data-level='2']:is(.matrix-cell, .matrix-chip, .matrix-segment) {
    color: var(--aop-on-medium);
    background: var(--aop-medium);
    border: 2px solid var(--aop-medium-edge);
  }

  [data-level='3']:is(.matrix-cell, .matrix-chip, .matrix-segment) {
    color: var(--aop-on-high);
    background: var(--aop-high);
    border: 2px solid var(--aop-high-edge);
  }

  .matrix-teach {
    position: absolute;
    top: calc(100% - 2px);
    left: 50%;
    z-index: 2;
    width: max-content;
    max-width: 14rem;
    padding: 6px 10px;
    color: var(--aop-well);
    font-weight: var(--fw-semibold);
    background: var(--aop-well-ink);
    border-radius: 8px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .matrix-single {
    display: grid;
    gap: 13px;
  }

  .matrix-name {
    margin: 0;
    font: var(--fw-bold) var(--fs-question) / 1.3 var(--font-sans);
    overflow-wrap: anywhere;
  }

  .matrix-dots {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .matrix-dot {
    width: 10px;
    height: 10px;
    border: 1px solid var(--aop-well-ink);
    border-radius: 50%;
  }

  .matrix-dot[data-done] {
    background: var(--aop-well-ink);
  }

  .matrix-dot[data-here] {
    outline: 2px solid var(--aop-well-ink);
    outline-offset: 2px;
  }

  .matrix-criterion {
    display: grid;
    gap: 4px;
  }

  .matrix-label {
    font-weight: var(--fw-semibold);
  }

  .matrix-segments {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .matrix-segment {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    min-height: 56px;
    font-size: var(--aop-letter-size);
    font-weight: var(--aop-letter-weight);
    transition: background-color var(--motion-duration-cell) var(--motion-ease-standard);
  }

  .matrix-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
  }

  @media (prefers-reduced-motion: reduce) {
    .matrix-cell,
    .matrix-segment,
    .matrix-bar span { transition: none; }
  }

  @media (forced-colors: active) {
    .matrix-cell,
    .matrix-chip,
    .matrix-segment { forced-color-adjust: none; }
  }
</style>
