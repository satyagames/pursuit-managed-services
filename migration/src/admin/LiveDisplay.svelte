<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import { embeddedAssetUrl } from '../../../public/js/assets.js';
  import { loadBrand } from '../../../public/js/branding.js';
  import { downloadCsv, downloadPdf, downloadPptx, liveSections } from '../../../public/js/resultsExport.js';
  import { APP_NAME } from '../lib/app-name.js';
  import { getSessionResults, type SessionResults } from '../lib/adminData.js';
  import { masterColours } from '../lib/legacy-colours.js';
  import { withoutRetiredLogo } from '../lib/retired-logos.js';
  import { UNREADABLE_FIX, namesByVisit, unreadableNotice } from '../lib/unreadable.js';
  import { loadLiveStructure, readLive, type LiveRead, type LiveStructure } from '../lib/live-session.js';
  import { withStoredColours } from '../lib/master-brand.js';
  import { createPageWatcher, type PageWatcher } from '../lib/page-watch.js';
  import { adminDelay } from '../lib/poll-schedule.js';
  import { heldNameSources } from '../lib/admin-results.js';
  import { wallAddress } from '../lib/live-wall.js';
  import { nextFit, scaleOf } from '../lib/present-fit.js';
  import { answerCounts, answersFrom, answersOf, chartsOf, namesFor } from '../lib/results-chart-model.js';
  import ResultCard from './charts/ResultCard.svelte';

  // The facilitator's live results display (it was the participant page's Master screen until Phase 7): a live tally for each
  // question of the session, the number of answers and of iPads, in the client's own colours, and a Full screen view for projecting
  // it. It reads ONE request every 12 s on SharePoint (lib/live-session.ts) and nothing while the tab is hidden. The CSV, PDF and
  // PowerPoint exports are here too, and read through getSessionResults() (lib/session-results.js, the same arithmetic as the display's own).
  // An answer item that cannot be read is left out of the tally and said so at the top (Phase 9b, DI-6), here and in the exports' own message.
  // In full screen it shows ONE question at a time, sized so the whole card is on the screen (a projector has no scroll wheel and the
  // pointer is hidden): Previous and Next, the arrow keys, and an Auto-advance switch. None of that reads anything.
  //
  // Since Phase 11a each question is a chart of its own kind (admin/charts/, its numbers from lib/results-chart-model.js), in Deloitte's colours.
  // There are two views. The ADMIN view (this page as the facilitator opens it) names people: a bar opens who picked it, and a Names shown switch
  // hides them. The WALL (full screen, and the page "Open in a new tab" opens, `#live-display/<id>/wall`) has no participant's name anywhere in
  // the page: its charts are made from a model given no names, and a graded question's answer is marked only when the presenter presses Show answer.
  // The names are lib/participant-names.js's, from what this page already reads (the visits carry a guest's QR name; a staff sign-in name is
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
  /** The admin view's switch: names on the charts, on until the facilitator hides them. */
  let namesShown = $state(true);
  /** Each question's open answer (its names) or chosen word, by question id: a refresh keeps them. In memory only. */
  let selected = $state<Record<string, string | null>>({});
  /** The questions whose answer the presenter has shown on the wall, by question id. In memory only. */
  let revealed = $state<Record<string, boolean>>({});

  const local = !dataService.isSharePointMode();

  // The client's colours as the Master screen has always taken them: the stored theme's when it has one, the older fields otherwise.
  const brand = $derived.by(() => {
    const client = structure?.client ?? null;
    const colours = masterColours(client);
    return {
      name: (typeof client?.name === 'string' && client.name.trim()) || APP_NAME,
      logoUrl: embeddedAssetUrl(typeof client?.logoUrl === 'string' && client.logoUrl.trim() ? withoutRetiredLogo(client.logoUrl.trim()) : null) as string | null,
      primary: colours.primaryColor ?? '#0f172a',
      secondary: colours.secondaryColor ?? '#64748b',
    };
  });
  const sections = $derived(results ? liveSections(results) as SessionResults['sections'] : []);
  const questions = $derived(sections.flatMap((section) => section.questions));
  /** "N answers from M iPads": the visits that answered (Phase 11a-2), over the questions on the display. */
  const answered = $derived(answerCounts(questions));
  const count = $derived(questions.length);
  /** The wall: full screen, or the page "Open in a new tab" opens. Nobody's name is in the page. */
  const wall = $derived(presenting || wallPage);
  const withNames = $derived(!wall && namesShown);
  // Who is who, for the admin view's names (lib/participant-names.js, as on the Results rows); none at all on the wall, or with names hidden.
  const names = $derived(results && withNames ? namesFor({ tracks: results.tracks, answers: answersOf(results), ...(heldNameSources(results.session.id) ?? {}) }) : null);
  const chartSections = $derived(results ? chartsOf({ sections }, { names }) : []);
  const charts = $derived(new Map(chartSections.flatMap((section) => section.charts.map((chart) => [chart.id, chart]))));
  // Who, if some saved answers could not be read: by the name on their visit, else the visit id. On the wall, how many and nothing else.
  const unreadableText = $derived.by(() => {
    if (!results || !(results.unreadable ?? []).length) return '';
    if (wall) {
      const count = results.unreadable?.length ?? 0;
      return `${count} ${count === 1 ? "participant's" : "participants'"} answers could not be read and are not counted. ${UNREADABLE_FIX}`;
    }
    return unreadableNotice(results.unreadable, namesByVisit(results.tracks.map((track) => ({ id: track.id, name: track.participantName ?? '' }))));
  });
  const at = $derived.by(() => {
    const found = questions.findIndex((question) => question.id === shownId);
    return found >= 0 ? found : Math.min(shownAt, Math.max(0, count - 1));
  });
  const current = $derived(questions[at]);
  /** The question on screen, by its id: a refresh hands the page new objects for the same question, and the effects below must not take that for a
   *  new question (Phase 11a-2: each refresh put the type back to full size and, once the screen could scroll, the screen back to its top). */
  const currentId = $derived(current?.id ?? '');
  const currentChart = $derived(current ? charts.get(current.id) ?? null : null);
  const currentTitle = $derived(sections.find((section) => section.questions.some((question) => question.id === current?.id))?.title ?? '');
  // The type, and the steps that make it smaller for a card that does not fit, are lib/present-fit.js (Phase 11a-3): never below SMALLEST, and past
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
    const next = (at + step + count) % count;
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
    if (event.key === 'Escape') leave();
    else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      go(event.key === 'ArrowRight' ? 1 : -1);
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
      presentScale = Math.round(Math.min(2.4, Math.max(1.2, window.innerWidth / 1000)) * 20) / 20;
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
      if (kind === 'csv') fileName = downloadCsv(current);
      else {
        const [loaded] = await Promise.all([
          loadBrand({ state: { clientId: current.session.clientId }, sessionId: current.session.id }),
          loadLibraries(),
        ]);
        const exportBrand = { ...(await withStoredColours(loaded)), appName: APP_NAME };
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
  <header class="live__head">
    <div class="live__brand">
      {#if brand.logoUrl && failedLogo !== brand.logoUrl}<span class="live__logo"><img src={brand.logoUrl} alt={brand.name} onerror={() => { failedLogo = brand.logoUrl ?? ''; }} /></span>{/if}
      <strong class="live__client">{structure ? brand.name : APP_NAME}</strong>
    </div>
    <div class="live__title">
      <h2>Live results{wallPage ? ' · Wall display' : ''}</h2>
      <p class="live__meta" aria-live="off">{results ? `${answersFrom(answered)} · updated ${updated}` : message}</p>
    </div>
    <div class="live__actions">
      {#if phase === 'display' && !presenting}
        <button class="btn btn--primary" type="button" onclick={() => void exportCurrent('csv')} disabled={!!exporting}>{exporting === 'csv' ? 'Exporting...' : 'Export CSV'}</button>
        <button class="btn" type="button" onclick={() => void exportCurrent('pdf')} disabled={!!exporting}>{exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}</button>
        <button class="btn" type="button" onclick={() => void exportCurrent('pptx')} disabled={!!exporting}>{exporting === 'pptx' ? 'Exporting...' : 'Export PPT'}</button>
        <button class="btn" type="button" onclick={refreshStructure} title="Read the questions and answers again now">Refresh</button>
        <a class="btn" href={newTabAddress} target="_blank" rel="noopener" title="The wall display: the charts with no names">Open in a new tab</a>
        <button class="btn btn--primary" type="button" onclick={() => void enter()}>Full screen</button>
      {/if}
      {#if presenting}
        <button class="btn live__exit" type="button" onclick={() => leave()}>Exit full screen</button>
      {:else}
        <button class="btn" type="button" onclick={onBack}>← Results</button>
      {/if}
    </div>
  </header>

  {#if phase === 'display'}
    {#if message}<p class="live__status" role="status">{message}</p>{/if}
    {#if unreadableText}<p class="notice live__unreadable" role="status" data-testid="unreadable-notice"><strong>{unreadableText}</strong></p>{/if}
    {#if exportMessage && !presenting}<p class="live__status" role="status">{exportMessage}</p>{/if}
    {#if !wall}
      <div class="live__names">
        <button class="btn live__auto" type="button" role="switch" aria-checked={namesShown} onclick={() => { namesShown = !namesShown; }}>Names shown <span class="live__auto-state" aria-hidden="true">{namesShown ? 'On' : 'Off'}</span></button>
        <span class="live__names-note">{namesShown ? 'Press a bar to see who picked it. Hide the names before you share this screen.' : 'Names are hidden.'}</span>
      </div>
    {/if}
    {#if presenting}
      <div class="live__stage" bind:this={stage}>
        {#if current}
          <p class="live__eyebrow">{currentTitle ? `${currentTitle} · ` : ''}Question {at + 1} of {count}</p>
          {#key current.id}
            {#if currentChart}<ResultCard chart={currentChart} wall marked={!!revealed[currentChart.id]} onToggleAnswer={() => toggleAnswer(current.id)} selected={selected[current.id] ?? null} onSelect={(id) => select(current.id, id)} {scale} fit {spill} level={3} />{/if}
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
            <button class="btn" type="button" aria-label="Previous question" onclick={() => go(-1)} disabled={count < 2}>← Previous</button>
            <button class="btn" type="button" aria-label="Next question" onclick={() => go(1)} disabled={count < 2}>Next →</button>
            <button class="btn live__auto" type="button" role="switch" aria-checked={autoAdvance} onclick={() => { autoAdvance = !autoAdvance; }} disabled={count < 2}>Auto-advance every 15 s <span class="live__auto-state" aria-hidden="true">{autoAdvance ? 'On' : 'Off'}</span></button>
          </div>
        </div>
      {/if}
    {:else}
      {#if questions.length === 0}<p class="live__status">This session has no live questions yet.</p>{/if}
      <div class="live__sections">
        {#each chartSections as section (section.id)}
          <section class="live-section">
            <h3 class="live-section__title">{section.title}</h3>
            <div class="live-section__grid">
              {#each section.charts as chart (chart.id)}
                <ResultCard {chart} {wall} {withNames} marked={!wall || !!revealed[chart.id]} onToggleAnswer={() => toggleAnswer(chart.id)} selected={selected[chart.id] ?? null} onSelect={(id) => select(chart.id, id)} {scale} level={4} />
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  {:else if phase === 'picker'}
    <p class="live__status" role="status">{message}</p>
    {#if sessions.length}
      <ul class="live__picker">
        {#each sessions as session (session.id)}
          <li><button class="btn" type="button" onclick={() => onOpen(session.id)}>{clients.find((client) => client.id === session.clientId)?.name ?? session.clientId} · {session.date ?? ''} · {session.status ?? ''}</button></li>
        {/each}
      </ul>
    {/if}
  {:else if phase === 'loading'}
    <p class="live__status" role="status">Loading results...</p>
  {:else}
    <p class="live__status live__status--error" role="alert">{message}</p>
    <div class="live__actions"><button class="btn" type="button" onclick={() => location.reload()}>Try again</button></div>
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
    border-bottom: 3px solid var(--brand-primary);
  }

  .live__brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .live__logo {
    display: inline-flex;
    padding: 0.35rem 0.6rem;
    background: #fff;
    border: 1px solid var(--adm-line);
    border-radius: 0.6rem;
  }

  /* A definite height, so that a picture with only a viewBox (an SVG logo) still gets a width from its shape. */
  .live__logo img {
    display: block;
    width: auto;
    max-width: 12rem;
    height: 2.5rem;
    object-fit: contain;
  }

  .live__client {
    font-size: 1.1rem;
  }

  .live__title {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .live__title h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .live__meta {
    margin: 0.15rem 0 0;
    color: var(--adm-muted);
  }

  .live__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .live__status {
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.5rem;
  }

  .live__status--error {
    color: var(--adm-bad-ink);
    background: var(--adm-bad-bg);
    border-color: var(--adm-bad-line);
  }

  .live__picker {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .live__names {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .live__names-note {
    color: var(--adm-muted);
  }

  .live__sections {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .live-section__title {
    margin: 0 0 0.75rem;
    font-size: 1.3rem;
    color: var(--adm-ink);
  }

  /* Each card keeps its own height, at the top of its row (Phase 11a-2: a card stretched to the height of its neighbour whose names were open). */
  .live-section__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    align-items: start;
    gap: 1.25rem;
  }

  /* The way out is shown in full screen, and fades (and the pointer hides) after a few idle seconds; any movement, touch, key or focus brings it back.
     It stays in the page for the keyboard and the screen reader the whole time. */
  .live__exit,
  .live__pager {
    transition: opacity 160ms ease;
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
    color: #fff;
    background: linear-gradient(180deg, #000102 0%, color-mix(in srgb, var(--brand-primary) 72%, #000102) 100%);
  }

  .live--present .live__head {
    flex: 0 0 auto;
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
  .live--present.live--spill {
    overflow-y: auto;
  }

  .live--spill .live__stage {
    flex: 0 0 auto;
  }

  /* Solid, so that the card's words do not show through behind the controls, and down to the screen's edge (a sticky box keeps clear of its scroller's
     padding unless told otherwise). */
  .live--spill .live__foot {
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

  .live--present[data-idle='true'] {
    cursor: none;
  }

  .live--present[data-idle='true'] .live__exit:not(:focus-visible),
  .live--present[data-idle='true'] .live__pager:not(:has(:focus-visible)) {
    opacity: 0;
  }

  .live--present .live__head {
    border-bottom-color: rgb(255 255 255 / 0.55);
  }

  .live--present .live__client {
    font-size: calc(1.1rem * var(--chart-scale, 1));
  }

  .live--present .live__logo img {
    height: calc(2.5rem * var(--chart-scale, 1));
    max-width: calc(12rem * var(--chart-scale, 1));
  }

  .live--present .live__title h2 {
    font-size: calc(1.4rem * var(--chart-scale, 1));
  }

  .live--present .live__meta {
    color: rgb(255 255 255 / 0.92);
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .live--present .live__status {
    color: var(--adm-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  @media (prefers-reduced-motion: reduce) {
    .live__exit,
    .live__pager { transition: none; }
  }
</style>
