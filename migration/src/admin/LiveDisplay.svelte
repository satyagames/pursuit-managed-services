<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { loadBrand } from '../lib/brand/branding.js';
  import { downloadCsv, downloadPdf, downloadPptx, liveSections } from '../lib/exports/resultsExport.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { getSessionResults, type SessionResults } from '../lib/admin/adminData.js';
  import { loadLiveStructure, readLive, type LiveRead, type LiveStructure } from '../lib/admin/live-session.js';
  import { withStoredColours } from '../lib/admin/master-brand.js';
  import { createPageWatcher, type PageWatcher } from '../lib/common/page-watch.js';
  import { adminDelay } from '../lib/common/poll-schedule.js';
  import { heldNameSources } from '../lib/admin/admin-results.js';
  import { wallAddress } from '../lib/admin/live-wall.js';
  import {
    liveBrand, pagerStep, presentScaleFor, sectionTitleOf, shownIndex, stepFrom, unreadableText as unreadableTextOf,
  } from '../lib/admin/live-view.js';
  import { nextFit, scaleOf } from '../lib/results/present-fit.js';
  import { answerCounts, answersFrom, answersOf, chartsOf, namesFor } from '../lib/results/results-chart-model.js';
  import { RESULTS_PALETTE } from '../lib/results/results-palette-source.js';
  import LiveHead from './LiveHead.svelte';
  import LiveNotReady from './LiveNotReady.svelte';
  import LiveNotices from './LiveNotices.svelte';
  import LiveSteps from './LiveSteps.svelte';
  import type { Look } from './LookChoice.svelte';
  import Breadcrumb from './Breadcrumb.svelte';
  import LiveSections from './LiveSections.svelte';
  import LiveStage from './LiveStage.svelte';

  // The facilitator's live results display (it was the participant page's Master screen until Phase 7): a live tally for each
  // question of the session, the number of answers and of iPads, in the client's own colours, and a Full screen view for projecting
  // it. It reads ONE request every 12 s on SharePoint (lib/admin/live-session.ts) and nothing while the tab is hidden. The CSV, PDF and
  // PowerPoint exports are here too, and read through getSessionResults() (lib/results/session-results.js, the same arithmetic as the display's own).
  // An answer item that cannot be read is left out of the tally and said so at the top (Phase 9b, DI-6), here and in the exports' own message.
  // In full screen it shows ONE question at a time, sized so the whole card is on the screen (a projector has no scroll wheel and the
  // pointer is hidden): Previous and Next, the arrow keys, and an Auto-advance switch. None of that reads anything.
  //
  // Since Phase 11a each question is a chart of its own kind (admin/charts/, its numbers from lib/results/results-chart-model.js), in Deloitte's colours.
  // There are two views. The ADMIN view (this page as the facilitator opens it) names people: a bar opens who picked it, and a Names shown switch
  // hides them. The WALL (full screen, and the page "Open in a new tab" opens, `#live-display/<id>/wall`) has no participant's name anywhere in
  // the page: its charts are made from a model given no names, and a graded question's answer is marked only when the presenter presses Show answer.
  // The names are lib/results/participant-names.js's, from what this page already reads (the visits carry a guest's QR name; a staff sign-in name is
  // known when Results has read it in this tab): no request was added.

  type Session = { id: string; clientId: string; date?: string; status?: string };
  type Client = { id: string; name: string };
  type Phase = 'loading' | 'picker' | 'display' | 'missing' | 'error';

  let { sessionId, wallPage = false, onToast, onOpen, onBack }: {
    /** The session to show; '' is the one that is live now (the picker when none is). */
    sessionId: string;
    /** The page "Open in a new tab" opens: the wall display, with no names. */
    wallPage?: boolean;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** A session was picked (the address follows it). */
    onOpen: (sessionId: string) => void;
    onBack: () => void;
  } = $props();

  let phase = $state<Phase>('loading');
  let message = $state('Loading results...');
  let structure = $state<LiveStructure | null>(null);
  let results = $state<SessionResults | null>(null);
  let updated = $state('');
  let sessions = $state<Session[]>([]);
  let clients = $state<Client[]>([]);
  let exportMessage = $state('');
  let exporting = $state('');
  let presenting = $state(false);
  /** In full screen, after a few seconds with no pointer, key or touch, the way out fades and the pointer hides: a projector shows the results and nothing else. */
  let idle = $state(false);
  let idleTimer: number | undefined;
  let presentScale = $state(1);
  let viewHeight = $state(0);
  /** Full screen shows one question at a time: its id (so a change in the list keeps it) and its place (for when it has gone). */
  let shownId = $state('');
  let shownAt = $state(0);
  let autoAdvance = $state(false);
  /** 1, or less when the card on screen would not fit at the size the window asks for (a very long question): the type shrinks until it does. */
  let fitFactor = $state(1);
  /** The card on screen does not fit even at the smallest type (eight long answers on a phone held upright): it is as tall as it needs and the screen
   *  scrolls as one page, with "More below" while there is more (Phase 11a-2; never a scrolling box inside the card). */
  let spill = $state(false);
  /** The screen is scrolled to its end (only while it spills). */
  let atEnd = $state(true);
  /** The height of the controls at the foot of the screen, which stay in view while it spills: what scrolling into view keeps clear of. */
  let footHeight = $state(0);
  let stage = $state<HTMLElement>();
  let root = $state<HTMLElement>();
  let watcher: PageWatcher | undefined;
  let active = false;
  let nativeFullscreen = false;
  let exportLibraryPromise: Promise<void> | null = null;
  // A logo that cannot be loaded leaves no empty chip behind: the client's name is the heading anyway.
  let failedLogo = $state('');
  /** Prompt 34: the wall's look (dark for a projector, light for a bright room) and the packs' (light prints well). In memory for this visit only. */
  let wallLook = $state<Look>('dark');
  let fileLook = $state<Look>('light');
  /** The admin view's switch: names on the charts, on until the facilitator hides them. */
  let namesShown = $state(true);
  /** Each question's open answer (its names) or chosen word, by question id: a refresh keeps them. In memory only. */
  let selected = $state<Record<string, string | null>>({});
  /** The questions whose answer the presenter has shown on the wall, by question id. In memory only. */
  let revealed = $state<Record<string, boolean>>({});

  const local = !dataService.isSharePointMode();

  // The client's colours as the Master screen has always taken them: the stored theme's when it has one, the older fields otherwise.
  const brand = $derived(liveBrand(structure?.client ?? null, APP_NAME));
  const sections = $derived(results ? liveSections(results) as SessionResults['sections'] : []);
  const questions = $derived(sections.flatMap((section) => section.questions));
  /** "N answers from M iPads": the visits that answered (Phase 11a-2), over the questions on the display. */
  const answered = $derived(answerCounts(questions));
  const count = $derived(questions.length);
  /** The wall: full screen, or the page "Open in a new tab" opens. Nobody's name is in the page. */
  const wall = $derived(presenting || wallPage);
  const withNames = $derived(!wall && namesShown);
  // Who is who, for the admin view's names (lib/results/participant-names.js, as on the Results rows); none at all on the wall, or with names hidden.
  const names = $derived(results && withNames ? namesFor({ tracks: results.tracks, answers: answersOf(results), ...(heldNameSources(results.session.id) ?? {}) }) : null);
  const chartSections = $derived(results ? chartsOf({ sections }, { names }) : []);
  const charts = $derived(new Map(chartSections.flatMap((section) => section.charts.map((chart) => [chart.id, chart]))));
  // Who, if some saved answers could not be read: by the name on their visit, else the visit id. On the wall, how many and nothing else.
  const unreadableText = $derived(unreadableTextOf(results, wall));
  const at = $derived(shownIndex(questions, shownId, shownAt));
  const current = $derived(questions[at]);
  /** The question on screen, by its id: a refresh hands the page new objects for the same question, and the effects below must not take that for a
   *  new question (Phase 11a-2: each refresh put the type back to full size and, once the screen could scroll, the screen back to its top). */
  const currentId = $derived(current?.id ?? '');
  const currentChart = $derived(current ? charts.get(current.id) ?? null : null);
  const currentTitle = $derived(sectionTitleOf(sections, current?.id));
  // The type, and the steps that make it smaller for a card that does not fit, are lib/results/present-fit.js (Phase 11a-3): never below SMALLEST, and past
  // it the card spills.
  const scale = $derived(presenting ? scaleOf(presentScale, fitFactor) : 1);

  // ---- Opening ----------------------------------------------------------------------------------------------------

  function apply(read: LiveRead) {
    if (!active) return;
    if (read.gone) {
      results = null;
      structure = null;
      phase = 'missing';
      message = 'That session no longer exists.';
      return;
    }
    structure = read.structure;
    results = read.results;
    phase = 'display';
    message = '';
    updated = new Date().toLocaleTimeString();
  }

  async function open() {
    try {
      let id = sessionId;
      if (!id) id = ((await dataService.getAppSettings()) as { activeSessionId?: string | null } | null)?.activeSessionId ?? '';
      if (!id) {
        const [nextSessions, nextClients] = await Promise.all([dataService.listSessions() as Promise<Session[]>, dataService.listClients() as Promise<Client[]>]);
        if (!active) return;
        sessions = nextSessions;
        clients = nextClients;
        phase = 'picker';
        message = sessions.length ? 'Nothing is live. Choose a session.' : 'There are no sessions yet.';
        return;
      }
      const held = await loadLiveStructure(id);
      if (!active) return;
      if (!held) {
        phase = 'missing';
        message = 'That session no longer exists.';
        return;
      }
      structure = held;
      apply(await readLive(held));
      watcher?.start();
    } catch (cause) {
      if (!active) return;
      console.warn('The live display could not load', cause);
      phase = 'error';
      message = 'Could not load results. Check your connection and retry.';
    }
  }

  async function check() {
    const held = structure;
    if (!held) return;
    try {
      const read = await readLive(held);
      apply(read);
      return { requests: read.requests };
    } catch (cause) {
      if (active && phase === 'display') message = 'Connection lost. Retrying...';
      throw cause;
    }
  }

  /** Reads the activities, questions and options again, then the feed (the timer does it every 5 minutes by itself). */
  function refreshStructure() {
    if (structure) structure = { ...structure, readAt: 0 };
    void watcher?.checkNow();
  }

  onMount(() => {
    active = true;
    watcher = createPageWatcher({
      check,
      enabled: () => phase === 'display' && structure !== null,
      local,
      wait: ({ requests, failures, retryAfterMs, local: onLocal }) => adminDelay({ local: onLocal, requests, failures, retryAfterMs }),
    });
    // The browser's own full screen can end without this page asking (Escape): the display follows it.
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    void open();
    return () => {
      active = false;
      watcher?.stop();
      watcher = undefined;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      leave();
    };
  });

  // ---- Full screen ------------------------------------------------------------------------------------------------

  // Full screen is the page's own: the display covers the window, the admin bar and tabs are taken out of reach, and the type is
  // larger (the cards and the chart text both scale with the window). Where the browser offers the Fullscreen API it also takes the
  // whole screen; where it does not (iPad Safari does not for every element) the cover alone is the full screen. Escape, or the
  // button that appears when the pointer moves, leaves it.
  const fullscreenElement = () => document.fullscreenElement ?? (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? null;

  const IDLE_MS = 3000;
  function wake() {
    idle = false;
    window.clearTimeout(idleTimer);
    if (presenting) idleTimer = window.setTimeout(() => { idle = true; }, IDLE_MS);
  }

  const AUTO_ADVANCE_MS = 15_000;

  /** Moves to the previous (-1) or the next (1) question, and round again at either end. */
  function go(step: number) {
    if (count === 0) return;
    const next = stepFrom(at, step, count);
    shownAt = next;
    shownId = questions[next].id;
    fitFactor = 1;
  }

  async function enter() {
    presenting = true;
    shownId = '';
    shownAt = 0;
    autoAdvance = false;
    fitFactor = 1;
    spill = false;
    wake();
    await tick();
    const target = root as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | undefined;
    try {
      if (target?.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
      else await target?.webkitRequestFullscreen?.();
      nativeFullscreen = fullscreenElement() === target;
    } catch {
      nativeFullscreen = false; // the cover alone is the full screen
    }
  }

  function leave(native = true) {
    presenting = false;
    autoAdvance = false;
    window.clearTimeout(idleTimer);
    idle = false;
    if (native && nativeFullscreen && fullscreenElement()) {
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
      void Promise.resolve(document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.()).catch(() => {});
    }
    nativeFullscreen = false;
  }

  function onFullscreenChange() {
    // The browser left full screen by itself (Escape, or the person's own gesture): so does the display.
    if (nativeFullscreen && !fullscreenElement()) {
      nativeFullscreen = false;
      presenting = false;
      autoAdvance = false;
      window.clearTimeout(idleTimer);
      idle = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (!presenting) return;
    const step = pagerStep(event);
    if (event.key === 'Escape') leave();
    else if (step !== null) {
      event.preventDefault();
      go(step);
    }
  }

  $effect(() => {
    // While presenting, the admin's bar and tabs are out of reach of the keyboard and of assistive technology.
    const chrome = [...document.querySelectorAll('.shell__bar, .shell__nav')];
    for (const element of chrome) element.toggleAttribute('inert', presenting);
    return () => { for (const element of chrome) element.removeAttribute('inert'); };
  });

  $effect(() => {
    if (!presenting) return;
    // Larger type for a projector: 1.2 on a laptop, up to 2.4 on a wide screen.
    const measure = () => {
      presentScale = presentScaleFor(window.innerWidth);
      viewHeight = window.innerHeight;
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  // Auto-advance: the next question every 15 seconds, and round again. It waits while the tab is hidden and starts a fresh 15 seconds when
  // the tab is shown, and a move by hand (Previous, Next, a key) starts the 15 seconds again, so the question you went to is not taken away.
  $effect(() => {
    if (!presenting || !autoAdvance || count < 2) return;
    void at;
    let timer: number | undefined;
    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'hidden') timer = window.setTimeout(() => go(1), AUTO_ADVANCE_MS);
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
  });

  // The card fits the room it is given (CSS), and this is the guard for a question that cannot: a very long prompt leaves the chart less than its
  // least height, so the type is made smaller, a step at a time, until the card is whole on the screen. A new question or window starts from full size.
  // Past the smallest type the card spills: it is as tall as it needs and the screen scrolls as one page (Phase 11a-2: it used to be cut at its edge).
  $effect(() => {
    void currentId;
    void presentScale;
    void viewHeight;
    fitFactor = 1; // (a write only: reading it here would make this undo each step of the effect below)
    spill = false;
    if (root) root.scrollTop = 0;
  });
  $effect(() => {
    if (!presenting || !stage) return;
    void currentId;
    void presentScale;
    void viewHeight;
    let stale = false;
    let running = false;
    let watch: ResizeObserver | undefined;
    /** Looks at the card after the screen has been drawn for the size it has now, and makes the type a step smaller while it does not fit. */
    async function fitCard() {
      if (running) return;
      running = true;
      try {
        for (let step = 0; step < 12 && !stale; step += 1) {
          await tick();
          const card = stage?.querySelector<HTMLElement>('.result-card');
          if (stale || !card || spill || card.scrollHeight <= card.clientHeight + 1) return;
          const next = nextFit(presentScale, fitFactor);
          if (next === null) {
            spill = true;
            return;
          }
          fitFactor = next;
        }
      } finally {
        running = false;
      }
    }
    void fitCard().then(() => document.fonts?.ready).then(() => (stale ? undefined : fitCard()));
    // What the card shows can change under the same question (its numbers in place of its chart): look again when its contents need more room.
    void tick().then(() => {
      const body = stage?.querySelector('.result-card__body');
      if (stale || !body || typeof ResizeObserver === 'undefined') return;
      watch = new ResizeObserver(() => { if (!stale) void fitCard(); });
      watch.observe(body);
    });
    return () => {
      stale = true;
      watch?.disconnect();
    };
  });

  function noteScroll() {
    if (root) atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
  }

  $effect(() => {
    if (!presenting || !spill) {
      atEnd = true;
      return;
    }
    void tick().then(noteScroll);
    window.addEventListener('resize', noteScroll);
    return () => window.removeEventListener('resize', noteScroll);
  });

  // ---- Exports (as the Master screen had them) -------------------------------------------------------------------

  async function loadLibraries() {
    exportLibraryPromise ??= Promise.all([import('jspdf'), import('pptxgenjs')])
      .then(([pdfModule, pptModule]) => {
        const globals = window as unknown as { jspdf?: { jsPDF: unknown }; PptxGenJS?: unknown };
        globals.jspdf = { jsPDF: pdfModule.jsPDF };
        globals.PptxGenJS = pptModule.default;
        Object.assign(globalThis, { CEC_EMBEDDED_EXPORTS: true });
      })
      .catch((cause) => { exportLibraryPromise = null; throw cause; });
    await exportLibraryPromise;
  }

  async function exportCurrent(kind: 'csv' | 'pdf' | 'pptx') {
    const id = structure?.session.id;
    if (!id || exporting) return;
    exporting = kind;
    exportMessage = '';
    try {
      // A fresh read through the one reader of answers (both storage shapes; a damaged item is left out and was named at the top).
      const current = await getSessionResults(id);
      if (!active) return;
      if (!current) throw new Error('That session no longer exists.');
      let fileName: string;
      // The summary by activity (Phase 13): the client's name is the one this display already holds, so the file costs no read of its own.
      if (kind === 'csv') fileName = downloadCsv(current, { name: (typeof structure?.client?.name === 'string' ? structure.client.name.trim() : '') });
      else {
        const [loaded] = await Promise.all([
          loadBrand({ state: { clientId: current.session.clientId }, sessionId: current.session.id }),
          loadLibraries(),
        ]);
        const exportBrand = { ...(await withStoredColours(loaded)), appName: APP_NAME, palette: RESULTS_PALETTE, look: fileLook };
        if (!active) return;
        if (exportBrand.clientId !== current.session.clientId) throw new Error('Could not load the session client branding. Please try again.');
        fileName = kind === 'pdf' ? await downloadPdf(current, exportBrand) : await downloadPptx(current, exportBrand);
      }
      exportMessage = `Saved ${fileName}`;
      onToast(`Saved ${fileName}`, 'success');
    } catch (cause) {
      console.error(cause);
      exportMessage = `Export failed: ${cause instanceof Error ? cause.message : 'Unknown error.'}`;
    } finally {
      exporting = '';
    }
  }

  const newTabAddress = $derived(structure ? wallAddress(window.location.href, structure.session.id) : '#');
  /** "48 answers from 6 iPads · updated 11:59:18", or what the page is doing. */
  const metaLine = $derived(results ? `${answersFrom(answered)} · updated ${updated}` : message);
  /** The breadcrumb's session: its client and its date (Prompt 34: "Results › Kroger · 2026-09-18 › Live"). */
  const crumbLabel = $derived(structure ? [brand.name, structure.session.date].filter(Boolean).join(' · ') : 'Session');

  function select(questionId: string, id: string | null) {
    selected = { ...selected, [questionId]: id };
  }

  function toggleAnswer(questionId: string) {
    revealed = { ...revealed, [questionId]: !revealed[questionId] };
  }
</script>

<svelte:window onkeydown={(event) => { wake(); onKeydown(event); }} onpointermove={wake} onpointerdown={wake} />
<svelte:document onfocusin={wake} />

<section
  class="live"
  class:live--present={presenting}
  class:live--light={wallLook === 'light'}
  class:live--spill={presenting && spill}
  data-presenting={presenting}
  data-idle={presenting && idle}
  data-phase={phase}
  aria-busy={phase === 'loading'}
  bind:this={root}
  onscroll={noteScroll}
  style:scroll-padding-bottom={presenting && spill ? `calc(${footHeight}px + 3rem)` : null}
  style:--brand-primary={brand.primary}
  style:--brand-secondary={brand.secondary}
  style:--chart-scale={scale}
>
  {#if !presenting}<Breadcrumb parts={[{ label: 'Results', onclick: onBack }, { label: crumbLabel }, { label: 'Live' }]} />{/if}
  <header class="live__head">
    <LiveHead
      {wallLook} onWallLook={(look) => { wallLook = look; }} {brand} {failedLogo} clientName={structure ? brand.name : APP_NAME} {wallPage} meta={metaLine} {phase} {presenting}
      onLogoFailed={() => { failedLogo = brand.logoUrl ?? ''; }} onEnter={() => void enter()} onLeave={() => leave()}
    />
  </header>

  {#if phase === 'display'}
    {#if !wall}
      <LiveSteps
        meta={metaLine} answers={answered.answers} check={results?.confidenceCheck} {exporting} {newTabAddress} {wallLook} {fileLook}
        onWallLook={(look) => { wallLook = look; }} onFileLook={(look) => { fileLook = look; }} onExport={(kind) => void exportCurrent(kind)} onRefresh={refreshStructure} onEnter={() => void enter()}
      />
    {/if}
    <LiveNotices {message} {unreadableText} {wall} {exportMessage} {presenting} {namesShown} onToggleNames={() => { namesShown = !namesShown; }} />
    {#if presenting}
      <LiveStage
        bind:stage bind:footHeight {current} {currentChart} {currentTitle} {at} {count} {revealed} {selected} {scale} {spill} {atEnd} {autoAdvance}
        onToggleAnswer={toggleAnswer} onSelect={select} onGo={go} onToggleAuto={() => { autoAdvance = !autoAdvance; }}
      />
    {:else}
      {#if questions.length === 0}<p class="live__status">This session has no live questions yet.</p>{/if}
      <LiveSections {chartSections} {wall} {withNames} {revealed} {selected} {scale} onToggleAnswer={toggleAnswer} onSelect={select} />
    {/if}
  {:else}
    <LiveNotReady {phase} {message} {sessions} {clients} {onOpen} />
  {/if}
</section>

<style>
  .live {
    --live-gap: 1rem;
    display: flex;
    flex-direction: column;
    gap: var(--live-gap);
    min-width: 0;
    color: var(--adm-ink);
  }

  .live__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.5rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--adm-line);
  }

  .live__status {
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.5rem;
  }

  /* ---- Full screen: the display covers the window; the type is large; ONE question at a time, sized to fit ----------------------- */

  .live--present {
    --live-gap: calc(0.9rem * var(--chart-scale, 1));
    --live-pad: clamp(0.75rem, 2vw, 2rem);
    position: fixed;
    inset: 0;
    z-index: 2000;
    box-sizing: border-box;
    padding: var(--live-pad);
    overflow: hidden; /* a projector has no scroll wheel: nothing scrolls, the card is sized to the room */
    /* Prompt 34: the wall in one of two looks, chosen before it opens (LiveSteps.svelte's Wall: Dark or Light). Each is flat (no gradient, no
       client colour: the client's logo keeps its place in the heading). The wall's own names (--wall-*) are the ground, the words, the figures and
       the hairlines; the charts' colour names (--viz-*) point at the admin tokens, so a chart draws on either with nothing of its own changed.
       DARK, the data look: black, white words and lime figures (7:1 or better, scripts/test-admin-today.js); the top choice lime, the rest deep
       green, the correct answer sky (with its tick and the word), a scale's steps one lime (each has its count written). */
    --wall-ground: var(--adm-bar-black);
    --wall-ink: var(--adm-on-deep);
    --wall-figure: var(--adm-lime);
    --wall-line: var(--adm-lime);
    --wall-step: var(--adm-lime);
    color: var(--wall-ink);
    background: var(--wall-ground);
    --viz-surface: var(--wall-ground);
    --viz-text: var(--wall-ink);
    --viz-text-secondary: var(--wall-ink);
    --viz-text-muted: var(--wall-ink);
    --viz-grid: var(--adm-text-muted);
    --viz-band-shade: var(--adm-text);
    --viz-primary: var(--adm-lime);
    --viz-primary-tint: var(--adm-deep);
    --viz-correct: var(--adm-sky);
    --viz-marker: var(--wall-ink);
    --viz-brand: var(--adm-lime);
    --viz-band-high: var(--adm-lime);
    --viz-band-medium: var(--wall-ink);
    --viz-band-low: var(--adm-sky);
  }

  /* LIGHT, for a bright room: white, the dark text, figures in the deep green (6.7:1, at hero size), the top choice deep green and the rest
     lime (each bar has its value written beside it), the correct answer link blue, lines in the card line, a scale's steps deep green. */
  .live--present.live--light {
    --wall-ground: var(--adm-card);
    --wall-ink: var(--adm-text);
    --wall-figure: var(--adm-deep);
    --wall-line: var(--adm-card-line);
    --wall-step: var(--adm-deep);
    --viz-grid: var(--adm-card-line);
    --viz-band-shade: var(--adm-wash);
    --viz-primary: var(--adm-deep);
    --viz-primary-tint: var(--adm-lime);
    --viz-correct: var(--adm-link);
    --viz-brand: var(--adm-deep);
    --viz-band-high: var(--adm-deep);
    --viz-band-low: var(--adm-link);
  }

  .live--present :global(.scale) {
    --viz-ramp-3-1: var(--wall-step); --viz-ramp-3-2: var(--wall-step); --viz-ramp-3-3: var(--wall-step);
    --viz-ramp-4-1: var(--wall-step); --viz-ramp-4-2: var(--wall-step); --viz-ramp-4-3: var(--wall-step); --viz-ramp-4-4: var(--wall-step);
    --viz-ramp-5-1: var(--wall-step); --viz-ramp-5-2: var(--wall-step); --viz-ramp-5-3: var(--wall-step); --viz-ramp-5-4: var(--wall-step); --viz-ramp-5-5: var(--wall-step);
  }

  /* Words on a fill the dark wall recolours: a chosen word is black on lime (9.2:1); Art of the Possible's light heat steps black, its dark ones white. */
  .live--present:not(.live--light) :global(.words__word[aria-pressed='true']) {
    color: var(--adm-bar-black);
  }

  .live--present :global(.aop__heat:is([data-tone='0'], [data-tone='1'])) {
    color: var(--adm-bar-black);
  }

  .live--present :global(.aop__heat:is([data-tone='2'], [data-tone='3'])) {
    color: var(--adm-on-deep);
  }

  /* The wall's buttons: outlined, in the wall's words on its ground, with its hairline. */
  .live--present :global(.btn) {
    color: var(--wall-ink);
    background: var(--wall-ground);
    border: 1.5px solid var(--wall-line);
    border-radius: 12px;
    font-size: calc(0.95rem * var(--chart-scale, 1));
  }

  .live--present .live__head {
    flex: 0 0 auto;
  }

  /* A question too long for the screen: the screen scrolls as one page (its stage and controls, LiveStage.svelte). */
  .live--present.live--spill {
    overflow-y: auto;
  }

  .live--present[data-idle='true'] {
    cursor: none;
  }

  .live--present .live__head {
    border-bottom: 1.5px solid var(--wall-line);
  }

  .live--present .live__status {
    color: var(--adm-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }
</style>
