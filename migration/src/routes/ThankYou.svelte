<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { CheckBadge, HomeButton, PillButton } from '../components/index.js';
  import { finale } from '../lib/effects/effects.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { consumeNavigationData, navigateTo } from '../lib/participant/navigation.js';
  import { greetingName } from '../lib/participant/pager-logic.js';
  import { checkAnswer, discardPendingAnswers, firstTrySummary, getProgress, visitStep } from '../lib/participant/participantData.js';
  import { loadActivity, sessionCheck } from '../lib/participant/experience.svelte.js';
  import { clearTrack, participant } from '../lib/participant/session.svelte.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { motion } from '../lib/motion/motion.js';

  // The finale: every activity is finished. Re-checked against the server (a bookmark or a back
  // button must not show it early), unless the pager just handed over what it saved.
  const handoff = consumeNavigationData();
  const ownHandoff = handoff?.sessionId === participant.sessionId && handoff?.clientTrackId === participant.clientTrackId ? handoff : null;

  // `preview` draws the finale from a draft (Brand Studio): the given name and summary, no reads, no confetti, no buttons that act.
  let { preview = null }: { preview?: { name: string; activities: number; score: { right: number; total: number } | null } | null } = $props();

  let fetching = $state(true);
  let fetchedAllowed = $state(false);
  let error = $state('');
  let fetchedActivities = $state(0);
  let fetchedScore = $state<{ right: number; total: number } | null>(null);
  /** The confidence check's two answers (Phase 20), shown only once both exist: how it moved, Before and After. */
  let moved = $state<{ direction: string; before: string; after: string } | null>(null);
  let heading = $state<HTMLElement>();
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
    if (preview) return;
    active = true;
    void verifyCompletion();
    return () => { active = false; };
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
      finale();
    } catch (cause) {
      if (active) error = 'Could not check your progress. Your saved answers are safe. Please try again.';
      console.error('Thank-you progress check failed', cause);
    } finally {
      if (active) fetching = false;
    }
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
  <section class="pms-final" use:motion={{ role: 'card' }}>
    <CheckBadge />
    <h1 bind:this={heading} tabindex="-1">{headline}</h1>
    <p class="pms-line">Your responses have been recorded.</p>
    <ul class="pms-summary">
      <li>{activities === 1 ? '1 activity completed' : `${activities} activities completed`}</li>
      {#if score}<li>{score.right} of {score.total} right on the first try</li>{/if}
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
      <HomeButton onclick={() => go('/welcome')} />
    </div>
  </section>
{/if}

<style>
  .pms-final {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(1rem, 3vw, 1.5rem);
    text-align: center;
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

  .pms-summary {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    font: var(--fw-semibold) var(--fs-body) / 1.35 var(--font-sans);
    list-style: none;
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
</style>
