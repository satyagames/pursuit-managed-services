<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { HomeButton, PillButton } from '../components/index.js';
  import { clearEffects, finale } from '../lib/effects/effects.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { consumeNavigationData, navigateTo } from '../lib/participant/navigation.js';
  import { greetingName } from '../lib/participant/pager-logic.js';
  import { checkAnswer, discardPendingAnswers, firstTrySummary, getProgress, visitStep } from '../lib/participant/participantData.js';
  import { loadActivity, sessionCheck } from '../lib/participant/experience.svelte.js';
  import { clearTrack, participant } from '../lib/participant/session.svelte.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { motion, playFinale } from '../lib/motion/motion.js';
  import { visitRatings } from '../lib/participant/aop-glance.svelte.js';

  // The finale: every activity is finished. Re-checked against the server (a bookmark or a back
  // button must not show it early), unless the pager just handed over what it saved.
  //
  // (Prompt 36) The grand finale: a petal shower from above (lib/effects/), and on this page the hush (a veil behind the content), the medal
  // landing with its rays, rings and check, the name rising in, the cards counting up and the sheen; then "Celebrate again" in
  // the afterglow. What moves when is lib/motion/finale-motion-plan.js, played by motion.ts; the buttons work from the first frame.
  const handoff = consumeNavigationData();
  const ownHandoff = handoff?.sessionId === participant.sessionId && handoff?.clientTrackId === participant.clientTrackId ? handoff : null;

  // `preview` draws the finale from a draft (Brand Studio): the given name and summary, no reads, the final state only (no motion, no sound,
  // no shower), no buttons that act.
  let { preview = null }: { preview?: { name: string; activities: number; score: { right: number; total: number } | null } | null } = $props();

  let fetching = $state(true);
  let fetchedAllowed = $state(false);
  let error = $state('');
  let fetchedActivities = $state(0);
  let fetchedScore = $state<{ right: number; total: number } | null>(null);
  /** The confidence check's two answers (Phase 20), shown only once both exist: how it moved, Before and After. */
  let moved = $state<{ direction: string; before: string; after: string } | null>(null);
  let heading = $state<HTMLElement>();
  let card = $state<HTMLElement>();
  let sweep = $state<HTMLElement>();
  let veil = $state<HTMLElement>();
  let medal = $state<HTMLElement>();
  let rays = $state<HTMLElement>();
  let check = $state<SVGPathElement>();
  let againNode = $state<HTMLElement>();
  let garland = $state<HTMLElement>();
  const rings = $state<HTMLElement[]>([]);
  const cardNodes = $state<HTMLElement[]>([]);
  /** What each card's figure shows while it counts up; its own value otherwise. */
  const shown = $state<(number | undefined)[]>([]);
  /** "Celebrate again" shows in the afterglow (at once below the full motion level, and in a preview). */
  let againShown = $state(false);
  /** The one status line, said once when the finale starts. */
  let announced = $state('');
  /** Lets go of the finale's animations, count-ups and timer. */
  let stop: (() => void) | null = null;
  /** (Prompt 35) The Art of Possibility boxes this guest rated during this visit (lib/participant/aop-glance.svelte.ts). */
  const ratings = $derived(preview ? 0 : Object.values(visitRatings).reduce((sum, each) => sum + each.total, 0));
  let active = false;
  const loading = $derived(fetching && !preview);
  const allowed = $derived(preview ? true : fetchedAllowed);
  const activities = $derived(preview ? preview.activities : fetchedActivities);
  const score = $derived(preview ? preview.score : fetchedScore);
  const go = (path: string) => { if (!preview) void navigateTo(path); };

  const name = $derived(preview ? preview.name : greetingName({
    participantName: participant.participantName,
    sharePointDisplayName: participant.sharePointDisplayName,
    participationMode: participant.activeSession?.participationMode,
    visitorId: participant.visitorId,
  }));

  onMount(() => {
    if (preview) { againShown = true; return; }
    active = true;
    void verifyCompletion();
    return () => {
      active = false;
      stop?.();
      clearEffects(); // the shower does not follow the guest to the next screen
    };
  });

  /**
   * How many graded questions were right first time. Each answer was graded when it was given, so
   * this reads nothing: no activity is fetched again to work the score out. Never blocks the finale.
   */
  async function summarise(questionIds: string[]) {
    try {
      const result = await firstTrySummary(questionIds);
      if (active) fetchedScore = result.total > 0 ? result : null;
    } catch (cause) {
      console.warn('The finale could not work out the score', cause);
    }
  }

  /** "Your confidence moved up", Before and After, each as its number and words. Never blocks the finale. */
  async function describeCheck() {
    try {
      const check = sessionCheck();
      const [before, after] = [checkAnswer('before'), checkAnswer('after')];
      if (!check || !before || !after) return;
      const question = (await loadActivity(check.section.id))?.questions.find((each) => each.id === check.questionId);
      const option = (id: string) => question?.options.find((each) => each.id === id);
      const [from, to] = [option(before), option(after)];
      if (!from || !to || !active) return;
      const [low, high] = [Number(from.value), Number(to.value)];
      moved = {
        direction: high > low ? 'moved up' : high < low ? 'moved down' : 'stayed the same',
        before: `${from.value} ${from.label}`, after: `${to.value} ${to.label}`,
      };
    } catch (cause) {
      console.warn('The finale could not show the confidence check', cause);
    }
  }

  async function verifyCompletion() {
    fetching = true;
    fetchedAllowed = false;
    error = '';
    const sessionId = participant.sessionId;
    const trackId = participant.clientTrackId;
    try {
      if (!sessionId || !trackId) {
        await navigateTo('/welcome', true);
        return;
      }
      const progress = await getProgress(sessionId, trackId, ownHandoff?.answeredQuestionIds ?? null);
      if (!active || participant.sessionId !== sessionId || participant.clientTrackId !== trackId) return;
      const needed = progress.sections.filter((section) => (section.questionIds ?? []).length > 0);
      const allDone = needed.length > 0 && needed.every((section) => section.complete);
      // Thank you once every activity is done; with the confidence check (Phase 20), once After is given (or the session has ended).
      const step = visitStep({ allDone, finishing: true });
      if (step !== 'thank-you') {
        await navigateTo(step === 'check-out' ? '/check-out' : '/agenda', true);
        return;
      }
      fetchedActivities = needed.filter((section) => section.complete).length;
      await describeCheck();
      await summarise(needed.flatMap((section) => section.questionIds ?? []));
      if (!active) return;
      fetchedAllowed = true;
      fetching = false;
      await tick();
      if (!active) return;
      focusHeading(heading);
      celebrate(false);
      announced = `All activities done. ${headline}`;
    } catch (cause) {
      if (active) error = 'Could not check your progress. Your saved answers are safe. Please try again.';
      console.error('Thank-you progress check failed', cause);
    } finally {
      if (active) fetching = false;
    }
  }

  /** The finale's sound, shower and acts, from the top. Pressing "Celebrate again" keeps the button where it is (and focused). */
  function celebrate(again: boolean) {
    stop?.();
    finale();
    stop = playFinale(
      { veil, medal, ray: rays, check, ring: rings, name: heading, card: cardNodes, sheen: sweep, again: again ? null : againNode, garland },
      {
        counts: cards.map((each) => each.value),
        width: (card?.getBoundingClientRect().width ?? 0) + 120,
        onCount: (index, value) => { shown[index] = value; },
        onAfterglow: () => { againShown = true; },
      },
    );
  }

  // "Start over" is for testers only (index.html?debug=1). A participant's record is theirs for the
  // day, and the finale gives them no way to begin a second one or to walk away from the first.
  const debug = (() => {
    const flag = (query: string) => new URLSearchParams(query).get('debug') === '1';
    return flag(window.location.search) || flag(window.location.hash.split('?')[1] ?? '');
  })();

  /** Testers: leaves this visit (its saved record stays as it is) and returns to Welcome to begin another. */
  function startOver() {
    discardPendingAnswers();
    clearTrack();
    void navigateTo('/welcome');
  }

  const headline = $derived(name ? `Thank you, ${name}!` : 'Thank you!');

  /** The cards, in the brief's order: activities finished, ratings given, right first try; each only when the app has it. */
  const cards = $derived([
    { key: 'activities', value: activities, label: activities === 1 ? 'activity completed' : 'activities completed' },
    ...(ratings > 0 ? [{ key: 'ratings', value: ratings, label: ratings === 1 ? 'rating' : 'ratings' }] : []),
    ...(score ? [{ key: 'score', value: score.right, label: `of ${score.total} right on the first try` }] : []),
  ]);

</script>

<svelte:head>{#if !preview}<title>Thank you | {APP_NAME}</title>{/if}</svelte:head>

{#if loading}
  <p class="pms-status" role="status">Checking your progress...</p>
{:else if error}
  <section class="pms-final" role="alert" use:motion={{ role: 'card' }}>
    <h1>Could not check progress</h1>
    <p class="pms-line">{error}</p>
    <div class="pms-actions">
      <PillButton onclick={() => void verifyCompletion()}>Try again</PillButton>
      <PillButton variant="secondary" onclick={() => go('/agenda')}>Back to activities</PillButton>
    </div>
  </section>
{:else if allowed}
  <section class="pms-final" bind:this={card} use:motion={{ role: 'card' }}>
    <span class="pms-veil" bind:this={veil} aria-hidden="true"></span>
    <span class="pms-sweep" bind:this={sweep} aria-hidden="true"></span>
    <span class="pms-garland" class:pms-still={preview} bind:this={garland} aria-hidden="true"></span>
    {#if !preview}<p class="sr-only" role="status">{announced}</p>{/if}
    <span class="pms-medal-wrap" aria-hidden="true">
      {#each [0, 1, 2] as ring (ring)}<span class="pms-ring" bind:this={rings[ring]}></span>{/each}
      <span class="pms-rays" bind:this={rays}></span>
      <span class="pms-medal" bind:this={medal}>
        <svg viewBox="0 0 24 24" width="55%" height="55%" focusable="false">
          <path bind:this={check} pathLength="1" d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </span>
    <h1 bind:this={heading} tabindex="-1">{headline}</h1>
    <p class="pms-line">Your responses have been recorded.</p>
    {#if ratings > 0}<p class="pms-line">Your ratings are in.</p>{/if}
    <ul class="pms-cards">
      {#each cards as item, index (item.key)}
        <li class="pms-card" bind:this={cardNodes[index]}><span class="pms-figure">{shown[index] ?? item.value}</span>{' '}<span class="pms-label">{item.label}</span></li>
      {/each}
    </ul>
    {#if moved}
      <div class="pms-moved">
        <p class="pms-moved-head">Your confidence {moved.direction}</p>
        <p>Before: {moved.before}</p>
        <p>After: {moved.after}</p>
      </div>
    {/if}
    <div class="pms-actions">
      {#if debug && !preview}<PillButton variant="secondary" size="md" onclick={startOver}>Start over</PillButton>{/if}
      <span class="pms-again" class:pms-again-shown={againShown} bind:this={againNode}>
        <PillButton variant="secondary" size="md" onclick={() => { if (!preview) celebrate(true); }}>Celebrate again</PillButton>
      </span>
      <HomeButton onclick={() => go('/welcome')} />
    </div>
  </section>
{/if}

<style>
  /* (Prompt 35) One light sweep across the card (motion.ts; at the full level only). */
  .pms-sweep {
    position: absolute;
    inset: 0 auto 0 0;
    width: 120px;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.12), transparent);
    opacity: 0;
    pointer-events: none;
  }

  /* (Prompt 36) The hush: the plate dims behind the content (never over it, never over a button) so the colour reads as light. Opacity only. */
  .pms-veil {
    position: absolute;
    inset: -10%;
    z-index: -1;
    /* Soft-edged, so it reads as the plate dimming, not as a dark panel. */
    background: radial-gradient(ellipse at 50% 42%, #000000 35%, rgb(0 0 0 / 0) 72%);
    opacity: 0;
    pointer-events: none;
  }

  /* (Prompt 36) The reduced level's garland: petals in three colours along the top edge, drawn once by the CSS (shown by motion.ts, still in a
     preview). */
  .pms-garland {
    position: absolute;
    inset: 0 0 auto;
    height: 3rem;
    background:
      radial-gradient(0.3rem 0.6rem at 20% 40%, #cfe4a8 90%, #0000) 0 0 / 4.5rem 3rem,
      radial-gradient(0.3rem 0.6rem at 60% 60%, #ffe9a8 90%, #0000) 0 0 / 5.5rem 3rem,
      radial-gradient(0.25rem 0.5rem at 40% 30%, #fff 90%, #0000) 0 0 / 3.5rem 3rem;
    opacity: 0;
  }

  .pms-still {
    opacity: 1;
  }

  .pms-final {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(1rem, 3vw, 1.5rem);
    text-align: center;
  }

  /* The medal: the lime disc with its check, the sixteen rays round it and the three rings that spread from it; none of it takes room of its own. */
  .pms-medal-wrap {
    position: relative;
    display: inline-flex;
    flex: none;
    width: clamp(6rem, min(26vw, 18dvh), 9rem);
    aspect-ratio: 1;
  }

  .pms-medal {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #0b1d00; /* the medal's ink on the lime: 7.8:1 (scripts/test-participant-contrast.js) */
    background: #86bc25;
    border-radius: 50%;
    box-shadow: 0 0 0 0.6rem rgb(134 188 37 / 0.25), 0 0.5rem 2rem rgb(0 1 2 / 0.35);
  }

  .pms-medal path {
    stroke-dasharray: 1;
    stroke-dashoffset: 0;
  }

  /* The sixteen rays: thin wedges of one conic gradient, cut to a band round the medal. */
  .pms-rays {
    position: absolute;
    inset: -40%;
    background: repeating-conic-gradient(#c9e39b 0 3deg, transparent 0 22.5deg);
    mask: radial-gradient(closest-side, transparent 66%, #000 0 90%, transparent 0);
    opacity: 0.55;
  }

  .pms-ring {
    position: absolute;
    inset: 0;
    border: 3px solid #c9e39b;
    border-radius: 50%;
    opacity: 0;
  }

  h1 {
    margin: 0;
    font: normal var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
    overflow-wrap: anywhere;
  }


  .pms-line,
  .pms-status {
    margin: 0;
    font: var(--fw-regular) var(--fs-description) / 1.4 var(--font-sans);
  }

  /* The numbers: white cards, the figure large; each is one line of real text ("3 of 3 right on the first try"). */
  .pms-cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: clamp(0.6rem, 2vw, 1rem);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pms-card {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    min-width: 9rem;
    max-width: 14rem;
    padding: 0.8rem 1.1rem;
    color: #1a1a1a;
    background: #ffffff;
    border-radius: var(--pill-radius);
    box-shadow: 0 0.4rem 1.4rem rgb(0 1 2 / 0.25);
    font: var(--fw-semibold) var(--fs-body) / 1.3 var(--font-sans);
  }

  .pms-figure {
    font: var(--fw-bold) clamp(1.75rem, 5vw, 2.5rem) / 1.1 var(--font-sans);
    font-variant-numeric: tabular-nums;
  }

  .pms-moved {
    display: grid;
    gap: 0.25rem;
    padding: 0.9rem 1.25rem;
    font: var(--fw-regular) var(--fs-body) / 1.4 var(--font-sans);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--pill-radius);
  }

  .pms-moved p {
    margin: 0;
  }

  .pms-moved-head {
    font-weight: var(--fw-bold);
  }

  .pms-actions {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: clamp(0.75rem, 2.4vw, 1.25rem);
    margin-top: clamp(0.5rem, 3vw, 1.5rem);
  }

  /* "Celebrate again" keeps its place from the first frame (no layout shift) and shows in the afterglow. */
  .pms-again {
    display: inline-flex;
    visibility: hidden;
  }

  .pms-again-shown {
    visibility: visible;
  }
</style>
