<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Router, { replace, router } from 'svelte-spa-router';
  import type { RouteDefinition } from 'svelte-spa-router';
  import { wrap } from 'svelte-spa-router/wrap';
  import * as dataService from './lib/data/dataService.js';
  import { APP_NAME } from './lib/common/app-name.js';
  import { bootParticipant, writesAhead } from './lib/participant/boot.js';
  import { initEffects } from './lib/effects/effects.js';
  import { activityContent, adoptExperience, adoptWatch, experience, holdActivityContent, isStale, showTheme, type LiveExperience } from './lib/participant/experience.svelte.js';
  import { greetingName, hiLine } from './lib/participant/pager-logic.js';
  import { createPageWatcher, type PageWatcher } from './lib/common/page-watch.js';
  import { modeOf, sessionHasEnded, showsEndedNotice } from './lib/common/poll-schedule.js';
  import { applyRestart, restartedQuestionIds, restoreAnswers, resumePendingSaves } from './lib/participant/participantData.js';
  import { visitGoneNotice } from './lib/participant/visit-notice.js';
  import { clearTrack, offerEarlierVisit, participant, setGuestPicture, setTrack, type ParticipantTrack } from './lib/participant/session.svelte.js';
  import { isSignedOut } from './lib/participant/sign-in.js';
  import { navigateTo } from './lib/participant/navigation.js';
  import Agenda from './routes/Agenda.svelte';
  import Quiz from './routes/Quiz.svelte';
  import Feedback from './routes/Feedback.svelte';
  import ThankYou from './routes/ThankYou.svelte';
  import ConfidenceCheck from './routes/ConfidenceCheck.svelte';
  import ResultsMoved from './routes/ResultsMoved.svelte';
  import Welcome from './routes/Welcome.svelte';
  import NotLive from './routes/NotLive.svelte';
  import PreviewRoot from './routes/PreviewRoot.svelte';
  import StagePlaceholder from './routes/StagePlaceholder.svelte';
  import AppShell from './components/AppShell.svelte';
  import HeaderGreeting from './components/HeaderGreeting.svelte';
  import SoundToggle from './components/SoundToggle.svelte';

  const routes: RouteDefinition = {
    '/': Welcome,
    '/welcome': Welcome,
    '/agenda': Agenda,
    '/quiz/:sectionId': Quiz,
    '/feedback/:sectionId': Feedback,
    '/thank-you': ThankYou,
    // The confidence check, Before and After (Phase 20): one screen for both.
    '/check-in': wrap({ component: ConfidenceCheck, props: { phase: 'before' } }),
    '/check-out': wrap({ component: ConfidenceCheck, props: { phase: 'after' } }),
    // The facilitator's results display moved to the admin page (Phase 7): these addresses only say so.
    '/master-results': ResultsMoved,
    '/master-results/:sessionId': ResultsMoved,
    // Development only. import.meta.env.DEV is false in a build, so this branch, and the
    // import() inside it, are removed and the release pages carry no styleguide.
    ...(import.meta.env.DEV ? { '/styleguide': wrap({ asyncComponent: () => import('./dev/Styleguide.svelte') }) } : {}),
    '*': StagePlaceholder,
  };

  type User = { id: string | null; displayName: string };
  type Settings = LiveExperience['settings'];
  type Boot = Awaited<ReturnType<typeof bootParticipant>>;

  let initialized = $state(false);
  let startupError = $state('');
  /** The page's own saved-answers item is damaged (Phase 9b, DI-6): said in words, not as a lost connection. */
  let startupUnreadable = $state(false);
  let movedRoute = $derived(router.location.startsWith('/master-results'));
  let wideStage = $derived(router.location.startsWith('/styleguide'));
  // Welcome says "Hi {name}!" in its own body; every other screen carries it in the header.
  let onWelcome = $derived(router.location === '/' || router.location === '/welcome');
  // The "results have moved" notice and the dev styleguide show whatever they are given;
  // every other screen belongs to today's client and waits for one to be live.
  let needsLive = $derived(!movedRoute && !(import.meta.env.DEV && router.location.startsWith('/styleguide')));
  let greeting = $derived(hiLine(greetingName({
    participantName: participant.participantName,
    sharePointDisplayName: participant.sharePointDisplayName,
    participationMode: participant.activeSession?.participationMode,
    visitorId: participant.visitorId,
  })));
  // `?preview=<clientId>`: one client's screens, read-only, whether or not it is live (routes/PreviewRoot.svelte).
  const previewId = new URLSearchParams(window.location.search).get('preview');
  let restartMessage = $state('');
  let failedWatches = 0;
  let watcher: PageWatcher | undefined;
  let booting = false;
  let restartNoticeTimer: number | undefined;

  function currentTrackIdFromUrl(): string | null {
    return new URLSearchParams(router.querystring).get('t');
  }

  function preserveTrackInHash() {
    const trackId = participant.clientTrackId;
    if (!trackId || currentTrackIdFromUrl() === trackId) return;
    const query = new URLSearchParams(router.querystring);
    query.set('t', trackId);
    void replace(`${router.location || '/welcome'}?${query}`);
  }

  function cleanQrQuery() {
    const query = new URLSearchParams(window.location.search);
    query.delete('qr');
    const search = query.toString();
    const suffix = `${search ? `?${search}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${suffix}`);
  }

  // ---- The visit log: one row per tab and session, sent after the screen is up ----------------

  function visitId(sessionId: string | null) {
    const key = `cec-visit-id:${sessionId ?? 'none'}`;
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  /** Has this tab already recorded this entry? A reload must not spend requests saying it again. */
  function alreadyLogged(key: string) {
    try { return sessionStorage.getItem(`cec-visit-logged:${key}`) === '1'; } catch { return false; }
  }

  function markLogged(key: string) {
    try { sessionStorage.setItem(`cec-visit-logged:${key}`, '1'); } catch { /* the next load logs again; the row's id makes that harmless */ }
  }

  async function logEntry(track: ParticipantTrack | null, currentUser: User | null) {
    const active = participant.activeSession;
    const sessionId = track?.sessionId ?? active?.id ?? null;
    const logKey = `${sessionId ?? 'none'}:${track?.id ?? 'none'}`;
    if (alreadyLogged(logKey)) return;
    const entryMode = track?.visitorId ? 'client-visit' : active?.participationMode === 'client-visit' ? 'client-visit' : 'staff';
    try {
      await dataService.recordParticipantVisit({
        visitKey: visitId(sessionId),
        sessionId,
        clientId: track?.clientId ?? active?.clientId ?? null,
        page: 'participant',
        entryMode,
        sharePointUserId: entryMode === 'staff' ? currentUser?.id ?? track?.sharePointUserId ?? null : null,
        displayName: entryMode === 'staff' ? currentUser?.displayName ?? '' : '',
        visitorId: track?.visitorId ?? null,
        visitorName: track?.participantName ?? '',
        trackId: track?.id ?? null,
        visitedAt: new Date().toISOString(),
      });
      participant.visitLogError = '';
      markLogged(logKey);
    } catch (cause) {
      participant.visitLogError = cause instanceof Error ? cause.message : 'Could not record this visit.';
    }
  }

  // ---- Boot --------------------------------------------------------------------------------------

  /** Puts today's experience on the page: what the screens read, and the client's theme. */
  function showExperience(live: LiveExperience) {
    adoptExperience(live, { themed: true });
    participant.activeSession = live.status === 'live' && live.session ? {
      id: live.session.id,
      clientId: live.session.clientId,
      date: live.session.date,
      participationMode: live.session.participationMode === 'client-visit' ? 'client-visit' : 'staff',
    } : null;
  }

  /** Resolves once the browser has drawn what was just rendered (or shortly, in a tab that is not showing). */
  const painted = () => new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 250);
    requestAnimationFrame(() => { window.setTimeout(() => { window.clearTimeout(timer); resolve(); }, 0); });
  });

  /**
   * The work that must not hold the first screen up, started once that screen is drawn: the activities' questions and options (Phase 10j),
   * who is signed in (a resumed staff visit only needs it for the header), the visit log, what the next writes need, the resume stamp.
   */
  async function afterFirstScreen(boot: Boot) {
    await painted();
    void holdActivityContent();
    let user = boot.user as User | null;
    if (boot.userDeferred) {
      try { user = await dataService.getCurrentUser() as User | null; }
      catch (cause) { console.warn('Could not read the signed-in SharePoint display name.', cause); }
      participant.sharePointUserId = user?.id ?? participant.sharePointUserId;
      participant.sharePointDisplayName = user?.displayName ?? '';
    }
    if (experience.status === 'live' || boot.track) await logEntry(boot.track as ParticipantTrack | null, user);
    // What the next writes will ask for, fetched now (Phase 10j): "Click here to begin" and a first save then wait for nothing but themselves.
    void dataService.prepareWrites(writesAhead(boot));
    if (boot.track && !boot.claimed) {
      try { await dataService.noteTrackResumed(boot.track); }
      catch (cause) { console.warn('Could not note that this visit was resumed.', cause); }
    }
  }

  async function restoreParticipant() {
    if (booting) return;
    booting = true;
    startupError = '';
    startupUnreadable = false;
    initialized = false;
    // The dev styleguide needs no session, so it neither waits for the API nor fails without it.
    if (import.meta.env.DEV && (router.location || '/').startsWith('/styleguide')) {
      showTheme();
      initialized = true;
      booting = false;
      return;
    }
    // The old results address only says where results went: it needs nothing from the server, so it reads nothing.
    if ((router.location || '/').startsWith('/master-results')) {
      showTheme();
      initialized = true;
      booting = false;
      return;
    }
    if (previewId) {
      try {
        const [client, sections] = await Promise.all([dataService.getClient(previewId), dataService.listClientSections(previewId)]);
        if (!client) throw new Error(`There is no client "${previewId}".`);
        showExperience({ status: 'live', reason: null, settings: null, client, session: { id: 'preview', clientId: previewId }, sections } as LiveExperience);
      } catch (cause) {
        showTheme();
        startupError = cause instanceof Error ? cause.message : 'Could not load this preview.';
      } finally {
        initialized = true;
        booting = false;
      }
      return;
    }
    const qrToken = dataService.qrTokenFromSearch(window.location.search);
    const requestedTrackId = currentTrackIdFromUrl();
    let boot: Boot | null = null;
    try {
      boot = await bootParticipant(dataService, { trackId: requestedTrackId, qrToken, path: router.location || '/', content: activityContent });
      participant.sharePointUserId = boot.user?.id ?? null;
      participant.sharePointDisplayName = boot.user?.displayName ?? '';
      showExperience(boot.experience as LiveExperience);
      if (qrToken) cleanQrQuery();
      if (boot.track) {
        setTrack(boot.track as ParticipantTrack);
        if (boot.pictureUrl) setGuestPicture((boot.track as ParticipantTrack).id, boot.pictureUrl);
        await restoreAnswers(boot.own as never);
      } else {
        clearTrack();
      }
      if (boot.accountChecked && experience.sessionId) {
        const earlier = boot.accountTrack as ParticipantTrack | null;
        if (earlier) {
          const visit = { trackId: earlier.id, sessionId: earlier.sessionId, clientId: earlier.clientId, restartedAt: earlier.restartedAt ?? null };
          await restoreAnswers(boot.accountOwn as never, visit);
        }
        offerEarlierVisit(experience.sessionId, earlier);
      }
      participant.notice = boot.notice;
      if (boot.destination === '/welcome' && boot.keepTrackInUrl && requestedTrackId) {
        await replace(`/welcome?t=${encodeURIComponent(requestedTrackId)}`);
      } else if (boot.destination && boot.track) {
        await navigateTo(boot.destination, true);
      } else if (boot.destination) {
        await replace(boot.destination);
      }
    } catch (cause) {
      showTheme();
      startupError = cause instanceof Error ? cause.message : 'Could not restore this session.';
      startupUnreadable = (cause as { code?: string } | null)?.code === 'responses-unreadable';
    } finally {
      initialized = true;
      booting = false;
    }
    if (boot && !startupError) void afterFirstScreen(boot);
  }

  // ---- Keeping up with the facilitator ---------------------------------------------------------

  /** Something else is live now: today's client changed, or a session began or ended. */
  async function followFacilitator(settings: Settings, track: ParticipantTrack | null) {
    const live = await dataService.getLiveExperience(settings ?? null) as LiveExperience;
    const hadVisit = Boolean(participant.clientTrackId);
    clearTrack();
    showExperience(live);
    void holdActivityContent(); // today's other activities: read ahead, as after the first screen
    await logEntry(null, { id: participant.sharePointUserId, displayName: participant.sharePointDisplayName });
    participant.notice = hadVisit && track
      ? 'Your facilitator changed the active session. Scan the current visitor code or continue with the selected session.'
      : '';
    await navigateTo('/welcome');
  }

  /**
   * One look at what the facilitator did, sent on the page's timer (lib/common/page-watch.ts decides when): ONE request on SharePoint, a
   * $batch of AppSettings, the session, this page's own track and, on the hub, the client's activities (dataService.readParticipantWatch).
   * What it can find: something else is live now, the track was removed or restarted, the session ended (or was reopened),
   * and the hub's activities or flow changed. It throws when it cannot reach the server, and the timer backs off.
   */
  async function checkServer(): Promise<{ requests: number }> {
    const trackId = participant.clientTrackId;
    const onHub = router.location.split('?')[0] === '/agenda';
    let watch: Awaited<ReturnType<typeof dataService.readParticipantWatch>>;
    try {
      watch = await dataService.readParticipantWatch({
        // With a visit, its own session; without one (Welcome, "not live yet") the session AppSettings pointed at when the page booted.
        sessionId: participant.sessionId ?? experience.sessionId ?? experience.watchSessionId,
        trackId,
        clientId: onHub ? participant.clientId ?? experience.clientId : null,
      });
    } catch (cause) {
      if (participant.clientTrackId === trackId) {
        console.warn('Svelte pilot track watch failed', cause);
        if (dataService.isUnreachable(cause) && ++failedWatches >= 2) participant.connectionLost = true;
        if (isSignedOut(cause)) participant.signedOut = true;
      }
      throw cause;
    }
    const { settings, track, session, sections, requests } = watch as {
      settings: Settings; track: (ParticipantTrack & { restartSectionId?: string | null }) | null; session: Parameters<typeof adoptWatch>[0]['session']; sections: Parameters<typeof adoptWatch>[0]['sections']; requests: number;
    };
    // The page moved on while this was being read (a new visit, a reboot): what it found is about something else.
    if (participant.clientTrackId !== trackId || booting) return { requests };
    failedWatches = 0;
    participant.connectionLost = false;
    participant.signedOut = false;
    resumePendingSaves();

    try {
      if (!trackId) {
        // Nobody has a visit on this page yet (Welcome, or "isn't live yet"): this tells it when the facilitator goes live or
        // changes client, so nobody has to reload by hand.
        if (isStale(settings)) { await followFacilitator(settings, null); return { requests }; }
      } else if (settings?.activeSessionId && track && settings.activeSessionId !== track.sessionId) {
        await followFacilitator(settings, track);
        return { requests };
      } else if (!track) {
        // The visit was removed (from Results, if it had no answers) or cleaned up: say what to do next, by what kind of session it was (Phase 9b, DI-9).
        const guest = Boolean(participant.visitorId) || participant.activeSession?.participationMode === 'client-visit';
        clearTrack();
        participant.notice = visitGoneNotice(guest);
        await navigateTo('/welcome');
        return { requests };
      } else if ((track.restartedAt ?? null) !== participant.restartedAt) {
        let destination = '/agenda';
        let restarted: string[] | null = null;
        if (track.restartedAt && track.restartSectionId) {
          const section = await dataService.getSection(track.restartSectionId) as { id: string; enabled?: boolean; questionIds?: string[] } | null;
          // (At an activity the confidence check's After goes too, and is asked again once the activity is done again: Phase 20.)
          restarted = restartedQuestionIds(section?.questionIds ?? []);
          if (section?.enabled === true) destination = `/quiz/${section.id}`;
        }
        // The answers go from this device first; only then do the screens learn of the restart.
        await applyRestart(track.restartedAt ?? null, restarted);
        participant.restartedAt = track.restartedAt ?? null;
        if (track.restartedAt) {
          restartMessage = destination.startsWith('/quiz/')
            ? 'Your facilitator restarted this activity.'
            : 'Your facilitator restarted your session.';
          window.clearTimeout(restartNoticeTimer);
          restartNoticeTimer = window.setTimeout(() => { restartMessage = ''; }, 7000);
          await navigateTo(destination);
        }
        return { requests };
      }
      // Nothing moved: the session itself. Ended, reopened, a changed flow, and (on the hub) the activities.
      if (experience.status === 'live') adoptWatch({ session, sections });
      else if (experience.reason === 'session-ended' && session && !sessionHasEnded(session)) void restoreParticipant(); // reopened: start again, live
    } catch (cause) {
      if (participant.clientTrackId === trackId) {
        console.warn('Svelte pilot track watch failed', cause);
        if (dataService.isUnreachable(cause) && ++failedWatches >= 2) participant.connectionLost = true;
        if (isSignedOut(cause)) participant.signedOut = true;
      }
      throw cause;
    }
    return { requests };
  }

  let pageTitle = $derived(movedRoute ? APP_NAME : experience.clientName);

  // A question opening or closing changes how often the page looks (a question: once a minute, since saving is the traffic),
  // so the timer is told when the kind of screen changes.
  $effect(() => {
    const mode = modeOf(router.location);
    void mode;
    untrack(() => watcher?.replan());
  });

  onMount(() => {
    initEffects();
    void restoreParticipant();
    watcher = createPageWatcher({
      check: checkServer,
      mode: () => modeOf(router.location),
      enabled: () => !(previewId || booting || !initialized || startupError || movedRoute || (import.meta.env.DEV && router.location.startsWith('/styleguide'))),
      local: !dataService.isSharePointMode(),
    });
    watcher.start();
    window.addEventListener('hashchange', preserveTrackInHash);

    return () => {
      watcher?.stop();
      watcher = undefined;
      window.clearTimeout(restartNoticeTimer);
      window.removeEventListener('hashchange', preserveTrackInHash);
    };
  });
</script>

<svelte:head>
<title>{pageTitle}</title>
</svelte:head>

<AppShell stage={wideStage ? 'wide' : 'narrow'} background={movedRoute ? null : experience.backgroundUrl} focus={experience.backgroundFocus}>
  {#snippet right()}
    {#if !movedRoute}
      {#if !onWelcome && initialized && !startupError}<HeaderGreeting text={greeting} guest={Boolean(participant.visitorId)} picture={participant.pictureUrl} />{/if}
      <SoundToggle />
    {/if}
  {/snippet}

  {#if restartMessage}
    <p class="notice" role="status">{restartMessage}</p>
  {/if}
  {#if participant.signedOut}
    <!-- Not a lost connection: waiting does not mend it. Unsaved answers are in this tab's storage and are sent after the reload. -->
    <div class="connection" role="alert">
      <span>Your sign-in has expired. Reload this page to sign in again. Your answers are kept on this device.</span>
      <button type="button" onclick={() => window.location.reload()}>Reload</button>
    </div>
  {:else if participant.connectionLost}
    <div class="connection" role="alert">
      <span>Can’t reach the server. Reconnecting…</span>
      <button type="button" onclick={() => void watcher?.checkNow()}>Retry</button>
    </div>
  {/if}

  {#if startupError}
    <section class="screen" role="alert">
      {#if startupUnreadable}
        <h1>We can’t open your saved answers</h1>
        <p class="error-detail">{startupError}</p>
      {:else}
        <h1>We can’t reach the server</h1>
        <p>Check your connection. Your saved answers are safe.</p>
        <p class="error-detail">{startupError}</p>
      {/if}
      <button class="button button-primary" type="button" onclick={() => void restoreParticipant()}>Try again</button>
    </section>
  {:else if !initialized}
    <p class="loading" role="status">Loading...</p>
  {:else if previewId}
    <PreviewRoot />
  {:else if needsLive && experience.status !== 'live'}
    <NotLive reason={experience.reason} oncheck={() => void restoreParticipant()} />
  {:else if experience.ended && showsEndedNotice(router.location)}
    <!-- The facilitator ended the session while this page was open. Welcome and the hub say so; an activity under way is finished first,
         and its answers still save. The page keeps checking, so Reopen brings the hub back. -->
    <NotLive reason="session-ended" oncheck={() => void restoreParticipant()} />
  {:else}
    {#key `${router.location}:${participant.restartedAt ?? ''}`}
      <Router {routes} />
    {/key}
  {/if}
</AppShell>
