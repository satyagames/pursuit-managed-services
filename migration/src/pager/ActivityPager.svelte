<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import { ActionBar, Divider, HomeButton, PillButton, ProgressBar } from '../components/index.js';
  import { activityComplete, answerFeedback, pick } from '../lib/effects.js';
  import { loadActivity } from '../lib/experience.svelte.js';
  import { focusHeading } from '../lib/focus.js';
  import { keepInView } from '../lib/keep-in-view.js';
  import { navigateTo } from '../lib/navigation.js';
  import {
    chooseGraded, correctOptionIds, firstTryScore, firstUnansweredIndex, gradedAnnouncement, gradedRecord,
    gradedStateFromRecord, greetingName, isAnswerComplete, isGraded, isGradedResolved, isRecordSettled, normalizeAnswer,
    retryGraded, startGraded, toggleChoice, toggleRank, ungradedRecord,
    type Answer, type GradedState, type Question,
  } from '../lib/pager-logic.js';
  import { answerRecord, flushActivity, getSavedAnswers, knownProgress, loadFailure, pendingAnswers, recordAnswer } from '../lib/participantData.js';
  import { participant } from '../lib/session.svelte.js';
  import { isSignedOut } from '../lib/sign-in.js';
  import { APP_NAME } from '../lib/app-name.js';
  import ActivityComplete from './ActivityComplete.svelte';
  import QuestionOptions from './QuestionOptions.svelte';

  let { sectionId, preview = false, showKey = false, demo = null }: {
    sectionId: string;
    /** A read-only preview: steps can be walked, nothing is ever saved, and no right answer is marked unless `showKey` says so. */
    preview?: boolean;
    /** The facilitator's Content preview (behind the admin PIN) marks the right answers; the `?preview=<clientId>` address never does (SEC-1). */
    showKey?: boolean;
    /**
     * Brand Studio's picture of a question as a participant meets it: the given content (no reads), the
     * participant's own bar of buttons, and, for `answered`, the first question already answered right. Used
     * without `preview`, so the options look as a participant's do. Nothing acts: no answer is taken, no step
     * is taken and nothing is saved.
     */
    demo?: { content: { section: { title: string; description?: string | null }; questions: Question[] }; answered?: boolean } | null;
  } = $props();

  type Phase = 'loading' | 'error' | 'empty' | 'question' | 'complete';

  let phase = $state<Phase>('loading');
  let loadError = $state('');
  let title = $state('');
  let description = $state('');
  let questions = $state<Question[]>([]);
  let index = $state(0);
  let drafts = $state<Record<string, Answer>>({});
  let gradedState = $state<GradedState>(startGraded());
  let saving = $state(false);
  let saveFailed = $state(false);
  let announcement = $state('');
  let score = $state({ right: 0, total: 0 });
  let allDone = $state(false);
  let heading = $state<HTMLElement>();
  let optionsHost = $state<HTMLElement>();
  let pager = $state<HTMLElement>();
  let active = false;
  let savedAnswers = new Map<string, Answer>();

  const uid = $props.id();
  const headingId = `${uid}-question`;

  const question = $derived<Question | undefined>(questions[index]);
  const graded = $derived(question ? isGraded(question) : false);
  const isLast = $derived(index === questions.length - 1);
  const settled = $derived(!question ? false : graded ? isGradedResolved(gradedState) : isAnswerComplete(question, drafts[question.id]));
  const name = $derived(greetingName({
    participantName: participant.participantName,
    sharePointDisplayName: participant.sharePointDisplayName,
    participationMode: participant.activeSession?.participationMode,
    visitorId: participant.visitorId,
  }));

  // ---- Loading and resume --------------------------------------------------------------------

  async function load() {
    if (demo) {
      title = demo.content.section.title;
      description = demo.content.section.description?.trim() ?? '';
      questions = [...demo.content.questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
      const first = questions[0];
      if (demo.answered && first) gradedState = chooseGraded(first, startGraded(), correctOptionIds(first)[0] ?? first.options[0].id);
      phase = questions.length ? 'question' : 'empty';
      return;
    }
    if (!preview && (!participant.sessionId || !participant.clientTrackId)) {
      await navigateTo('/welcome', true);
      return;
    }
    if (!sectionId) {
      if (preview) throw new Error('No activity selected for preview.');
      await navigateTo('/agenda', true);
      return;
    }
    // The facilitator's preview reads the activity itself. A participant's page already holds the
    // activity record (from boot or the hub), so only its questions and options are fetched, and
    // not even those for the first activity, which the boot sequence brought along.
    const [content, saved] = await Promise.all([
      preview ? dataService.getSectionContent(sectionId) : loadActivity(sectionId),
      preview ? Promise.resolve(new Map<string, Answer>()) : getSavedAnswers(),
    ]) as [{ section: { title: string; description?: string | null } | null; questions: Question[] } | null, Map<string, Answer>];
    if (!active) return;
    if (!content?.section) {
      if (preview) throw new Error('This activity no longer exists.');
      await navigateTo('/agenda', true);
      return;
    }

    title = content.section.title;
    description = content.section.description?.trim() ?? '';
    questions = [...content.questions].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

    if (!questions.length) { savedAnswers = saved; phase = 'empty'; return; }
    if (preview) { savedAnswers = saved; phase = 'question'; return; }

    // What this visit has answered, read in one go from what the device holds. Answers are saved
    // in the background, so one may be on its way at this very moment: looking it up as "saved"
    // and then as "waiting" in two steps could find it in neither.
    const answered = new Map(saved);
    for (const entry of questions) {
      const held = answerRecord(entry.id);
      if (held && isRecordSettled(held)) answered.set(entry.id, held.correct === null ? held.answer : held.firstAnswer);
    }
    const waiting = pendingAnswers(sectionId).filter(isRecordSettled);
    savedAnswers = answered;

    // Resume at the first question with no final answer. A graded question left on a wrong first
    // pick is not final: it is where the participant comes back to.
    const start = firstUnansweredIndex(questions, answered.keys());
    if (start >= 0) {
      index = start;
      restoreOpen(questions[index]);
      phase = 'question';
      await focusQuestion();
      return;
    }
    if (waiting.length === 0) {
      // Everything was answered and saved: this is a finished activity.
      score = firstTryScore(questions, answered);
      phase = 'complete';
      checkAllDone();
      return;
    }
    // Everything is answered but some answers have not reached the server yet (the save failed, or
    // the tab was reloaded during it). Show the last question as it was left and finish saving.
    index = questions.length - 1;
    restoreSettled(questions[index]);
    phase = 'question';
    void finish();
  }

  function restoreSettled(target: Question) {
    const record = pendingAnswers(sectionId).find((entry) => entry.questionId === target.id);
    if (!record) return;
    if (isGraded(target)) gradedState = gradedStateFromRecord(target, record);
    else drafts[target.id] = record.answer;
  }

  /**
   * A graded question whose first pick was wrong and whose Retry was never used (the page was
   * reloaded, or the visit moved to another device): put it back as it was left, first try and
   * all, so that reloading is not a way to a fresh first try.
   */
  function restoreOpen(target: Question | undefined) {
    if (!target || !isGraded(target)) return;
    const record = answerRecord(target.id);
    if (!record) return;
    gradedState = gradedStateFromRecord(target, record);
    announcement = gradedAnnouncement(target, gradedState);
  }

  /** Loads the activity: when the screen opens, and again from "Try again" (here, not by reloading the page: with no connection that puts the browser's own error in its place). */
  function start() {
    phase = 'loading';
    void load().catch((cause) => {
      if (!active) return;
      loadError = loadFailure(cause, 'Could not load this activity.');
      phase = 'error';
    });
  }

  onMount(() => {
    active = true;
    start();
    // The device turned over mid-question: what the person chose, or what has focus, stays on the screen (the page's own, not the preview's).
    const stopKeeping = preview || demo ? () => {} : keepInView(() => pager?.querySelector('.pms-options [data-state="correct"], .pms-options [data-state="incorrect"], .pms-options [aria-pressed="true"]')
      ?? (pager?.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null));
    return () => { active = false; stopKeeping(); };
  });

  async function focusQuestion() {
    await tick();
    if (preview || demo || !active) return;
    focusHeading(heading);
  }

  function startStep() {
    gradedState = startGraded();
    announcement = '';
    saveFailed = false;
    if (!preview) restoreOpen(questions[index]);
    if (!preview) window.scrollTo({ top: 0 });
    void focusQuestion();
  }

  // ---- Answering -----------------------------------------------------------------------------

  function choose(optionId: string) {
    if (preview || demo || saving || !question) return;
    if (graded) {
      if (gradedState.phase !== 'choosing') return;
      gradedState = chooseGraded(question, gradedState, optionId);
      announcement = gradedAnnouncement(question, gradedState);
      answerFeedback({
        correct: gradedState.phase === 'correct',
        firstTry: gradedState.attempts === 1,
        revealed: gradedState.phase === 'revealed',
        anchor: optionsHost?.querySelectorAll<HTMLElement>('button')[question.options.findIndex((option) => option.id === optionId)],
      });
      // Every pick is recorded, the first one included: the first answer is kept (and saved) from
      // the moment it is made, and a question that is right or revealed is settled, so a reload
      // from here on resumes at the next one.
      recordAnswer(sectionId, gradedRecord(question, gradedState));
      void focusAction();
    } else {
      drafts[question.id] = optionId;
      pick();
    }
  }

  /** After feedback, focus goes to what the participant does next (Next, Submit or Retry), so the keyboard flow is pick, Enter, Enter. */
  async function focusAction() {
    await tick();
    pager?.querySelector<HTMLElement>('.pms-actions button:not([disabled])')?.focus();
  }

  function toggle(optionId: string) {
    if (preview || demo || saving || !question) return;
    const current = Array.isArray(drafts[question.id]) ? drafts[question.id] as string[] : [];
    drafts[question.id] = toggleChoice(current, optionId);
    pick();
  }

  function rank(optionId: string) {
    if (preview || demo || saving || !question) return;
    const current = Array.isArray(drafts[question.id]) ? drafts[question.id] as string[] : [];
    drafts[question.id] = toggleRank(current, optionId);
    pick();
  }

  const clearRanking = () => { if (question) drafts[question.id] = []; };
  const typeText = (value: string) => { if (question) drafts[question.id] = value; };

  async function retry() {
    if (!question || gradedState.phase !== 'wrong') return;
    const previous = question.options.findIndex((option) => option.id === gradedState.choice);
    gradedState = retryGraded(gradedState);
    announcement = 'Try again.';
    await tick();
    optionsHost?.querySelectorAll<HTMLElement>('button')[Math.max(previous, 0)]?.focus();
  }

  // ---- Moving on -----------------------------------------------------------------------------

  async function next() {
    if (!question || saving || demo) return;
    if (preview) {
      if (!isLast) { index += 1; startStep(); }
      return;
    }
    if (graded) {
      if (!isGradedResolved(gradedState)) return;
    } else {
      const draft = drafts[question.id];
      if (!isAnswerComplete(question, draft)) return;
      const answer = normalizeAnswer(question, draft);
      recordAnswer(sectionId, ungradedRecord(question, answer, answerRecord(question.id)));
    }
    if (isLast) { await finish(); return; }
    index += 1;
    startStep();
  }

  async function finish() {
    if (saving) return;
    saving = true;
    saveFailed = false;
    announcement = 'Saving.';
    try {
      const saved = await flushActivity(sectionId);
      if (!active) return;
      const finalAnswers = new Map(savedAnswers);
      for (const record of saved) finalAnswers.set(record.questionId, record.correct === null ? record.answer : record.firstAnswer);
      savedAnswers = finalAnswers;
      score = firstTryScore(questions, finalAnswers);
      announcement = '';
      activityComplete();
      phase = 'complete';
      checkAllDone();
    } catch (cause) {
      console.error(cause);
      // The save failed because the sign-in ran out, not the connection: the page's banner says to reload (Retry cannot get through).
      if (isSignedOut((cause as { cause?: unknown })?.cause)) participant.signedOut = true;
      if (!active) return;
      saveFailed = true;
      announcement = "Couldn't save. Your answers are kept on this device. Press Retry to try again.";
    } finally {
      saving = false;
    }
  }

  // ---- After the activity --------------------------------------------------------------------

  const answeredSnapshot = () => [...new Set([...savedAnswers.keys(), ...questions.map((entry) => entry.id)])];

  /**
   * Is that the last activity? Worked out from the activities this page already holds, with no
   * request, because it only decides whether "Finish" is offered: the finale checks against the
   * server before it shows anything.
   */
  function checkAllDone() {
    if (!participant.sessionId || !participant.clientTrackId) return;
    const needed = knownProgress(answeredSnapshot()).sections.filter((section) => (section.questionIds ?? []).length > 0);
    if (active) allDone = needed.length > 0 && needed.every((section) => section.complete);
  }

  /** What the next screen needs so it does not have to wait for the server to show what was just saved. */
  function handoff() {
    return {
      sessionId: participant.sessionId!,
      clientTrackId: participant.clientTrackId!,
      answeredQuestionIds: answeredSnapshot(),
      savedAnswers: [...savedAnswers.entries()] as [string, unknown][],
    };
  }

  const backToActivities = () => { if (!demo) void navigateTo('/agenda', false, handoff()); };
  const finishAll = () => { if (!demo) void navigateTo('/thank-you', false, handoff()); };
  const goHome = () => { if (!demo) void navigateTo('/welcome'); };

  const primaryLabel = $derived(saving ? 'Saving...' : saveFailed ? "Couldn't save, Retry" : isLast ? 'Submit' : 'Next');
  const retrying = $derived(graded && gradedState.phase === 'wrong');
</script>

<svelte:head>{#if !preview && !demo}<title>{title || 'Activity'} | {APP_NAME}</title>{/if}</svelte:head>

<section class="pms-pager" aria-busy={phase === 'loading' || saving} bind:this={pager}>
  {#if phase === 'loading'}
    <p class="pms-status" role="status">Loading activity...</p>
  {:else if phase === 'error'}
    <p class="pms-alert" role="alert">{loadError}</p>
    <div class="pms-row"><PillButton onclick={() => start()}>Try again</PillButton></div>
  {:else if phase === 'complete'}
    <ActivityComplete
      {name}
      {title}
      right={score.right}
      total={score.total}
      {allDone}
      onback={backToActivities}
      onfinish={finishAll}
      onhome={goHome}
    />
  {:else}
    <header class="pms-head">
      <h1 class="pms-title">{title}</h1>
      {#if description}<p class="pms-description">{description}</p>{/if}
    </header>
    <Divider />

    {#if phase === 'empty'}
      <p class="pms-status">This activity has no questions yet.</p>
      {#if !preview}<ActionBar><HomeButton onclick={goHome} /></ActionBar>{/if}
    {:else if question}
      <p class="pms-count">Question {index + 1} of {questions.length}</p>
      <ProgressBar value={index + 1} max={questions.length} label={`Question ${index + 1} of ${questions.length}`} />

      {#key index}
        <div class="pms-step">
          <h2 class="pms-question" id={headingId} tabindex="-1" bind:this={heading}>
            <span class="pms-number" aria-hidden="true">{index + 1}.</span>
            <span>{question.prompt}</span>
          </h2>
          <div bind:this={optionsHost}>
            <QuestionOptions
              {question}
              labelledby={headingId}
              graded={gradedState}
              draft={drafts[question.id]}
              {preview}
              {showKey}
              onchoose={choose}
              ontoggle={toggle}
              onrank={rank}
              onclearrank={clearRanking}
              ontext={typeText}
            />
          </div>
        </div>
      {/key}

      <p class="sr-only pms-live" role="status" aria-live="polite">{announcement}</p>

      {#if saveFailed}
        <p class="pms-alert" role="alert">Your answers are kept on this device. Check the connection, then try again.</p>
      {/if}

      <ActionBar sticky={!preview}>
        {#if preview}
          <PillButton variant="secondary" disabled={index === 0} onclick={() => { index -= 1; startStep(); }}>Back</PillButton>
          <PillButton disabled={isLast} onclick={() => void next()}>Next</PillButton>
        {:else}
          {#if retrying}
            <PillButton onclick={() => void retry()}>Retry</PillButton>
          {:else}
            <PillButton disabled={!settled || saving} onclick={() => void next()}>{primaryLabel}</PillButton>
          {/if}
          <HomeButton onclick={goHome} />
        {/if}
      </ActionBar>
    {/if}
  {/if}
</section>

<style>
  .pms-pager {
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

  .pms-count {
    margin: 0 0 0.5rem;
    font: var(--fw-semibold) var(--fs-small) / 1.3 var(--font-sans);
  }

  .pms-step {
    margin-top: clamp(1.25rem, 4vw, 2rem);
    animation: pms-step-in 240ms ease both;
  }

  .pms-question {
    display: flex;
    gap: 0.6em;
    margin: 0;
    font: var(--fw-bold) var(--fs-question) / 1.35 var(--font-sans);
  }

  .pms-number {
    flex: none;
    min-width: 1.4em;
  }

  .pms-question span:last-child {
    min-width: 0;
    overflow-wrap: anywhere;
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

  /* An error sits on a white panel so it reads on any client colour. */
  .pms-alert {
    margin: 1rem 0 0;
    padding: 0.75rem 1rem;
    color: var(--on-plate);
    font: var(--fw-semibold) var(--fs-body) / 1.4 var(--font-sans);
    background: var(--plate);
    border-left: 6px solid var(--danger);
    border-radius: 0.5rem;
  }

  @keyframes pms-step-in {
    from { opacity: 0; transform: translateY(0.5rem); }
    to { opacity: 1; transform: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .pms-step { animation: none; }
  }
</style>
