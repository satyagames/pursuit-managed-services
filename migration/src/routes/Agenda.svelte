<script module lang="ts">
  // The hub the guest last saw, by visit (Prompt 24). Here, not in the component, because the hub is a new component each time the guest returns to
  // it; in memory, not stored, so a reload plays nothing.
  const lastHub = new Map<string, { id: string; title?: string; state: 'done' | 'progress' | 'ready' | 'locked'; total?: number }[]>();
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { ActionBar, ActivityPill, Divider, HomeButton, PillButton, ProgressBar } from '../components/index.js';
  import type { ActivityState } from '../components/index.js';
  import { LOADING_DELAY_MS } from '../lib/participant/activity-content.js';
  import { experience, holdsActivities, refreshActivities } from '../lib/participant/experience.svelte.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { consumeNavigationData, navigateTo } from '../lib/participant/navigation.js';
  import { activityStates } from '../lib/participant/pager-logic.js';
  import { getKnownProgress, loadFailure, visitStep, visitStepPath } from '../lib/participant/participantData.js';
  import { participant } from '../lib/participant/session.svelte.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { motion, motionLevel, watchMoment } from '../lib/motion/motion.js';
  import { TOKENS } from '../lib/motion/motion-plan.js';
  import { clearEffects, hubAllDone, hubJourney, hubLocked, hubStamp, hubUnlock } from '../lib/effects/effects.js';
  import {
    BEAT_LENGTH, LOCKED_LINE, SHAKE_LENGTH, WATCH_AT, beatEnd, heldLooks, hubCount, hubMoment, lockedTapAllowed, momentAnnouncement, type Beat,
  } from '../lib/participant/hub-moment-plan.js';

  // The route is #/agenda; the screen is the Activities hub.
  type Pill = { id: string; title: string; state: ActivityState; answered?: number; total?: number; next?: boolean };
  type Moment = 'stamp' | 'unlock' | 'pulse' | 'wave' | 'shake' | 'fade';
  // `preview` draws the hub from a draft (Brand Studio): the given pills and words, no reads, no buttons that act.
  let { preview = null }: { preview?: { pills: Pill[]; eventTitle: string; eventSubtitle: string; clientName: string; allDone?: boolean; go?: (path: string) => void } | null } = $props();

  let heading = $state<HTMLElement>();
  let fetched = $state<Pill[]>([]);
  let fetchedAllDone = $state(false);
  /** An any-order session with the confidence check (Phase 20): Finish asks After whenever the guest is ready, not only once all is done. */
  let finishEarly = $state(false);
  let fetching = $state(true);
  /** The loading line waits LOADING_DELAY_MS (Phase 10j): a quick read does not flash one. */
  let slow = $state(false);
  let error = $state('');
  let tryAgain: () => void = () => {};
  const pills = $derived(preview ? preview.pills : fetched);
  const allDone = $derived(preview ? preview.allDone === true : fetchedAllDone);
  const loading = $derived(fetching && !preview);
  const handoff = consumeNavigationData();
  const answeredSnapshot = handoff?.sessionId === participant.sessionId
    && handoff?.clientTrackId === participant.clientTrackId
    ? handoff.answeredQuestionIds ?? null : null;

  // The client's own event copy (its theme's eventTitle / eventSubtitle) wins; without it the client's name and a plain prompt.
  const title = $derived(preview ? preview.eventTitle || preview.clientName : experience.eventTitle || experience.clientName);
  const subtitle = $derived((preview ? preview.eventSubtitle : experience.eventSubtitle) || 'Choose an activity to get started.');
  const go = (path: string) => { if (preview) preview.go?.(path); else void navigateTo(path); };

  type Progress = Awaited<ReturnType<typeof getKnownProgress>>;

  // ---- The moment (Prompt 24): lib/participant/hub-moment-plan.js decides, this carries it out. Nothing waits for it: every pill can be tapped
  // throughout, and what a pill does and says is its real state from the first frame; only its paint waits for its beat. No timer outlives the screen.
  let held = $state<Record<string, ActivityState>>({});
  let fromLook = $state<Record<string, ActivityState>>({});
  let moments = $state<Record<string, Moment>>({});
  /** A pill whose stretch of the journey line is growing, and those that have not been reached yet. */
  let growing = $state<Record<string, boolean>>({});
  let lineHeld = $state<Record<string, boolean>>({});
  let finishMoves = $state(false);
  let announcement = $state('');
  let timers: ReturnType<typeof setTimeout>[] = [];
  let moving = false;
  let lastLockedTap: number | null = null;
  const anchorOf = (id: string | null) => (id === null ? null : document.querySelector(`[data-pill-id="${CSS.escape(id)}"] [data-hub-anchor]`));
  const later = (at: number, act: () => void) => { timers.push(setTimeout(act, at)); };

  /** Ends whatever is left of the moment, at the finished look. */
  function stopMoment() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    held = {}; fromLook = {}; moments = {}; growing = {}; lineHeld = {}; finishMoves = false;
    if (moving) clearEffects();
    moving = false;
  }

  const setMoment = (id: string, moment: Moment, length: number) => {
    moments = { ...moments, [id]: moment };
    later(length, () => { if (moments[id] === moment) { const { [id]: _gone, ...rest } = moments; moments = rest; } });
  };

  function playMoment(next: Pill[]) {
    if (preview) return;
    const before = lastHub.get(participant.clientTrackId!) ?? null;
    lastHub.set(participant.clientTrackId!, next);
    const level = motionLevel();
    const beats = document.hidden ? [] : hubMoment(before, next, { level });
    if (!beats.length) return;
    stopMoment();
    moving = true;
    announcement = momentAnnouncement(before, next, beats);
    const looks = heldLooks(before, beats);
    if (level !== 'none') {
      held = Object.fromEntries(looks);
      lineHeld = Object.fromEntries(beats.filter((beat) => beat.kind === 'stamp').map((beat) => [beat.id!, true]));
    }
    later(WATCH_AT, watchMoment);
    for (const beat of beats) later(beat.at, () => runBeat(beat, looks, level));
    later(Math.max(...beats.map(beatEnd)), () => { moving = false; });
  }

  function runBeat(beat: Beat, looks: Map<string, ActivityState>, level: string) {
    const id = beat.id!;
    const release = () => {
      const { [id]: _gone, ...rest } = held;
      held = rest;
      if (level === 'none') return;
      fromLook = { ...fromLook, [id]: looks.get(id)! };
      setMoment(id, level === 'full' ? beat.kind as Moment : 'fade', level === 'full' ? BEAT_LENGTH[beat.kind] : TOKENS.hub.fade);
      later(level === 'full' ? BEAT_LENGTH[beat.kind] : TOKENS.hub.fade, () => { const { [id]: _done, ...others } = fromLook; fromLook = others; });
    };
    if (beat.kind === 'stamp') {
      release();
      if (level !== 'full') { const { [id]: _line, ...lines } = lineHeld; lineHeld = lines; }
      // (After the paint, so the badge it comes from is there.)
      requestAnimationFrame(() => hubStamp(anchorOf(id)));
    } else if (beat.kind === 'journey') {
      const { [id]: _line, ...lines } = lineHeld;
      lineHeld = lines;
      growing = { ...growing, [id]: true };
      hubJourney();
      later(BEAT_LENGTH.journey, () => { const { [id]: _grown, ...rest } = growing; growing = rest; });
    } else if (beat.kind === 'unlock') {
      const lock = anchorOf(id);
      release();
      hubUnlock(lock);
    } else if (beat.kind === 'pulse') {
      setMoment(id, 'pulse', BEAT_LENGTH.pulse);
    } else if (beat.kind === 'wave') {
      setMoment(id, 'wave', BEAT_LENGTH.wave);
    } else {
      finishMoves = level === 'full';
      hubAllDone(document.querySelector('[data-hub-finish]'));
    }
  }

  function lockedTap(id: string) {
    if (preview) return;
    const now = performance.now();
    if (!lockedTapAllowed(lastLockedTap, now)) return;
    lastLockedTap = now;
    // (The same words again would not be read: the line is made different by a space that is not heard.)
    announcement = announcement === LOCKED_LINE ? `${LOCKED_LINE} ` : LOCKED_LINE;
    hubLocked();
    if (motionLevel() === 'full') setMoment(id, 'shake', SHAKE_LENGTH);
  }

  const count = $derived(hubCount(pills));
  onDestroy(stopMoment);

  /** Draws the hub from what was read (or from what the page's timer last found). */
  function show(progress: Progress) {
    const next = activityStates(progress.sections, experience.activityFlow).map((section) => ({ id: section.id, title: section.title, state: section.state, answered: section.answered, total: section.total, next: section.next }));
    if (JSON.stringify(next) !== JSON.stringify(fetched)) fetched = next;
    playMoment(next);
    // An activity with no questions can never be finished, so it must not keep the finale away.
    const needed = progress.sections.filter((section) => (section.questionIds ?? []).length > 0);
    fetchedAllDone = needed.length > 0 && needed.every((section) => section.complete);
    finishEarly = experience.activityFlow === 'open' && visitStep({ allDone: fetchedAllDone, finishing: true }) === 'check-out';
    fetching = false;
  }

  // The hub is drawn at once from what the page holds (Phase 10j): the activities, and this visit's own answers on the device. Then it reads
  // the activities again, with the enabled ones' questions and options (ONE request where the site can batch: experience.refreshActivities),
  // and is drawn again if anything changed; an activity then opens from what was read. It does not poll: the page's timer (App.svelte, one
  // request for everything it checks) reports a change in the activities or in the session's flow by raising experience.activitiesVersion,
  // and the hub then redraws from what the timer found, reading nothing.
  let seenVersion = experience.activitiesVersion;
  $effect(() => {
    const version = experience.activitiesVersion;
    if (preview || version === seenVersion) return;
    seenVersion = version;
    untrack(() => {
      void getKnownProgress(participant.sessionId!, participant.clientTrackId!).then(show).catch((cause) => {
        console.warn('Could not redraw the activities from what the page last checked.', cause);
      });
    });
  });

  onMount(() => {
    if (preview) return;
    // A new screen: say so. A screen reader reads the heading, and the Tab key carries on from it (the ring shows only for the keyboard).
    focusHeading(heading);
    let active = true;
    const sessionId = participant.sessionId;
    const trackId = participant.clientTrackId;
    const timer = window.setTimeout(() => { slow = true; }, LOADING_DELAY_MS);

    /** Draws what the page holds: no request. */
    const draw = async () => { const progress = await getKnownProgress(sessionId!, trackId!, answeredSnapshot); if (active) show(progress); };

    async function load() {
      error = '';
      try {
        // (Every activity done: none is left to open, so its content is not read again.)
        const changed = await refreshActivities({ withContent: !(fetchedAllDone && !fetching) });
        if (active && (changed || fetching)) await draw();
      } catch (cause) {
        // With activities on the screen the hub keeps them (they are what the page holds); with nothing to show it says why, with Try again.
        if (!active) return;
        if (fetching) {
          fetching = false;
          error = loadFailure(cause, 'Could not load your activities.');
        } else console.warn('Could not read the activities again; the hub shows what the page holds.', cause);
      }
    }
    // "Try again" reads the activities again, here. (It used to reload the whole page, which with no connection puts the browser's own error in its place.)
    tryAgain = () => { fetching = true; void load(); };

    if (!sessionId || !trackId) {
      void navigateTo('/welcome', true);
      return () => { window.clearTimeout(timer); };
    }
    // (Phase 20: the confidence check's Before comes first, and cannot be skipped by opening the hub.)
    if (visitStep() === 'check-in') {
      void navigateTo('/check-in', true);
      return () => { window.clearTimeout(timer); };
    }

    // (Drawing what is held reads nothing, unless this visit's answers were never read on this page: if that read fails, the read behind it
    // still runs, and says why with Try again when there is nothing to show.)
    if (holdsActivities()) void draw().catch(() => {}).finally(() => { void load(); });
    else void load();
    return () => { active = false; window.clearTimeout(timer); };
  });
</script>

<svelte:head>{#if !preview}<title>Activities | {APP_NAME}</title>{/if}</svelte:head>

<section class="pms-hub" aria-busy={loading}>
  <header class="pms-head" use:motion={{ role: 'title', count: pills.length }}>
    <h1 class="pms-title" bind:this={heading} tabindex="-1">{title}</h1>
    <p class="pms-description">{subtitle}</p>
  </header>
  <Divider motion={{ role: 'rule', count: pills.length }} />

  {#if loading && slow}
    <p class="pms-status" role="status">Loading activities...</p>
  {:else if loading}
    <!-- (Nothing for the first moment of a wait: a quick read does not flash a line.) -->
  {:else if error}
    <p class="pms-alert" role="alert">{error}</p>
    <div class="pms-row"><PillButton onclick={() => tryAgain()}>Try again</PillButton></div>
  {:else if pills.length === 0}
    <p class="pms-status">There are no activities available right now.</p>
  {:else}
    {#if count.total > 0}
      <div class="pms-count">
        <strong>{count.done} of {count.total} complete</strong>
        <ProgressBar value={count.done} max={count.total} label="Activities complete" />
      </div>
    {/if}
    <ul class="pms-activities">
      {#each pills as pill, at (pill.id)}
        <li
          data-pill-id={pill.id}
          data-line={(held[pill.id] ?? pill.state) === 'done' && !lineHeld[pill.id] ? 'done' : 'ahead'}
          data-grow={growing[pill.id] ? 'true' : undefined}
          use:motion={{ role: 'item', index: at, count: pills.length }}
        ><ActivityPill
          label={pill.title} state={pill.state} look={held[pill.id]} from={fromLook[pill.id] ?? null} moment={moments[pill.id] ?? null}
          answered={pill.answered ?? 0} total={pill.total ?? 0} next={pill.next ?? false}
          onlockedtap={() => lockedTap(pill.id)} onclick={() => go(`/quiz/${pill.id}`)}
        /></li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" aria-live="polite">{announcement}</p>

  <ActionBar sticky={false}>
    {#if allDone || finishEarly}<PillButton data-hub-finish="" data-moves={finishMoves ? 'true' : undefined} onclick={() => go(preview ? '/thank-you' : visitStepPath({ allDone, finishing: true }))}>Finish</PillButton>{/if}
    <HomeButton onclick={() => go('/welcome')} />
  </ActionBar>
</section>

<style>
  .pms-hub {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .pms-head {
    display: grid;
    gap: 0.75rem;
  }

  .pms-title {
    margin: 0;
    font: italic var(--fw-extrabold) var(--fs-title) / 1.1 var(--font-sans);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }

  .pms-description {
    margin: 0;
    font: var(--fw-light) var(--fs-description) / 1.45 var(--font-sans);
  }

  .pms-activities {
    display: grid;
    gap: var(--gap);
    margin: clamp(0.5rem, 2vw, 1.25rem) 0 0;
    padding: 0;
    list-style: none;
  }

  .pms-count {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    margin-top: clamp(0.5rem, 2vw, 1.25rem);
    font: var(--fw-regular) var(--fs-body) / 1.3 var(--font-sans);
  }

  /* The journey line: one stretch in the gap below each pill, behind nothing and in no one's way. Grey where not reached, green where done. */
  .pms-activities li {
    position: relative;
  }

  .pms-activities li:not(:last-child)::after {
    position: absolute;
    top: 100%;
    left: clamp(1.5rem, 6vw, 2.5rem);
    width: 3px;
    height: var(--gap);
    content: '';
    background: rgb(255 255 255 / 0.4);
    transform-origin: 50% 0;
  }

  .pms-activities li[data-line='done']:not(:last-child)::after {
    background: var(--progress);
  }

  .pms-activities li[data-grow]:not(:last-child)::after {
    animation: hub-journey var(--motion-hub-journey) var(--motion-ease-enter) backwards;
  }

  .pms-hub :global([data-hub-finish][data-moves]) {
    animation: hub-finish var(--motion-duration-base) var(--motion-ease-pop) backwards;
  }

  @keyframes hub-journey { from { transform: scaleY(0); } }
  @keyframes hub-finish {
    from { opacity: 0; transform: translateY(0.75rem); }
    70% { opacity: 1; transform: scale(1.04); }
  }

  @media (prefers-reduced-motion: reduce) {
    .pms-activities li::after, .pms-hub :global([data-hub-finish]) { animation: none !important; }
  }

  .pms-status {
    margin: 0;
    font: var(--fw-regular) var(--fs-body) / 1.45 var(--font-sans);
  }

  .pms-row {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }

  .pms-alert {
    margin: 0;
    padding: 0.75rem 1rem;
    color: var(--on-plate);
    font: var(--fw-semibold) var(--fs-body) / 1.4 var(--font-sans);
    background: var(--plate);
    border-left: 6px solid var(--danger);
    border-radius: 0.5rem;
  }
</style>
