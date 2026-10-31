<script module lang="ts">
  // Which view this visit last chose, in memory only (Prompt 23): a new page starts from the width again.
  let chosenView: 'grid' | 'single' | null = null;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PillButton } from '../components/index.js';
  import { cellsLeft, cycle, decodeAnswer, encodeAnswer, nextEmpty, type Grid } from '../lib/participant/aop-answer.js';
  import { motion } from '../lib/motion/motion.js';
  import type { Question } from '../lib/participant/pager-logic.js';

  // An Art of the Possible question (Prompt 23, board 15): a guest rates every sub-process against every criterion. Two views of one answer, Grid and One at a time; the
  // ratings are the pager's draft, as the stored answer's list of strings (lib/participant/aop-answer.js), so a reload, Send and Preview all treat them as any other answer.
  // Colour is one ramp from the page's own plate tokens, and every box also says its letter: never colour alone. The people of a row are said "people in scope" (open question 4).
  let { question, draft, labelledby, onchange }: {
    question: Question;
    draft: string[] | undefined;
    labelledby: string;
    onchange: (answer: string[]) => void;
  } = $props();

  const NAMES: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
  const LETTERS: Record<number, string> = { 1: 'L', 2: 'M', 3: 'H' };
  const KEYS: Record<string, number> = { l: 1, m: 2, h: 3 };

  const rows = $derived(question.options);
  const criteria = $derived(question.criteria ?? []);
  const shape = $derived({ rows, criteria });
  const grid = $derived<Grid>(decodeAnswer(draft, shape).grid);
  const total = $derived(rows.length * criteria.length);
  const left = $derived(cellsLeft(grid, shape));
  const rated = $derived(total - left);

  let view = $state<'grid' | 'single'>(chosenView ?? 'grid');
  let rowAt = $state(0);
  /** The box the keyboard is on: the one tab stop of the grid. */
  let focusRow = $state(0);
  let focusColumn = $state(0);
  let host = $state<HTMLElement>();
  let hint = $state<string | null>(null);
  let confirmingClear = $state(false);
  let spoken = $state('');
  let spokenAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    if (!chosenView) view = window.matchMedia('(min-width: 700px)').matches ? 'grid' : 'single';
    return () => clearTimeout(timer);
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

  function set(rowId: string, criterionId: string, level: number | undefined) {
    const next: Grid = structuredClone($state.snapshot(grid));
    if (level === undefined) { delete next[rowId]?.[criterionId]; } else (next[rowId] ??= {})[criterionId] = level;
    onchange(encodeAnswer(next));
    say();
  }

  const levelOf = (rowId: string, criterionId: string) => grid[rowId]?.[criterionId];
  const cellName = (rowLabel: string, criterionLabel: string, level: number | undefined) => `${rowLabel}, ${criterionLabel}: ${level ? NAMES[level] : 'not rated'}`;

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

  /** Next empty box: the grid's button, or in One at a time that row's control. */
  async function goToEmpty() {
    const from = rows[view === 'grid' ? focusRow : rowAt] && criteria[focusColumn] ? { rowId: rows[view === 'grid' ? focusRow : rowAt].id, criterionId: criteria[focusColumn].id } : null;
    const box = nextEmpty(grid, shape, from);
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
    onchange([]);
    say();
  }

  const single = $derived(rows[Math.min(rowAt, rows.length - 1)]);
  const peopleWords = (value: unknown) => { const count = Number(value) || 0; return `${count} ${count === 1 ? 'person' : 'people'} in scope`; };
  const rowDone = (rowId: string) => criteria.every((criterion) => levelOf(rowId, criterion.id));
</script>

<div class="matrix" bind:this={host} data-testid="matrix" use:motion={{ role: 'options', type: question.type }}>
  <div class="matrix-top">
    <div class="matrix-views" role="group" aria-label="How to rate">
      <button type="button" class="matrix-view" aria-pressed={view === 'grid'} onclick={() => choose('grid')}>Grid</button>
      <button type="button" class="matrix-view" aria-pressed={view === 'single'} onclick={() => choose('single')}>One at a time</button>
    </div>
    <p class="matrix-legend"><span class="matrix-chip" data-level="1" aria-hidden="true">L</span> Low <span class="matrix-chip" data-level="2" aria-hidden="true">M</span> Medium <span class="matrix-chip" data-level="3" aria-hidden="true">H</span> High</p>
  </div>

  <div class="matrix-progress">
    <p class="matrix-count" data-testid="matrix-count">{rated} of {total} rated</p>
    <div class="matrix-bar" aria-hidden="true"><span style:width="{total ? (rated / total) * 100 : 0}%"></span></div>
    <div class="matrix-tools">
      <button type="button" class="matrix-tool" disabled={left === 0} onclick={() => void goToEmpty()}>Next empty box</button>
      {#if confirmingClear}
        <span class="matrix-ask">Clear every rating?</span>
        <button type="button" class="matrix-tool" onclick={clearAll}>Yes, clear all</button>
        <button type="button" class="matrix-tool" onclick={() => { confirmingClear = false; }}>Keep them</button>
      {:else}
        <button type="button" class="matrix-tool" disabled={rated === 0} onclick={() => { confirmingClear = true; }}>Clear all</button>
      {/if}
    </div>
    {#if left === 0}<p class="matrix-done" use:motion={{ role: 'meta' }}>All rated</p>{/if}
    <p class="sr-only" role="status" aria-live="polite">{spoken}</p>
  </div>

  {#if hint !== null}
    <div class="matrix-hint" role="note" data-testid="matrix-hint">
      <p>{hint}</p>
      <button type="button" class="matrix-tool" onclick={() => { hint = null; }}>Close</button>
    </div>
  {/if}

  {#if view === 'grid'}
    <div class="matrix-scroll">
      <table class="matrix-grid" aria-labelledby={labelledby}>
        <thead>
          <tr>
            <th scope="col" class="matrix-corner">Sub-process</th>
            {#each criteria as criterion (criterion.id)}
              <th scope="col" class="matrix-head">
                <span>{criterion.label}</span>
                {#if criterion.hint}<button type="button" class="matrix-info" aria-label={`About ${criterion.label}`} onclick={() => { hint = `${criterion.label}: ${criterion.hint}`; }}>i</button>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row, r (row.id)}
            <tr>
              <th scope="row" class="matrix-row"><span>{row.label}</span><span class="matrix-people">{peopleWords(row.value)}</span></th>
              {#each criteria as criterion, c (criterion.id)}
                {@const level = levelOf(row.id, criterion.id)}
                <td class="matrix-slot">
                  <button
                    type="button"
                    class="matrix-cell"
                    data-level={level ?? 0}
                    data-cell="{r}-{c}"
                    tabindex={r === focusRow && c === focusColumn ? 0 : -1}
                    aria-label={cellName(row.label, criterion.label, level)}
                    onfocus={() => { focusRow = r; focusColumn = c; }}
                    onkeydown={(event) => onCellKey(event, r, c)}
                    onclick={() => set(row.id, criterion.id, cycle(level))}
                  >{level ? LETTERS[level] : ''}</button>
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
      <p class="matrix-people">{peopleWords(single.value)}</p>
      <div class="matrix-dots" aria-hidden="true">
        {#each rows as row, r (row.id)}<span class="matrix-dot" data-done={rowDone(row.id) || undefined} data-here={r === rowAt || undefined}></span>{/each}
      </div>
      {#each criteria as criterion, c (criterion.id)}
        {@const level = levelOf(single.id, criterion.id)}
        <div class="matrix-criterion" role="group" aria-label={criterion.label} data-segments={c}>
          <p class="matrix-label">{criterion.label}{#if criterion.hint}<button type="button" class="matrix-info" aria-label={`About ${criterion.label}`} onclick={() => { hint = `${criterion.label}: ${criterion.hint}`; }}>i</button>{/if}</p>
          <div class="matrix-segments">
            {#each [1, 2, 3] as choice}
              <button type="button" class="matrix-segment" data-level={level === choice ? choice : 0} aria-pressed={level === choice} onclick={() => set(single.id, criterion.id, level === choice ? undefined : choice)}>{NAMES[choice]}</button>
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
  /* On the plate, so the ramp reads the same on any client's colour. Low, Medium and High are one ramp of the plate's own ink, and each box also says its letter. */
  .matrix {
    --matrix-low: color-mix(in srgb, var(--on-plate) 12%, var(--plate));
    --matrix-mid: color-mix(in srgb, var(--on-plate) 40%, var(--plate));
    --matrix-high: var(--on-plate);
    display: grid;
    gap: 13px;
    margin-top: 21px;
    padding: 13px;
    color: var(--on-plate);
    font: var(--fw-regular) var(--fs-body) / 1.35 var(--font-sans);
    background: var(--plate);
    border-radius: 13px;
  }

  .matrix p {
    margin: 0;
  }

  .matrix-top,
  .matrix-tools,
  .matrix-steps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .matrix-views {
    display: flex;
    gap: 8px;
  }

  .matrix-view,
  .matrix-tool,
  .matrix-segment {
    min-height: 44px;
    padding: 0 13px;
    color: var(--on-plate);
    font: inherit;
    font-weight: var(--fw-semibold);
    background: var(--plate);
    border: 1px solid var(--on-plate);
    border-radius: 8px;
    cursor: pointer;
  }

  .matrix-tool:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .matrix-view[aria-pressed='true'] {
    color: var(--plate);
    background: var(--on-plate);
  }

  .matrix-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .matrix-chip {
    display: inline-grid;
    place-items: center;
    width: 1.6em;
    height: 1.6em;
    font-weight: var(--fw-bold);
    border-radius: 4px;
  }

  .matrix-progress {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    gap: 8px;
    padding-bottom: 8px;
    background: var(--plate);
  }

  .matrix-count,
  .matrix-done {
    font-weight: var(--fw-semibold);
  }

  .matrix-bar {
    height: 8px;
    overflow: hidden;
    background: var(--matrix-low);
    border-radius: 4px;
  }

  .matrix-bar span {
    display: block;
    height: 100%;
    background: var(--on-plate);
    transition: width var(--motion-duration-cell) var(--motion-ease-standard);
  }

  .matrix-hint {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 8px 13px;
    background: var(--matrix-low);
    border-radius: 8px;
  }

  /* The rows scroll inside the grid and the criteria stay put; the first column has 38.2% of the width and the criteria share the rest. */
  .matrix-scroll {
    max-height: 62vh;
    overflow: auto;
  }

  .matrix-grid {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  .matrix-corner {
    width: 38.2%;
  }

  .matrix-corner,
  .matrix-head {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 8px 4px;
    font-size: var(--fs-small);
    font-weight: var(--fw-bold);
    text-align: left;
    vertical-align: bottom;
    overflow-wrap: break-word;
    hyphens: auto;
    background: var(--plate);
    border-bottom: 2px solid var(--on-plate);
  }

  .matrix-row {
    padding: 8px 8px 8px 0;
    font-weight: var(--fw-semibold);
    text-align: left;
    overflow-wrap: anywhere;
    border-bottom: 1px solid var(--matrix-low);
  }

  .matrix-row span {
    display: block;
  }

  .matrix-people {
    font-size: var(--fs-small);
    font-weight: var(--fw-regular);
  }

  .matrix-slot {
    height: 44px;
    padding: 2px;
    border-bottom: 1px solid var(--matrix-low);
  }

  .matrix-cell {
    display: block;
    width: 100%;
    min-width: 44px;
    height: 100%;
    min-height: 44px;
    color: var(--on-plate);
    font: inherit;
    font-weight: var(--fw-bold);
    background: var(--plate);
    border: 1px solid var(--on-plate);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color var(--motion-duration-cell) var(--motion-ease-standard);
  }

  [data-level='1'] {
    background: var(--matrix-low);
  }

  [data-level='2'] {
    background: var(--matrix-mid);
  }

  [data-level='3'] {
    color: var(--plate);
    background: var(--matrix-high);
  }

  .matrix-info {
    min-width: 44px;
    min-height: 44px;
    margin-left: 4px;
    color: var(--on-plate);
    font: inherit;
    font-style: italic;
    font-weight: var(--fw-bold);
    background: none;
    border: 0;
    cursor: pointer;
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
    border: 1px solid var(--on-plate);
    border-radius: 50%;
  }

  .matrix-dot[data-done] {
    background: var(--on-plate);
  }

  .matrix-dot[data-here] {
    outline: 2px solid var(--on-plate);
    outline-offset: 2px;
  }

  .matrix-criterion {
    display: grid;
    gap: 4px;
  }

  .matrix-label {
    display: flex;
    align-items: center;
    font-weight: var(--fw-semibold);
  }

  .matrix-segments {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .matrix-segment {
    min-height: 56px;
    transition: background-color var(--motion-duration-cell) var(--motion-ease-standard);
  }

  @media (prefers-reduced-motion: reduce) {
    .matrix-cell,
    .matrix-segment,
    .matrix-bar span { transition: none; }
  }
</style>
