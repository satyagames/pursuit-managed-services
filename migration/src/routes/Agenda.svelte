<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ActionBar, ActivityPill, Divider, HomeButton, PillButton } from '../components/index.js';
  import type { ActivityState } from '../components/index.js';
  import { experience } from '../lib/experience.svelte.js';
  import { focusHeading } from '../lib/focus.js';
  import { consumeNavigationData, navigateTo } from '../lib/navigation.js';
  import { activityStates } from '../lib/pager-logic.js';
  import { getKnownProgress, getProgress, loadFailure } from '../lib/participantData.js';
  import { participant } from '../lib/session.svelte.js';
  import { APP_NAME } from '../lib/app-name.js';

  // The route is #/agenda; the screen is the Activities hub.
  type Pill = { id: string; title: string; state: ActivityState };
  // `preview` draws the hub from a draft (Brand Studio): the given pills and words, no reads, no buttons that act.
  let { preview = null }: { preview?: { pills: Pill[]; eventTitle: string; eventSubtitle: string; clientName: string; allDone?: boolean; go?: (path: string) => void } | null } = $props();

  let heading = $state<HTMLElement>();
  let fetched = $state<Pill[]>([]);
  let fetchedAllDone = $state(false);
  let fetching = $state(true);
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

  type Progress = Awaited<ReturnType<typeof getProgress>>;

  /** Draws the hub from what was read (or from what the page's timer last found). */
  function show(progress: Progress) {
    const next = activityStates(progress.sections, experience.activityFlow).map((section) => ({ id: section.id, title: section.title, state: section.state }));
    if (JSON.stringify(next) !== JSON.stringify(fetched)) fetched = next;
    // An activity with no questions can never be finished, so it must not keep the finale away.
    const needed = progress.sections.filter((section) => (section.questionIds ?? []).length > 0);
    fetchedAllDone = needed.length > 0 && needed.every((section) => section.complete);
    fetching = false;
  }

  // The hub reads its activities once, on arriving (one request). It does not poll: the page's timer (App.svelte, one request
  // for everything it checks) reports a change in the activities or in the session's flow by raising experience.activitiesVersion,
  // and the hub then redraws from what the timer found, reading nothing. This visit's own answers are already on the device.
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

    async function load() {
      error = '';
      try {
        const progress = await getProgress(participant.sessionId!, participant.clientTrackId!, answeredSnapshot, { withSession: false });
        if (active) show(progress);
      } catch (cause) {
        if (active) {
          fetching = false;
          error = loadFailure(cause, 'Could not load your activities.');
        }
      }
    }
    // "Try again" reads the activities again, here. (It used to reload the whole page, which with no connection puts the browser's own error in its place.)
    tryAgain = () => { fetching = true; void load(); };

    if (!participant.sessionId || !participant.clientTrackId) {
      void navigateTo('/welcome', true);
      return;
    }

    void load();
    return () => { active = false; };
  });
</script>

<svelte:head>{#if !preview}<title>Activities | {APP_NAME}</title>{/if}</svelte:head>

<section class="pms-hub" aria-busy={loading}>
  <header class="pms-head">
    <h1 class="pms-title" bind:this={heading} tabindex="-1">{title}</h1>
    <p class="pms-description">{subtitle}</p>
  </header>
  <Divider />

  {#if loading}
    <p class="pms-status" role="status">Loading activities...</p>
  {:else if error}
    <p class="pms-alert" role="alert">{error}</p>
    <div class="pms-row"><PillButton onclick={() => tryAgain()}>Try again</PillButton></div>
  {:else if pills.length === 0}
    <p class="pms-status">There are no activities available right now.</p>
  {:else}
    <ul class="pms-activities">
      {#each pills as pill (pill.id)}
        <li><ActivityPill label={pill.title} state={pill.state} onclick={() => go(`/quiz/${pill.id}`)} /></li>
      {/each}
    </ul>
  {/if}

  <ActionBar sticky={false}>
    {#if allDone}<PillButton onclick={() => go('/thank-you')}>Finish</PillButton>{/if}
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
