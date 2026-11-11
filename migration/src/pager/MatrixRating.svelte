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
  import { cellsLeft, decodeAnswer, encodeAnswer, nextEmpty, type Grid } from '../lib/participant/aop-answer.js';
  import { LEVEL_LOOK } from '../lib/participant/aop-levels.js';
  import { ADVANCE_MS, GRID_MIN_WIDTH, advancesAfter, highestRated, highestSentence, defaultView, gridWidthFor, levelCounts, rowIsDone, setCell } from '../lib/participant/aop-view.js';
  import { MENU_CLOSED, headingParts, levelOfChoice, menuChoices, menuStep, placeMenu, type MenuEvent, type MenuState } from '../lib/participant/aop-menu.js';
  import { flyOff, motion, motionLevel, playEffect, playWave } from '../lib/motion/motion.js';
  import { milestonesCrossed, waveLength } from '../lib/motion/aop-motion-plan.js';
  import { aopAllRated, aopClearAll, aopMilestone, aopRate, aopRowDone } from '../lib/effects/effects.js';
  import { ENTRANCE_BUDGET, TOKENS } from '../lib/motion/motion-plan.js';
  import { focusHeading } from '../lib/common/focus.js';
  import type { Question } from '../lib/participant/pager-logic.js';
  import '../styles/aop-level-tokens.css';

  // An Art of Possibility question (Prompt 23, rebuilt in Prompt 35, its taps in Prompt 42): a guest rates every sub-process against every criterion. Two
  // views of one answer, All at once and One at a time; the ratings are the pager's draft, as the stored answer's list of strings
  // (lib/participant/aop-answer.js), so a reload, Send and Preview all treat them as any other answer. The ratings are this component's own state, changed
  // one box at a time (lib/participant/aop-view.js), and every change is handed up encoded, exactly as Prompt 34 stored it. Three fixed colours on a white
  // card (styles/aop-level-tokens.css), and every box and menu row also has its shape and its letter: never colour alone. A tap on a box opens its level
  // menu (lib/participant/aop-menu.js) and only a choice there rates it; Enter, Space and Down open the same menu, L, M and H rate, Delete clears.
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
  const heads = $derived(criteria.map((criterion) => headingParts(criterion.label)));

  const keyOf = (list: unknown) => (Array.isArray(list) ? list.join('\n') : '');
  const decoded = () => decodeAnswer(draft, { rows: question.options, criteria: question.criteria ?? [] }).grid;
  const draftKey = () => keyOf(draft);
  /** The guest's ratings. A box changes in place, so only it, its row and the strip are drawn again. */
  let cells = $state<Grid>(decoded());
  /** What this component last handed up: a draft that differs (a reload's, Clear all's) is read in again. */
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
  /** How far the headings had to be eased to keep each in two lines (0 none, 1 tighter letters, 2 a narrower first column, 3 wider columns, scrolled in the card). */
  let fit = $state(0);
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
  /** The level menu: the box it is open on (one at a time) and the page's scroll when it opened (lib/participant/aop-menu.js). */
  let menu = $state<MenuState>(MENU_CLOSED);
  const menuAt = $derived(menu.at);
  /** Where it opens: above the box when there is no room below, from the box's right edge near the end. */
  let menuAbove = $state(false);
  let menuEnd = $state(false);
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
  let glance = $state<HTMLElement>();
  /** The card shows once the wave has run (at once when the page opens complete, or with motion off), so the two never move together. */
  let glanceReady = $state(true);
  let glanceTimer: ReturnType<typeof setTimeout> | undefined;
  let milestoneTimer: ReturnType<typeof setTimeout> | undefined;
  /** The first empty box's one swell after the screen comes in: it stops when the bubble goes. */
  let firstPulse: Animation | null = null;
  /** Clear all is changing many boxes at once: their colour change is not a fade, so the change moves no more than the cap allows. */
  let bulk = $state(false);
  let spoken = $state('');
  let spokenAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Each criterion heading in two lines of whole words: ease the letters, then the first column, then (only where the grid scrolls inside its card) the columns. */
  async function fitHeadings() {
    if (view !== 'grid') return;
    fit = 0;
    await tick();
    // (A heading's line is 13 px at 1.25, so two lines are 32.5 px.)
    const tooTall = () => [...(host?.querySelectorAll<HTMLElement>('.matrix-head-words') ?? [])].some((node) => node.offsetHeight > 34);
    while (tooTall() && fit < 3) {
      fit += 1;
      await tick();
    }
  }

  onMount(() => {
    let frame = 0;
    const onResize = () => {
      cramped = window.innerWidth < gridWidthFor(criteria.length);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fitHeadings());
    };
    const onScroll = () => { if (menu.at) step({ type: 'scroll', scrollY: window.scrollY }); };
    if (!chosenView) view = defaultView({ width: window.innerWidth, height: window.innerHeight, criteria: criteria.length });
    cramped = window.innerWidth < gridWidthFor(criteria.length);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    void document.fonts?.ready.then(() => fitHeadings());
    void fitHeadings();
    if (!milestonesShown.has(question.id)) {
      const shown = new Set<string>();
      milestonesCrossed(0, rated, total, shown, { quietly: true });
      milestonesShown.set(question.id, shown);
    }
    void tick().then(() => { if (teach) firstPulse = playEffect(host?.querySelector(`[aria-describedby~="${uid}-teach"]`), 'pulse', { delay: ENTRANCE_BUDGET }); });
    return () => {
      clearTimeout(timer); clearTimeout(advanceTimer); clearTimeout(milestoneTimer); clearTimeout(glanceTimer); cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
  });

  function choose(next: 'grid' | 'single') {
    view = next;
    chosenView = next;
    closeMenu(false);
    void fitHeadings();
  }

  /** The progress, as a polite live region: at most one update a second, and the last one always arrives. */
  function say() {
    clearTimeout(timer);
    const wait = Math.max(0, spokenAt + 1000 - Date.now());
    timer = setTimeout(() => { spokenAt = Date.now(); spoken = left === 0 ? 'All done.' : `${rated} of ${total} done.`; }, wait);
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
    const before = { rated, counts: { ...counts }, rowDone: rowDone(rowId) };
    setCell(cells, rowId, criterionId, level);
    if (level !== undefined) stopTeaching();
    aopRate(level);
    handUp();
    void react(rowId, criterionId, level, before, point);
  }

  /** Many boxes change in one go: for the next two frames none of them fades its colour. */
  function inBulk() {
    bulk = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { bulk = false; }));
  }

  const cellAt = (r: number, c: number) => host?.querySelector<HTMLElement>(`[data-cell="${r}-${c}"]`);

  // ---- The level menu (Prompt 42): a tap on a box opens it there, a second tap closes it, and only a choice in it rates the box. ----
  /** The menu after an event; when it closes, the keyboard goes back to its box (without scrolling the page). */
  function step(event: MenuEvent, refocus = true) {
    const was = menu.at;
    const next = menuStep(menu, event);
    if (next === menu) return;
    menu = next;
    if (next.at) void placeAndFocus(next.at);
    else if (was && refocus) void focusCell(was.r, was.c, true);
  }

  /** The menu is drawn under its box, then measured and moved above it or to its right edge before the frame is painted; focus goes to the box's level. */
  async function placeAndFocus(at: { r: number; c: number }) {
    focusRow = at.r;
    focusColumn = at.c;
    menuAbove = menuEnd = false;
    await tick();
    const panel = host?.querySelector<HTMLElement>('[data-menu]');
    const box = cellAt(at.r, at.c)?.getBoundingClientRect();
    if (!panel || !box || !host) return;
    const size = panel.getBoundingClientRect();
    const place = placeMenu({ box, menu: { width: size.width, height: size.height }, card: host.getBoundingClientRect(), viewport: { width: window.innerWidth, height: window.innerHeight }, last: at.c >= criteria.length - 2 });
    menuAbove = place.above;
    menuEnd = place.end;
    const level = levelOf(rows[at.r].id, criteria[at.c].id) ?? 1;
    panel.querySelector<HTMLElement>(`[data-choice="${level}"]`)?.focus({ preventScroll: true });
    playEffect(panel, 'spring');
  }

  function closeMenu(refocus: boolean) {
    step({ type: 'leave' }, refocus);
  }

  function pick(choice: number) {
    const at = menu.at;
    if (!at) return;
    // (The ripple grows from the middle of the box the choice is for.)
    const box = cellAt(at.r, at.c)!.getBoundingClientRect();
    set(rows[at.r].id, criteria[at.c].id, levelOfChoice(choice), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    step({ type: 'pick' });
  }

  /** A tap or a click on a box opens its menu, or closes it when it is open there, or moves it there from another box: it never rates the box by itself. */
  function onBoxClick(r: number, c: number) {
    step({ type: 'tap', at: { r, c }, scrollY: window.scrollY });
  }

  /** A right-click, a touch screen's long press, the menu key or Shift+F10: the same menu, opened (never closed) and never a rating. */
  function onBoxContextMenu(event: MouseEvent, r: number, c: number) {
    event.preventDefault();
    step({ type: 'open', at: { r, c }, scrollY: window.scrollY });
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

  /** Focus leaving the menu (Tab, a tap elsewhere) closes it: it is never a trap. Focus going to a box is that box's tap, which closes it or moves it. */
  function onMenuOut(event: FocusEvent) {
    const to = event.relatedTarget as Element | null;
    if (!(event.currentTarget as HTMLElement).contains(to) && !to?.closest('[data-cell]')) closeMenu(false);
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
    const everyBox = total > 0 && before.rated < total && rated === total;
    if (!before.rowDone && rowDone(rowId)) {
      if (!everyBox) aopRowDone();
      playEffect(host?.querySelector(view === 'grid' ? `[data-row="${r}"] .matrix-check` : '[data-testid="matrix-card-done"] .matrix-check'), 'check');
      if (view === 'grid') sweep(r);
    }
    const shown = milestonesShown.get(question.id) ?? new Set<string>();
    milestonesShown.set(question.id, shown);
    const said = milestonesCrossed(before.rated, rated, total, shown);
    if (said) {
      if (!everyBox) aopMilestone(said.key as 'quarter' | 'half' | 'nearly');
      void showMilestone(said.words);
    }
    if (everyBox) allRated();
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
    aopAllRated(host?.querySelector('.matrix-bar'));
    playEffect(barCheck, 'check');
    const wait = motionLevel() === 'none' ? 0 : waveLength(rows.length, criteria.length);
    glanceReady = wait === 0;
    clearTimeout(glanceTimer);
    glanceTimer = setTimeout(() => { glanceReady = true; void tick().then(() => playEffect(glance, 'rise')); }, wait);
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

  async function focusCell(row: number, column: number, still = false) {
    focusRow = row;
    focusColumn = column;
    await tick();
    host?.querySelector<HTMLElement>(`[data-cell="${row}-${column}"]`)?.focus({ preventScroll: still });
  }

  /** The grid's keys: Enter, Space and Down open the choices; L, M and H rate; Delete clears; Left and Right move along the rows, Up and Page Up/Down between them. */
  function onCellKey(event: KeyboardEvent, row: number, column: number) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      step({ type: 'open', at: { r: row, c: column }, scrollY: window.scrollY });
      return;
    }
    const width = criteria.length;
    const at = row * width + column;
    const moves: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, ArrowUp: at - width, PageUp: at - width, PageDown: at + width };
    if (event.key in moves) {
      event.preventDefault();
      const to = Math.min(rows.length * width - 1, Math.max(0, moves[event.key]));
      void focusCell(Math.floor(to / width), to % width);
      return;
    }
    const level = KEYS[event.key.toLowerCase()];
    if (level || event.key === 'Delete' || event.key === 'Backspace') {
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

  /** Clear all: asked first in the "More choices" menu, since nothing brings the ratings back. */
  function clearAll() {
    confirmingClear = false;
    moreOpen = false;
    // The rated boxes fly off (copies, at most what the cap allows) as the ratings go.
    if (view === 'grid') flyOff([...(host?.querySelectorAll<HTMLElement>('.matrix-cell:not([data-level="0"])') ?? [])]);
    inBulk();
    aopClearAll();
    cells = {};
    handUp();
    host?.querySelector<HTMLElement>('[data-more] > button')?.focus();
  }

  /** A note or a menu closes on Escape and on a tap anywhere else; a tap on its own button (or on a box) is that button's to handle. */
  function onDocumentDown(event: PointerEvent) {
    const target = event.target as Element | null;
    if (about !== null && !target?.closest('[data-about]')) about = null;
    if (moreOpen && !target?.closest('[data-more]')) { moreOpen = false; confirmingClear = false; }
    if (menu.at && !target?.closest('[data-menu]') && !target?.closest('[data-cell]')) {
      // The keyboard goes back to the box once the press has settled, unless the press put it somewhere of its own (a button, a field).
      const { r, c } = menu.at;
      step({ type: 'outside' }, false);
      setTimeout(() => { if (document.activeElement === document.body) void focusCell(r, c, true); });
    }
  }
  function onDocumentKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (menu.at) { step({ type: 'escape' }); return; }
    if (about !== null) {
      const open = about;
      about = null;
      host?.querySelector<HTMLElement>(`[data-about="${open}"] button`)?.focus();
    }
    if (moreOpen) { moreOpen = false; confirmingClear = false; host?.querySelector<HTMLElement>('[data-more] > button')?.focus(); }
  }

  const single = $derived(rows[Math.min(rowAt, rows.length - 1)]);
  /** "Your ratings at a glance": the sentence, from the guest's own ratings on this device. */
  const best = $derived(left === 0 && total > 0 ? highestSentence(highestRated(cells, shape)) : '');

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
</script>

<svelte:document onpointerdown={onDocumentDown} onkeydown={onDocumentKey} />

{#snippet mark(level: number, size: number)}
  <svg class="matrix-mark" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d={look(level).path} /></svg>
{/snippet}

<div class="matrix" bind:this={host} data-testid="matrix" data-view={view} data-dense={criteria.length >= GRID_MIN_WIDTH.dense.from || undefined} style:--matrix-strip="{stripHeight}px" use:motion={{ role: 'options', type: question.type }}>
  <div class="matrix-top">
    <p class="matrix-how">{view === 'grid' ? 'Tap a box and choose Low, Medium or High.' : 'Choose Low, Medium or High for each criterion.'}</p>
    <div class="matrix-key" data-testid="matrix-key">
      <!-- (Prompt 42) The legend is a colour and its word: the boxes and the menu carry the shape and the letter, and the counts are in the summary. -->
      <ul class="matrix-legend" data-testid="matrix-legend">
        {#each [1, 2, 3] as level (level)}
          <li><span class="matrix-swatch" data-level={level} aria-hidden="true"></span>{look(level).name}</li>
        {/each}
      </ul>
      <div class="matrix-views" role="group" aria-label="How to rate" data-testid="matrix-views">
        <button type="button" class="matrix-view" aria-pressed={view === 'grid'} onclick={() => choose('grid')}>All at once</button>
        <button type="button" class="matrix-view" aria-pressed={view === 'single'} onclick={() => choose('single')}>One at a time</button>
      </div>
      <p class="matrix-caption">Colour shows the rating, not good or bad.</p>
    </div>
    <div class="matrix-more" data-more>
      <button type="button" class="matrix-more-button" aria-label="More choices" aria-expanded={moreOpen} aria-controls="{uid}-more" onclick={() => { moreOpen = !moreOpen; confirmingClear = false; }}>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {#if moreOpen}
        <div class="matrix-more-panel" id="{uid}-more">
          {#if confirmingClear}
            <p><b>Remove all your ratings?</b></p>
            <div class="matrix-steps">
              <button type="button" class="matrix-tool" onclick={() => { confirmingClear = false; }}>Cancel</button>
              <button type="button" class="matrix-tool matrix-step--next" onclick={clearAll}>Remove</button>
            </div>
          {:else}
            <button type="button" class="matrix-tool" disabled={rated === 0} onclick={() => { confirmingClear = true; }}>Clear all</button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="matrix-strip" data-pinned={view === 'grid' || undefined} bind:clientHeight={stripHeight}>
    <div class="matrix-line">
      <div class="matrix-bar" role="progressbar" aria-label="Your progress" aria-valuemax={total} aria-valuenow={rated} aria-valuetext="{rated} of {total} boxes" data-testid="matrix-progress"><span style:transform="scaleX({total ? rated / total : 0})"></span></div>
      {#if left === 0}<svg class="matrix-bar-check" bind:this={barCheck} width="22" height="22" viewBox="0 0 20 20" aria-hidden="true" data-testid="matrix-bar-check"><circle cx="10" cy="10" r="9" /><path d="M5.5 10.2l3 3 6-6.4" /></svg>{/if}
      <span class="matrix-glow" bind:this={glow} aria-hidden="true"></span>
      {#if milestone}<p class="matrix-milestone" bind:this={milestoneLabel} role="status" data-testid="matrix-milestone">{milestone}</p>{/if}
    </div>
    <button type="button" class="matrix-next" disabled={left === 0} onclick={() => void goToEmpty()}>
      {#if left === 0}All done{:else}Next empty box <span class="matrix-left">{left} left</span>{/if}
    </button>
    <p class="sr-only" role="status" aria-live="polite">{spoken}</p>
  </div>

  {#if view === 'grid'}
    <p class="sr-only" id="{uid}-keys">Enter opens the choices; L, M or H rates; Delete clears.</p>
    <div class="matrix-well" data-cramped={cramped || undefined} data-bulk={bulk || undefined} data-fit={fit || undefined} bind:this={well}>
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
              {@const head = heads[c]}
              {@const noted = !!(criterion.hint || head.qualifier)}
              <th scope="col" class="matrix-head" aria-label={head.qualifier ? `${head.name} ${head.qualifier}` : undefined} data-about={noted ? criterion.id : undefined}>
                <span class="matrix-head-in">
                  <span class="matrix-head-words">{head.name}</span>
                  {#if noted}
                    <button type="button" class="matrix-info" aria-label={`About ${head.name}`} aria-expanded={about === criterion.id} aria-controls="{uid}-about-{c}" onclick={() => { about = about === criterion.id ? null : criterion.id; }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" /><path d="M10 9v5M10 6.2v.1" /></svg>
                    </button>
                  {/if}
                </span>
                {#if noted && about === criterion.id}
                  <div class="matrix-about" id="{uid}-about-{c}" role="note" data-testid="matrix-about" data-edge={c >= criteria.length - 2 ? 'end' : undefined}>
                    <p><b>{head.name}</b>{#if head.qualifier}{' '}{head.qualifier}{/if}</p>
                    {#if criterion.hint}<p>{criterion.hint}</p>{/if}
                  </div>
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
                  <span>{row.label}</span>{#if done}<span class="sr-only">, all done</span>{/if}
                </span>
              </th>
              <td class="matrix-people">{peopleOf(row.value)}</td>
              {#each criteria as criterion, c (criterion.id)}
                {@const level = levelOf(row.id, criterion.id)}
                {@const first = firstEmpty?.rowId === row.id && firstEmpty?.criterionId === criterion.id}
                {@const open = menuAt?.r === r && menuAt?.c === c}
                <td class="matrix-slot">
                  <button
                    type="button"
                    class="matrix-cell"
                    data-level={level ?? 0}
                    data-cell="{r}-{c}"
                    tabindex={r === focusRow && c === focusColumn ? 0 : -1}
                    aria-label={cellName(row.label, criterion.label, level)}
                    aria-describedby={first ? `${uid}-teach ${uid}-keys` : `${uid}-keys`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onfocus={() => { focusRow = r; focusColumn = c; }}
                    onkeydown={(event) => onCellKey(event, r, c)}
                    onclick={() => onBoxClick(r, c)}
                    oncontextmenu={(event) => onBoxContextMenu(event, r, c)}
                  >
                    {#if level}
                      <span class="matrix-face">{@render mark(level, 12)}<span class="matrix-letter">{look(level).letter}</span></span>
                    {:else}
                      <svg class="matrix-plus" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                    {/if}
                  </button>
                  {#if first}<p class="matrix-teach" id="{uid}-teach" data-testid="matrix-teach">Tap to rate</p>{/if}
                  {#if open}
                    <div class="matrix-menu" role="menu" tabindex="-1" aria-label={`Rating for ${row.label}, ${criterion.label}`} data-menu data-above={menuAbove || undefined} data-end={menuEnd || undefined} onkeydown={onMenuKey} onfocusout={onMenuOut}>
                      {#each menuChoices(level) as choice (choice)}
                        <button type="button" role="menuitemradio" class="matrix-choice" tabindex="-1" data-choice={choice} aria-checked={(level ?? 0) === choice} onclick={() => pick(choice)}>
                          {#if choice}<span class="matrix-chip" data-level={choice} aria-hidden="true">{@render mark(choice, 12)}<span class="matrix-chip-letter">{look(choice).letter}</span></span>{look(choice).name}{:else}<span class="matrix-chip matrix-chip--clear" aria-hidden="true"></span>Clear{/if}
                          {#if (level ?? 0) === choice}<svg class="matrix-chosen" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>{/if}
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

  {#if left === 0 && total > 0 && glanceReady}
    <!-- (Prompt 35) Made on the device from the draft: stored nowhere, sent nowhere, shown to no one else. The counts live here, and only here (Prompt 42). -->
    <section class="matrix-glance" data-testid="matrix-glance" bind:this={glance} aria-labelledby="{uid}-glance">
      <h3 class="matrix-glance-title" id="{uid}-glance">You rated all {total} boxes</h3>
      <ul class="matrix-tallies">
        {#each [1, 2, 3] as level (level)}
          <li data-testid="matrix-tally"><span class="matrix-chip" data-level={level}>{@render mark(level, 12)}</span> {look(level).name} <b class="matrix-tally" style:--to={counts[level]}><span class="sr-only">{counts[level]}</span></b></li>
        {/each}
      </ul>
      {#if best}<p class="matrix-best">{best}</p>{/if}
    </section>
  {/if}
</div>

<style>
  /* A white card on the client's plate: the three level colours read the same on every client's colour (styles/aop-level-tokens.css). Its padding is
     32 px (20 on a phone), and everything inside keeps 8 px more from its edges, so the instructions, the strip and the first row's names start on
     one line (Prompt 42); the parts are 24 px apart. */
  .matrix {
    --matrix-wash: var(--aop-wash);
    --matrix-done: var(--aop-done-wash);
    --matrix-rule: var(--aop-rule);
    --matrix-pad: 32px;
    --matrix-inset: 8px;
    display: grid;
    gap: 24px;
    margin-top: 24px;
    padding: var(--matrix-pad);
    color: var(--aop-well-ink);
    font: var(--fw-regular) var(--fs-small) / 1.35 var(--font-sans);
    background: var(--aop-well);
    border-radius: 13px;
  }

  @media (max-width: 599px) {
    .matrix {
      --matrix-pad: 20px;
    }
  }

  .matrix p {
    margin: 0;
  }

  .matrix-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-start;
    padding-inline: var(--matrix-inset);
  }

  /* On the line of the legend and the switch (50 px, the switch's height). */
  .matrix-how {
    display: flex;
    flex: 1 1 16rem;
    align-items: center;
    min-height: 50px;
  }

  /* The legend and the view switch share one right edge and one height: side by side on a wide screen, the legend under the switch on a narrow one;
     the caption under the legend. */
  .matrix-key {
    display: grid;
    grid-template-areas: 'views' 'legend' 'caption';
    gap: 8px 16px;
    justify-items: end;
    margin-left: auto;
  }

  @media (min-width: 1024px) {
    .matrix-key {
      grid-template-areas: 'legend views' 'caption .';
      align-items: stretch;
    }
  }

  .matrix-legend {
    display: flex;
    grid-area: legend;
    gap: 16px;
    margin: 0;
    padding: 0;
    font-weight: var(--fw-semibold);
    list-style: none;
  }

  .matrix-legend,
  .matrix-legend li {
    align-items: center;
  }

  .matrix-legend li {
    display: flex;
    gap: 6px;
  }

  .matrix-swatch {
    width: 14px;
    height: 14px;
    border-radius: 4px;
  }

  .matrix-caption {
    grid-area: caption;
    color: var(--aop-empty-edge);
    text-align: right;
  }

  .matrix-views {
    display: inline-flex;
    grid-area: views;
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
    z-index: 7;
    display: grid;
    gap: 8px;
    width: max-content;
    max-width: min(20rem, 80vw);
    padding: 12px;
    background: var(--aop-well);
    border: 1px solid var(--aop-empty-edge);
    border-radius: 10px;
  }

  /* The one row that stays on screen while the page scrolls: the progress and Next empty box. */
  .matrix-strip[data-pinned] {
    position: sticky;
  }

  .matrix-strip {
    position: relative;
    top: 0;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    align-items: center;
    padding: 8px var(--matrix-inset);
    background: var(--aop-well);
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

  /* A coloured chip in the menu and the summary: the box's colour, edge and shape; its words stay in ink on the card. */
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

  /* The criteria columns are equal, from 112 px (Prompt 42; six or more from 96 px), and the first column takes an equal share where there is room; on a
     narrower screen it narrows first (GRID_MIN_WIDTH, lib/participant/aop-view.js). The first and the last keep 8 px from the card's edge. */
  .matrix {
    --matrix-process: 100px;
    --matrix-criterion-min: 112px;
  }

  .matrix[data-dense] {
    --matrix-process: 86px;
    --matrix-criterion-min: 96px;
  }

  .matrix-grid {
    width: 100%;
    min-width: calc(var(--matrix-process) + 52px + var(--matrix-columns) * var(--matrix-criterion-min));
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  @media (max-width: 1023px) {
    .matrix-col-process {
      width: var(--matrix-process);
    }
  }

  .matrix-col-people {
    width: 52px;
  }

  /* A heading that would take a third line: the letters close up a little, then the first column narrows, then the columns widen and the grid
     scrolls inside its card. A grid that scrolls inside its card is its headings' scroller: they stay at its top, never over the first row. */
  .matrix-well[data-fit] .matrix-head-words {
    letter-spacing: -0.02em;
  }

  .matrix-well[data-fit]:not([data-fit='1']) .matrix-col-process {
    width: var(--matrix-process);
  }

  .matrix-well:is([data-cramped], [data-fit='3']) {
    --matrix-strip: 0px;
    --matrix-process: 112px;
    overflow-x: auto;
  }

  .matrix-well[data-fit='3'] {
    --matrix-criterion-min: 176px;
  }

  .matrix-corner,
  .matrix-people-head,
  .matrix-head {
    position: sticky;
    top: var(--matrix-strip, 0px);
    z-index: 2;
    padding: 8px 4px;
    font: var(--fw-semibold) 13px / 1.25 var(--font-sans);
    text-align: left;
    vertical-align: bottom;
    background: var(--aop-well);
    border-bottom: 2px solid var(--aop-well-ink);
  }

  .matrix-corner {
    padding-left: var(--matrix-inset);
  }

  /* A criterion heading: its name in at most two lines of whole words, centred on its column, sitting on the line above the note's button, so every
     column's button is on one line. A qualifier in brackets is in the note and the heading's name, not in the heading (Prompt 42). */
  .matrix-head {
    padding-inline: 6px;
    text-align: center;
  }

  .matrix-head:last-child {
    padding-right: calc(6px + var(--matrix-inset));
  }

  .matrix-head-in {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
  }

  .matrix-head-words {
    display: block;
    text-wrap: balance;
  }

  .matrix-people-head,
  .matrix-people {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .matrix-info {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -8px 0 -10px;
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
    font: var(--fw-regular) var(--fs-small) / 1.35 var(--font-sans);
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
    padding: 4px 8px 4px var(--matrix-inset);
    font-weight: var(--fw-semibold);
    text-align: left;
    hyphens: auto;
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

  .matrix-slot:last-child {
    padding-right: calc(2px + var(--matrix-inset));
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
    scroll-margin-block: calc(var(--matrix-strip, 0px) + 104px) 96px;
    color: var(--aop-well-ink);
    font: inherit;
    background: var(--aop-well);
    border: 1.5px dashed var(--aop-empty-edge);
    border-radius: 8px;
    cursor: pointer;
    transition: background-color var(--motion-duration-cell) var(--motion-ease-standard);
  }

  /* A tap is not a text selection, a callout or a double-tap zoom. */
  .matrix-cell {
    position: relative;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    touch-action: manipulation;
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

  [data-level='1']:is(.matrix-cell, .matrix-chip, .matrix-segment, .matrix-swatch) {
    color: var(--aop-on-low);
    background: var(--aop-low);
    border: 2px solid var(--aop-low-edge);
  }

  [data-level='2']:is(.matrix-cell, .matrix-chip, .matrix-segment, .matrix-swatch) {
    color: var(--aop-on-medium);
    background: var(--aop-medium);
    border: 2px solid var(--aop-medium-edge);
  }

  [data-level='3']:is(.matrix-cell, .matrix-chip, .matrix-segment, .matrix-swatch) {
    color: var(--aop-on-high);
    background: var(--aop-high);
    border: 2px solid var(--aop-high-edge);
  }

  /* The level menu, attached to its box with a 6 px gap (below it, or above when there is no room; from its right edge on the last columns): a row of
     48 px or more for each choice, with the box's colour, shape and letter in a chip and its word in ink; the chosen one has a check and a dark edge. */
  .matrix-menu {
    position: absolute;
    top: calc(100% + 4px);
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

  .matrix-menu[data-above] {
    top: auto;
    bottom: calc(100% + 4px);
  }

  .matrix-menu[data-end] {
    right: 2px;
    left: auto;
  }

  .matrix-slot:last-child .matrix-menu[data-end] {
    right: calc(2px + var(--matrix-inset));
  }

  .matrix-choice {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 120px;
    min-height: 48px;
    padding: 0 10px 0 6px;
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

  .matrix-chosen {
    flex: none;
    margin-left: auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
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

  /* "Your ratings at a glance": the headline, the three figures counting up, and one sentence; the card's own padding is the grid card's. */
  .matrix-glance {
    display: grid;
    gap: 16px;
    padding: var(--matrix-pad);
    border: 1px solid var(--matrix-rule);
    border-radius: 13px;
  }

  .matrix-glance-title {
    margin: 0;
    font: var(--fw-bold) var(--fs-body) / 1.3 var(--font-sans);
  }

  .matrix-tallies {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 21px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .matrix-tallies li {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-weight: var(--fw-semibold);
  }

  /* Each figure counts up from 0 to --to (the browser animates the whole number; with motion off it is simply there). */
  .matrix-tally {
    --aop-count: var(--to);
    font-size: var(--fs-question);
    font-variant-numeric: tabular-nums;
    counter-reset: tally var(--aop-count);
    animation: matrix-count var(--motion-aop-count) var(--motion-ease-enter) backwards;
  }

  .matrix-tally::after {
    content: counter(tally);
  }

  @keyframes matrix-count {
    from { --aop-count: 0; }
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
    padding: var(--matrix-pad);
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
    .matrix-swatch,
    .matrix-segment { forced-color-adjust: none; }
  }
</style>
