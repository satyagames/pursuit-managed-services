<script module lang="ts">
  // Which view this visit last chose, in memory only (Prompt 23): a new page starts from the width again.
  let chosenView: 'grid' | 'single' | null = null;
  // The first-box bubble has gone for this visit (Prompt 35): after the first rating it does not come back until the page is opened again.
  let taught = false;
  // The milestones each question has said this visit (Prompt 35): each is said once, and a reload starts from the ratings it opens with.
  const milestonesShown = new Map<string, Set<string>>();
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { cellsLeft, cycle, decodeAnswer, encodeAnswer, nextEmpty, type Grid } from '../lib/participant/aop-answer.js';
  import { LEVEL_LOOK } from '../lib/participant/aop-levels.js';
  import { ADVANCE_MS, HOLD_MS, UNDO_MS, advancesAfter, clearedOf, defaultView, gridWidthFor, levelCounts, restoreInto, rowIsDone, setCell, type Cleared } from '../lib/participant/aop-view.js';
  import { flyOff, motion, motionLevel, playEffect, playWave } from '../lib/motion/motion.js';
  import { milestonesCrossed } from '../lib/motion/aop-motion-plan.js';
  import { ENTRANCE_BUDGET, TOKENS } from '../lib/motion/motion-plan.js';
  import { focusHeading } from '../lib/common/focus.js';
  import type { Question } from '../lib/participant/pager-logic.js';
  import '../styles/aop-level-tokens.css';

  // An Art of Possibility question (Prompt 23, rebuilt in Prompt 35): a guest rates every sub-process against every criterion. Two views of one answer, All at once
  // and One at a time; the ratings are the pager's draft, as the stored answer's list of strings (lib/participant/aop-answer.js), so a reload, Send and Preview all
  // treat them as any other answer. The ratings are this component's own state, changed one box at a time (lib/participant/aop-view.js), and every change is
  // handed up encoded, exactly as Prompt 34 stored it. Three fixed colours on a white well (styles/aop-level-tokens.css), and every box also has its shape and
  // its letter: never colour alone. A tap takes the next level; a press held 650 ms (the ring fills) opens the level menu, as Enter, the menu key or a
  // right-click do; a clear offers Undo for 8 seconds.
  let { question, draft, labelledby, onchange }: {
    question: Question;
    draft: string[] | undefined;
    labelledby: string;
    onchange: (answer: string[]) => void;
  } = $props();

  const KEYS: Record<string, number> = { l: 1, m: 2, h: 3 };
  /** The level menu's rows: Low, Medium, High, and Clear (0). */
  const CHOICES = [1, 2, 3, 0];
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
  /** The box whose level menu is open, and where it opens (above the box when there is no room below; from the right on the last columns). */
  let menuAt = $state<{ r: number; c: number } | null>(null);
  let menuAbove = $state(false);
  let menuEnd = $state(false);
  /** The box being pressed (its ring is filling), as "row-column". */
  let holding = $state<string | null>(null);
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let holdFrom = { x: 0, y: 0 };
  let pressed = false;
  /** A press that opened the menu: the click its release makes is not also a tap. */
  let swallowClick = false;
  /** What the last clear took away, while "Cleared. Undo" shows. */
  let undo = $state<Cleared[] | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;
  /** One at a time: a finished sub-process is showing its check before the next one comes (Previous stops it). */
  let advancing = $state(false);
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let cardHeading = $state<HTMLElement>();
  // The effects' few fixed elements (Prompt 35): one ripple and one sheen for the whole grid, the bar's glow and check, and a milestone's words.
  let well = $state<HTMLElement>();
  let ripple = $state<HTMLElement>();
  let sheen = $state<HTMLElement>();
  let glow = $state<HTMLElement>();
  let barCheck = $state<Element>();
  let milestoneLabel = $state<HTMLElement>();
  let milestone = $state<string | null>(null);
  let milestoneTimer: ReturnType<typeof setTimeout> | undefined;
  /** The first empty box's one swell after the screen comes in: it stops when the bubble goes. */
  let firstPulse: Animation | null = null;
  /** Clear all or its Undo is changing many boxes at once: their colour change is not a fade, so the change moves no more than the cap allows. */
  let bulk = $state(false);
  let spoken = $state('');
  let spokenAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    const fit = () => { cramped = window.innerWidth < gridWidthFor(criteria.length); };
    if (!chosenView) view = defaultView({ width: window.innerWidth, height: window.innerHeight, criteria: criteria.length });
    fit();
    window.addEventListener('resize', fit, { passive: true });
    if (!milestonesShown.has(question.id)) {
      const shown = new Set<string>();
      milestonesCrossed(0, rated, total, shown, { quietly: true });
      milestonesShown.set(question.id, shown);
    }
    void tick().then(() => { if (teach) firstPulse = playEffect(host?.querySelector(`[aria-describedby="${uid}-teach"]`), 'pulse', { delay: ENTRANCE_BUDGET }); });
    return () => { clearTimeout(timer); clearTimeout(holdTimer); clearTimeout(undoTimer); clearTimeout(advanceTimer); clearTimeout(milestoneTimer); window.removeEventListener('resize', fit); };
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

  function stopTeaching() {
    if (teach) { teach = false; taught = true; firstPulse?.cancel(); }
  }

  function set(rowId: string, criterionId: string, level: number | undefined, point?: { x: number; y: number }) {
    const cleared = level === undefined ? clearedOf(cells, shape, [{ rowId, criterionId }]) : [];
    const before = { rated, counts: { ...counts }, rowDone: rowDone(rowId) };
    setCell(cells, rowId, criterionId, level);
    if (level !== undefined) stopTeaching();
    handUp();
    offerUndo(cleared);
    void react(rowId, criterionId, level, before, point);
  }

  /** "Cleared. Undo" for 8 seconds after a clear: one box or all of them. */
  function offerUndo(cleared: Cleared[]) {
    if (!cleared.length) return;
    clearTimeout(undoTimer);
    undo = cleared;
    undoTimer = setTimeout(() => { undo = null; }, UNDO_MS);
  }

  /** Many boxes change in one go: for the next two frames none of them fades its colour. */
  function inBulk() {
    bulk = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { bulk = false; }));
  }

  function undoClear() {
    if (!undo) return;
    clearTimeout(undoTimer);
    if (undo.length > 1) inBulk();
    restoreInto(cells, undo);
    undo = null;
    handUp();
  }

  const cellAt = (r: number, c: number) => host?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`);

  /** The level menu of a box, anchored to it: it flips above when there is no room below. Focus goes to the box's own level (or Low). */
  async function openMenu(r: number, c: number) {
    stopTeaching();
    const rect = cellAt(r, c)?.getBoundingClientRect();
    const room = 4 * 48 + 24;
    menuAbove = rect ? rect.bottom + room > window.innerHeight && rect.top - room > 0 : false;
    menuEnd = c >= criteria.length - 2;
    focusRow = r;
    focusColumn = c;
    menuAt = { r, c };
    await tick();
    const level = levelOf(rows[r].id, criteria[c].id) ?? 1;
    host?.querySelector<HTMLElement>(`[data-menu] [data-choice="${level}"]`)?.focus();
    playEffect(host?.querySelector('[data-menu]'), 'spring');
  }

  function closeMenu(refocus: boolean) {
    const at = menuAt;
    menuAt = null;
    if (refocus && at) void focusCell(at.r, at.c);
  }

  function pick(choice: number) {
    if (!menuAt) return;
    const { r, c } = menuAt;
    set(rows[r].id, criteria[c].id, choice || undefined);
    closeMenu(true);
  }

  function onMenuKey(event: KeyboardEvent) {
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (event.key in to) {
      event.preventDefault();
      items[(to[event.key] + items.length) % items.length]?.focus();
      return;
    }
    const level = KEYS[event.key.toLowerCase()];
    if (level || event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); pick(level ?? 0); }
  }

  /** Focus leaving the menu (Tab, a tap elsewhere) closes it: it is never a trap. */
  function onMenuOut(event: FocusEvent) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) closeMenu(false);
  }

  // ---- Press and hold: the ring fills for HOLD_MS, then the menu opens; a move of the finger, or letting go sooner, is a tap. ----
  function onPress(event: PointerEvent, r: number, c: number) {
    swallowClick = false;
    pressed = true;
    if (event.button !== 0) return;
    holdFrom = { x: event.clientX, y: event.clientY };
    holding = `${r}-${c}`;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holding = null; swallowClick = true; void openMenu(r, c); }, HOLD_MS);
  }

  function onPressMove(event: PointerEvent) {
    if (holding && Math.hypot(event.clientX - holdFrom.x, event.clientY - holdFrom.y) > 10) stopHold();
  }

  function stopHold() {
    clearTimeout(holdTimer);
    holding = null;
    pressed = false;
  }

  /** A long press on a touch screen, a right-click or the menu key: the same menu (a press already open does nothing more). */
  function onContextMenu(event: MouseEvent, r: number, c: number) {
    event.preventDefault();
    const fromPress = pressed;
    stopHold();
    if (menuAt) return;
    swallowClick = fromPress;
    void openMenu(r, c);
  }

  function onTap(event: MouseEvent, rowId: string, criterionId: string, level: number | undefined) {
    if (swallowClick) { swallowClick = false; return; }
    // (A key's click has no point: the ripple starts from the middle of the box.)
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const point = event.detail > 0 ? { x: event.clientX, y: event.clientY } : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    set(rowId, criterionId, cycle(level), point);
  }

  // ---- The effects (Prompt 35): each through lib/motion/motion.ts, at the page's one motion level; nothing here times or moves anything itself. ----
  type Before = { rated: number; counts: Record<number, number>; rowDone: boolean };

  async function react(rowId: string, criterionId: string, level: number | undefined, before: Before, point?: { x: number; y: number }) {
    await tick();
    const r = rows.findIndex((row) => row.id === rowId);
    const c = criteria.findIndex((criterion) => criterion.id === criterionId);
    if (level !== undefined) {
      const box = view === 'grid' ? cellAt(r, c) : host?.querySelector(`[data-segments="${c}"] [aria-pressed="true"]`);
      playEffect(box?.querySelector('.matrix-face') ?? box, 'pop');
      if (view === 'grid' && point && well) {
        const at = well.getBoundingClientRect();
        playEffect(ripple, 'ripple', { x: point.x - at.left, y: point.y - at.top });
      }
    }
    for (const each of [1, 2, 3]) if (counts[each] !== before.counts[each]) playEffect(host?.querySelector(`[data-pill="${each}"]`), 'bump');
    if (!before.rowDone && rowDone(rowId)) {
      playEffect(host?.querySelector(view === 'grid' ? `[data-row="${r}"] .matrix-check` : '[data-testid="matrix-card-done"] .matrix-check'), 'check');
      if (view === 'grid') sweep(r);
    }
    const shown = milestonesShown.get(question.id) ?? new Set<string>();
    milestonesShown.set(question.id, shown);
    const said = milestonesCrossed(before.rated, rated, total, shown);
    if (said) void showMilestone(said.words);
    if (total > 0 && before.rated < total && rated === total) allRated();
  }

  /** A finished row: one light sweeps across it (the grid's one sheen, placed on the row). */
  function sweep(r: number) {
    const row = host?.querySelector<HTMLElement>(`[data-row="${r}"]`);
    if (!row || !well || !sheen) return;
    const frame = well.getBoundingClientRect();
    const place = row.getBoundingClientRect();
    sheen.style.top = `${place.top - frame.top}px`;
    sheen.style.height = `${place.height}px`;
    playEffect(sheen, 'sheen', { width: frame.width });
  }

  /** A milestone: the bar glows once and its words rise from it, then go (with motion off they simply show for the same time). */
  async function showMilestone(words: string) {
    clearTimeout(milestoneTimer);
    milestone = words;
    await tick();
    playEffect(milestoneLabel, 'milestone');
    playEffect(glow, 'glow');
    milestoneTimer = setTimeout(() => { milestone = null; }, TOKENS.aop.milestone);
  }

  /** Every box rated: the wave runs through the grid and the bar's check arrives. */
  function allRated() {
    playEffect(barCheck, 'check');
    if (view !== 'grid' || !host) return;
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-cell]')].map((node) => {
      const [r, c] = (node.dataset.cell ?? '0-0').split('-').map(Number);
      return { node, r, c };
    });
    playWave(boxes, rows.length, criteria.length);
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
    if (event.key === 'Enter' || event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      void openMenu(row, column);
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
    if (view === 'grid') { await focusCell(row, column); playEffect(cellAt(row, column), 'pulse'); return; }
    rowAt = row;
    focusColumn = column;
    await tick();
    host?.querySelector<HTMLElement>(`[data-segments="${column}"] button`)?.focus();
  }

  function clearAll() {
    confirmingClear = false;
    moreOpen = false;
    const cleared = clearedOf(cells, shape);
    // The rated boxes fly off (copies, at most what the cap allows) as the ratings go.
    if (view === 'grid') flyOff([...(host?.querySelectorAll<HTMLElement>('.matrix-cell:not([data-level="0"])') ?? [])]);
    inBulk();
    cells = {};
    handUp();
    offerUndo(cleared);
  }

  /** A note or the menu closes on Escape and on a tap anywhere else; a tap on its own button is that button's to handle. */
  function onDocumentDown(event: PointerEvent) {
    const target = event.target as Element | null;
    if (about !== null && !target?.closest('[data-about]')) about = null;
    if (moreOpen && !target?.closest('[data-more]')) { moreOpen = false; confirmingClear = false; }
    if (menuAt && !target?.closest('[data-menu]')) closeMenu(false);
  }
  function onDocumentKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (menuAt) { closeMenu(true); return; }
    if (about !== null) {
      const open = about;
      about = null;
      host?.querySelector<HTMLElement>(`[data-about="${open}"] button`)?.focus();
    }
    if (moreOpen) { moreOpen = false; confirmingClear = false; host?.querySelector<HTMLElement>('[data-more] > button')?.focus(); }
  }

  const single = $derived(rows[Math.min(rowAt, rows.length - 1)]);

  // ---- One at a time: a card per sub-process; after its last box it shows a check and moves on (ADVANCE_MS), unless motion is off. ----
  function rateSingle(rowId: string, criterionId: string, level: number | undefined) {
    const wasDone = rowDone(rowId);
    set(rowId, criterionId, level);
    if (!advancesAfter({ wasDone, isDone: rowDone(rowId), at: rowAt, count: rows.length, level: motionLevel() })) return;
    clearTimeout(advanceTimer);
    advancing = true;
    advanceTimer = setTimeout(() => { advancing = false; void showCard(rowAt + 1); }, ADVANCE_MS);
  }

  function stopAdvance() {
    clearTimeout(advanceTimer);
    advancing = false;
  }

  async function showCard(at: number) {
    stopAdvance();
    rowAt = Math.min(rows.length - 1, Math.max(0, at));
    await tick();
    focusHeading(cardHeading);
  }

  /** Previous: while the card is about to move on, it only stays; otherwise the sub-process before. */
  function previous() {
    if (advancing) { stopAdvance(); return; }
    void showCard(rowAt - 1);
  }
  const peopleOf = (value: unknown) => Number(value) || 0;
  const peopleWords = (value: unknown) => { const count = peopleOf(value); return `${count} ${count === 1 ? 'person' : 'people'} in scope`; };
</script>

<svelte:document onpointerdown={onDocumentDown} onkeydown={onDocumentKey} />

{#snippet mark(level: number, size: number)}
  <svg class="matrix-mark" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d={look(level).path} /></svg>
{/snippet}

<div class="matrix" bind:this={host} data-testid="matrix" data-view={view} style:--matrix-strip="{stripHeight}px" use:motion={{ role: 'options', type: question.type }}>
  <div class="matrix-top">
    <p class="matrix-how">{view === 'grid' ? 'Tap a box to rate it. Press and hold for choices.' : 'Choose Low, Medium or High for each criterion.'}</p>
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

  <div class="matrix-strip" data-pinned={view === 'grid' || undefined} bind:clientHeight={stripHeight}>
    <p class="matrix-count" data-testid="matrix-count">{rated} of {total} rated</p>
    <div class="matrix-line">
      <div class="matrix-bar" aria-hidden="true"><span style:transform="scaleX({total ? rated / total : 0})"></span></div>
      {#if left === 0}<svg class="matrix-bar-check" bind:this={barCheck} width="22" height="22" viewBox="0 0 20 20" aria-hidden="true" data-testid="matrix-bar-check"><circle cx="10" cy="10" r="9" /><path d="M5.5 10.2l3 3 6-6.4" /></svg>{/if}
      <span class="matrix-glow" bind:this={glow} aria-hidden="true"></span>
      {#if milestone}<p class="matrix-milestone" bind:this={milestoneLabel} role="status" data-testid="matrix-milestone">{milestone}</p>{/if}
    </div>
    <ul class="matrix-pills" aria-label="Your ratings so far">
      {#each [1, 2, 3] as level (level)}
        <li class="matrix-pill" data-pill={level} data-testid="matrix-pill-{look(level).token}"><span class="matrix-chip" data-level={level}>{@render mark(level, 12)}</span><span>{look(level).name}</span> <b>{counts[level]}</b></li>
      {/each}
    </ul>
    <button type="button" class="matrix-next" disabled={left === 0} onclick={() => void goToEmpty()}>
      {#if left === 0}All rated{:else}Next empty box <span class="matrix-left">{left} left</span>{/if}
    </button>
    {#if undo}
      <div class="matrix-undo" role="status" data-testid="matrix-undo">
        <span>Cleared.</span>
        <button type="button" class="matrix-tool" onclick={undoClear}>Undo</button>
      </div>
    {/if}
    <p class="sr-only" role="status" aria-live="polite">{spoken}</p>
  </div>
  <p class="matrix-caption">Colour shows the rating, not good or bad.</p>

  {#if view === 'grid'}
    <div class="matrix-well" data-cramped={cramped || undefined} data-bulk={bulk || undefined} bind:this={well}>
      <span class="matrix-ripple" bind:this={ripple} aria-hidden="true"></span>
      <span class="matrix-sheen" bind:this={sheen} aria-hidden="true"></span>
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
            <tr class="matrix-band" data-row={r} data-done={done || undefined} data-alt={r % 2 === 1 || undefined}>
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
                    data-holding={holding === `${r}-${c}` || undefined}
                    tabindex={r === focusRow && c === focusColumn ? 0 : -1}
                    aria-label={cellName(row.label, criterion.label, level)}
                    aria-describedby={first ? `${uid}-teach` : undefined}
                    onfocus={() => { focusRow = r; focusColumn = c; }}
                    onkeydown={(event) => onCellKey(event, r, c)}
                    onclick={(event) => onTap(event, row.id, criterion.id, level)}
                    onpointerdown={(event) => onPress(event, r, c)}
                    onpointermove={onPressMove}
                    onpointerup={stopHold}
                    onpointercancel={stopHold}
                    onpointerleave={stopHold}
                    oncontextmenu={(event) => onContextMenu(event, r, c)}
                  >
                    {#if level}
                      <span class="matrix-face">{@render mark(level, 12)}<span class="matrix-letter">{look(level).letter}</span></span>
                    {:else}
                      <svg class="matrix-plus" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                    {/if}
                  </button>
                  {#if first}<p class="matrix-teach" id="{uid}-teach" data-testid="matrix-teach">Tap to rate. Press and hold for choices.</p>{/if}
                  {#if menuAt && menuAt.r === r && menuAt.c === c}
                    <div class="matrix-menu" role="menu" tabindex="-1" aria-label={`Rating for ${row.label}, ${criterion.label}`} data-menu data-above={menuAbove || undefined} data-end={menuEnd || undefined} onkeydown={onMenuKey} onfocusout={onMenuOut}>
                      {#each CHOICES as choice (choice)}
                        <button type="button" role="menuitemradio" class="matrix-choice" tabindex="-1" data-choice={choice} aria-checked={(level ?? 0) === choice} onclick={() => pick(choice)}>
                          {#if choice}<span class="matrix-chip" data-level={choice}>{@render mark(choice, 12)}<span class="matrix-chip-letter">{look(choice).letter}</span></span> {look(choice).name}{:else}<span class="matrix-chip matrix-chip--clear"></span> Clear{/if}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if single}
    <section class="matrix-card" data-testid="matrix-card" aria-labelledby="{uid}-card">
      <div class="matrix-card-top">
        <p class="matrix-where">Sub-process {Math.min(rowAt, rows.length - 1) + 1} of {rows.length}</p>
        <div class="matrix-dots" aria-hidden="true">
          {#each rows as row, r (row.id)}<span class="matrix-dot" data-done={rowDone(row.id) || undefined} data-here={r === rowAt || undefined}></span>{/each}
        </div>
      </div>
      <h3 class="matrix-name" id="{uid}-card" tabindex="-1" bind:this={cardHeading}>{single.label}</h3>
      <p class="matrix-people-line">{peopleOf(single.value)} {peopleOf(single.value) === 1 ? 'person' : 'people'}</p>
      {#each criteria as criterion, c (criterion.id)}
        {@const level = levelOf(single.id, criterion.id)}
        <div class="matrix-criterion" role="group" aria-label={criterion.label} data-segments={c}>
          <p class="matrix-label">{criterion.label}</p>
          {#if criterion.hint}<p class="matrix-hint">{criterion.hint}</p>{/if}
          <div class="matrix-segments">
            {#each [1, 2, 3] as choice (choice)}
              <button type="button" class="matrix-segment" data-level={level === choice ? choice : 0} aria-pressed={level === choice} onclick={() => rateSingle(single.id, criterion.id, level === choice ? undefined : choice)}>{@render mark(choice, 14)}{look(choice).name}</button>
            {/each}
          </div>
        </div>
      {/each}
      {#if rowDone(single.id)}
        <p class="matrix-card-done" data-testid="matrix-card-done">
          <svg class="matrix-check" width="24" height="24" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" /><path d="M5.5 10.2l3 3 6-6.4" /></svg>
          {advancing ? 'All rated. On to the next one.' : 'All rated.'}
        </p>
      {/if}
      <div class="matrix-steps">
        <!-- (The page's pill buttons are drawn for the client's colour; on the white well the card's own two are in the well's ink.) -->
        <button type="button" class="matrix-tool matrix-step" disabled={rowAt === 0 && !advancing} onclick={previous}>Previous</button>
        {#if rowAt < rows.length - 1}<button type="button" class="matrix-tool matrix-step matrix-step--next" onclick={() => void showCard(rowAt + 1)}>Next sub-process</button>{/if}
      </div>
    </section>
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
  .matrix-strip[data-pinned] {
    position: sticky;
  }

  .matrix-strip {
    position: relative;
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

  /* The bar, its glow at a milestone, its check when every box is rated, and a milestone's words above it. */
  .matrix-line {
    position: relative;
    display: flex;
    flex: 1 1 8rem;
    gap: 6px;
    align-items: center;
  }

  .matrix-glow {
    position: absolute;
    inset: -4px;
    border-radius: 8px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--aop-well-ink) 30%, transparent);
    opacity: 0;
    pointer-events: none;
  }

  .matrix-milestone {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 4;
    width: max-content;
    margin: 0 auto !important;
    padding: 4px 13px;
    color: var(--aop-well);
    font-weight: var(--fw-semibold);
    background: var(--aop-well-ink);
    border-radius: 14px;
    pointer-events: none;
  }

  .matrix-bar-check {
    flex: none;
    fill: var(--aop-well-ink);
    stroke: var(--aop-well);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .matrix-bar-check circle {
    stroke: none;
  }

  .matrix-bar {
    flex: 1 1 auto;
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
  .matrix-well {
    position: relative;
  }

  /* One ripple and one sheen for the whole grid: moved to where they are needed, never one element per tap. */
  .matrix-ripple {
    position: absolute;
    top: -40px;
    left: -40px;
    z-index: 1;
    width: 80px;
    height: 80px;
    background: radial-gradient(circle, var(--aop-well-ink) 0%, transparent 70%);
    border-radius: 50%;
    opacity: 0;
    pointer-events: none;
  }

  .matrix-sheen {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    width: 120px;
    height: 0;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.75), transparent);
    opacity: 0;
    pointer-events: none;
  }

  .matrix-well[data-bulk] .matrix-cell {
    transition: none;
  }

  .matrix-face {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }

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

  /* A press is not a text selection, a callout or a double-tap zoom. */
  .matrix-cell {
    position: relative;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
  }

  /* The hold: a ring closes in on the box over the hold's length (--motion-aop-hold), transform and opacity only; the menu opens as it lands. */
  .matrix-cell[data-holding]::after {
    position: absolute;
    inset: -6px;
    content: '';
    border: 3px solid var(--aop-well-ink);
    border-radius: 12px;
    pointer-events: none;
    animation: matrix-hold var(--motion-aop-hold) var(--motion-ease-standard) backwards;
  }

  @keyframes matrix-hold {
    from { opacity: 0; transform: scale(1.25); }
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

  .matrix-undo {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 0 0 13px;
    color: var(--aop-well);
    font-weight: var(--fw-semibold);
    background: var(--aop-well-ink);
    border-radius: 8px;
  }

  .matrix-undo .matrix-tool {
    color: var(--aop-well);
    background: none;
    border-color: var(--aop-well);
  }

  /* The level menu, anchored to its box: four 48 px rows, each with the box's colour, shape and letter in a chip and its word in ink. */
  .matrix-menu {
    position: absolute;
    top: calc(100% - 2px);
    left: 2px;
    z-index: 6;
    display: grid;
    gap: 2px;
    width: max-content;
    min-width: 11rem;
    padding: 6px;
    background: var(--aop-well);
    border: 1px solid var(--aop-well-ink);
    border-radius: 12px;
  }

  .matrix-menu {
    transform-origin: top left;
  }

  .matrix-menu[data-above] {
    top: auto;
    bottom: calc(100% - 2px);
    transform-origin: bottom left;
  }

  .matrix-menu[data-end] {
    right: 2px;
    left: auto;
    transform-origin: top right;
  }

  .matrix-menu[data-end][data-above] {
    transform-origin: bottom right;
  }

  .matrix-choice {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 48px;
    padding: 0 13px 0 6px;
    color: var(--aop-well-ink);
    font: inherit;
    font-weight: var(--fw-semibold);
    text-align: left;
    background: none;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
  }

  .matrix-choice:hover,
  .matrix-choice[aria-checked='true'] {
    background: var(--matrix-wash);
  }

  .matrix-choice[aria-checked='true'] {
    box-shadow: inset 0 0 0 2px var(--aop-well-ink);
  }

  .matrix-choice .matrix-chip {
    gap: 2px;
    width: 52px;
    height: 36px;
    grid-auto-flow: column;
    border-radius: 8px;
  }

  .matrix-chip-letter {
    font-size: var(--aop-letter-size);
    font-weight: var(--aop-letter-weight);
    line-height: 1;
  }

  .matrix-chip--clear {
    border: 1.5px dashed var(--aop-empty-edge);
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

  /* One at a time: a card, the sub-process's name large, each criterion's words shown, three big choices. */
  .matrix-card {
    display: grid;
    gap: 13px;
    padding: 13px;
    border: 1px solid var(--matrix-rule);
    border-radius: 13px;
  }

  .matrix-card-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 13px;
    align-items: center;
    justify-content: space-between;
  }

  .matrix-where {
    font-weight: var(--fw-semibold);
  }

  .matrix-people-line {
    margin-top: -8px !important;
  }

  .matrix-hint {
    color: var(--aop-well-ink);
  }

  .matrix-step {
    min-height: 48px;
    padding: 0 21px;
    border-radius: 24px;
  }

  .matrix-step--next {
    color: var(--aop-well);
    background: var(--aop-well-ink);
    border-color: var(--aop-well-ink);
  }

  .matrix-card-done {
    display: flex;
    gap: 8px;
    align-items: center;
    font-weight: var(--fw-semibold);
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
    padding: 0 4px;
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
