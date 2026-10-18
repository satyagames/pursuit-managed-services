<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { HeroPlate, PillButton } from '../components/index.js';
  import { unlockAudio } from '../lib/effects/effects.js';
  import { experience } from '../lib/participant/experience.svelte.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { navigateTo } from '../lib/participant/navigation.js';
  import { greetingName, hiLine } from '../lib/participant/pager-logic.js';
  import { hasAnyAnswer, restoreAnswers } from '../lib/participant/participantData.js';
  import { participant, setTrack, takeEarlierVisit, type ParticipantTrack } from '../lib/participant/session.svelte.js';
  import { visitBegun, visitIdFor } from '../lib/participant/visit-id.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { motion } from '../lib/motion/motion.js';

  type StaffTrack = ParticipantTrack & { sharePointUserId?: string | null; visitorId?: string | null };
  /** What Welcome draws from, when it is not today's live experience: Brand Studio's preview of a draft. */
  type PreviewView = Pick<typeof experience, 'heroUrl' | 'logoUrl' | 'plate' | 'logoText' | 'clientName' | 'welcomeLine'>;
  // `preview` draws the screen from a draft and does nothing else: no reads, no visit, no title, no buttons that act.
  let { preview = null }: { preview?: { view: PreviewView; name: string; answered?: boolean; onbegin?: () => void } | null } = $props();
  let heading = $state<HTMLElement>();
  let accountTrack = $state<StaffTrack | null>(null);
  let answered = $state(false);
  let fetching = $state(true);
  let busy = $state(false);
  let error = $state('');

  const loading = $derived(fetching && !preview);
  const view = $derived<PreviewView>(preview?.view ?? experience);
  const name = $derived(preview ? preview.name : greetingName({
    participantName: participant.participantName,
    sharePointDisplayName: participant.sharePointDisplayName,
    participationMode: participant.activeSession?.participationMode,
    visitorId: participant.visitorId,
  }));
  const visitorNeedsQr = $derived(!participant.clientTrackId && participant.activeSession?.participationMode === 'client-visit');
  // First time in: "Click here to begin". Once anything is answered, the way back to the hub.
  const ctaLabel = $derived(answered || preview?.answered ? 'Activities' : 'Click here to begin');

  // The screen's heading, once there is one (the words wait for the visit to be read): focus goes to it, as to every other screen's.
  $effect(() => { if (heading && !preview) focusHeading(heading); });

  onMount(() => {
    if (preview) return;
    let active = true;
    async function loadWelcome() {
      if (!participant.clientTrackId && participant.activeSession?.participationMode === 'staff' && participant.sharePointUserId) {
        // The boot sequence has usually looked already; a Welcome opened later looks for itself.
        const found = takeEarlierVisit(participant.activeSession.id);
        if (found) accountTrack = found.track;
        else {
          const tracks = await dataService.listClientTracks(participant.activeSession.id) as StaffTrack[];
          accountTrack = tracks
            .filter((track) => !track.visitorId && track.sharePointUserId === participant.sharePointUserId)
            .sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))[0] ?? null;
        }
      }
      const visit = participant.clientTrackId && participant.sessionId
        ? { sessionId: participant.sessionId, trackId: participant.clientTrackId, restartedAt: participant.restartedAt }
        : accountTrack ? { sessionId: accountTrack.sessionId, trackId: accountTrack.id, restartedAt: accountTrack.restartedAt ?? null } : null;
      const any = visit ? await hasAnyAnswer(visit).catch(() => false) : false;
      if (active) answered = any;
    }
    void loadWelcome().catch((cause) => { if (active) error = cause instanceof Error ? cause.message : 'Could not load your visit.'; })
      .finally(() => { if (active) fetching = false; });
    return () => { active = false; };
  });

  async function continueVisit(trackId?: string) {
    if (busy || preview) return;
    busy = true;
    error = '';
    unlockAudio(); // the tap that lets audio start, when sound is already on
    try {
      // The visit this page is already on was checked when the page loaded and is watched since:
      // going back to its activities needs nothing from the server.
      if (trackId && trackId === participant.clientTrackId) {
        participant.notice = '';
        await navigateTo('/agenda');
        return;
      }
      // A new visit is begun with an id the page chose (lib/participant/visit-id.js): a press whose reply was lost, pressed again, finds the
      // visit it already made instead of making a second one. The press does not wait for the session to be moved on (Phase 10j).
      const live = participant.activeSession;
      const track = trackId
        ? await dataService.resumeClientTrack(trackId) as ParticipantTrack | null
        : live
          ? await dataService.beginVisit(visitIdFor(live.id), live.id, live.clientId, { sharePointUserId: participant.sharePointUserId, waitForSession: false }) as ParticipantTrack
          : null;
      if (!track) throw new Error('This visit is no longer available. Ask your facilitator for help.');
      if (!trackId && live) visitBegun(live.id);
      setTrack(track);
      if (!trackId) await restoreAnswers(null); // a visit that began this moment has saved nothing: no need to ask
      participant.notice = '';
      await navigateTo('/agenda');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not continue this visit.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>{#if !preview}<title>Welcome | {APP_NAME}</title>{/if}</svelte:head>

<section class="pms-welcome" aria-busy={loading || busy}>
  <HeroPlate hero={view.heroUrl} logo={view.logoUrl} plate={view.plate} text={view.logoText} name={view.clientName} motion={{ role: 'hero' }} />

  {#if loading}
    <p class="pms-line" role="status">Loading your welcome...</p>
  {:else if visitorNeedsQr}
    <div class="pms-words" use:motion={{ role: 'title' }}>
      <h1 bind:this={heading} tabindex="-1">Scan your visitor QR code</h1>
      <p class="pms-line">Your facilitator will provide your personal check-in code.</p>
    </div>
  {:else}
    <div class="pms-words" use:motion={{ role: 'title' }}>
      <h1 bind:this={heading} tabindex="-1">{hiLine(name)}</h1>
      <p class="pms-line">{view.welcomeLine || `Welcome to the ${view.clientName} experience.`}</p>
      {#if !preview && !participant.activeSession && !participant.clientTrackId}
        <p class="pms-line pms-soft">Your facilitator has not selected an active session yet.</p>
      {/if}
    </div>

    {#if preview}
      <div class="pms-cta"><PillButton onclick={() => preview.onbegin?.()}>{ctaLabel}</PillButton></div>
    {:else if participant.clientTrackId}
      <div class="pms-cta">
        <PillButton disabled={busy} onclick={() => void continueVisit(participant.clientTrackId!)}>{busy ? 'Opening...' : ctaLabel}</PillButton>
      </div>
    {:else if participant.activeSession?.participationMode === 'staff'}
      <div class="pms-cta">
        {#if accountTrack}
          <PillButton disabled={busy} onclick={() => void continueVisit(accountTrack!.id)}>{busy ? 'Opening...' : ctaLabel}</PillButton>
          <PillButton variant="secondary" size="md" disabled={busy} onclick={() => void continueVisit()}>Start a new visit</PillButton>
        {:else}
          <PillButton disabled={busy} onclick={() => void continueVisit()}>{busy ? 'Opening...' : ctaLabel}</PillButton>
        {/if}
      </div>
    {/if}
  {/if}

  {#if participant.notice}<p class="pms-note" role="status">{participant.notice}</p>{/if}
  {#if participant.visitLogError}<p class="pms-note pms-note--error" role="alert">This visit could not be recorded: {participant.visitLogError}</p>{/if}
  {#if error}<p class="pms-note pms-note--error" role="alert">{error}</p>{/if}
</section>

<style>
  .pms-welcome {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: clamp(1.5rem, 5dvh, 3rem);
    text-align: center;
  }

  .pms-words {
    display: grid;
    gap: clamp(0.75rem, 2dvh, 1.25rem);
  }

  h1 {
    margin: 0;
    font: normal var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
    overflow-wrap: anywhere;
  }

  .pms-line {
    margin: 0;
    font: var(--fw-regular) var(--fs-description) / 1.4 var(--font-sans);
  }

  .pms-soft {
    font-weight: var(--fw-light);
  }

  .pms-cta {
    display: grid;
    justify-items: center;
    gap: 1rem;
    margin-top: auto;
    padding-top: clamp(0.5rem, 3dvh, 2rem);
  }

  /* A message on a white panel reads on any client colour. */
  .pms-note {
    align-self: stretch;
    margin: 0;
    padding: 0.85rem 1.25rem;
    color: var(--text);
    font: var(--fw-regular) var(--fs-body) / 1.4 var(--font-sans);
    text-align: left;
    background: rgb(0 1 2 / 0.92);
    border: 1px solid rgb(255 255 255 / 0.5);
    border-left: 6px solid var(--focus);
    border-radius: 0.75rem;
  }

  .pms-note--error {
    color: var(--on-plate);
    background: var(--plate);
    border-left-color: var(--danger);
    font-weight: var(--fw-semibold);
  }
</style>
