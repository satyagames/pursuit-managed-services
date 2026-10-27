<script lang="ts">
  // The confidence check, Before (#/check-in) and After (#/check-out) (Phase 20): one screen for both, the same question and the same cards.
  // Before is the visit's first step, ahead of every activity, and cannot be skipped; After is its last, just before Thank you. Where a visit
  // goes is lib/participant/confidence-check.js nextStep()'s (asked through participantData.visitStep), so a bookmark, a reload or Back lands
  // on the right step. The answer is kept like any other (recordCheckAnswer) and Continue never waits for the network. A picked card is kept
  // in this tab until it is confirmed, so a reload shows it picked. The Before answer is never shown on the After screen (it could pull the
  // second answer towards the first). Laid out on the golden-ratio grid of styles/check-tokens.css.
  import { onMount, tick } from 'svelte';
  import { PillButton } from '../components/index.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { motion } from '../lib/motion/motion.js';
  import { loadActivity, sessionCheck } from '../lib/participant/experience.svelte.js';
  import { navigateTo } from '../lib/participant/navigation.js';
  import { arrowKeys } from '../lib/participant/roving.js';
  import {
    checkAnswer, checkPick, getKnownProgress, loadFailure, recordCheckAnswer, setCheckPick, visitStep, visitStepPath, type CheckPhase,
  } from '../lib/participant/participantData.js';
  import { participant } from '../lib/participant/session.svelte.js';
  import '../styles/check-tokens.css';

  // `preview`: the facilitator's preview of the client (index.html?preview=<clientId>): the screen as a guest sees it, read-only.
  let { phase = 'before', preview = false }: { phase?: CheckPhase; preview?: boolean } = $props();

  type Card = { id: string; value: number; label: string };
  let heading = $state<HTMLElement>();
  let prompt = $state('');
  let cards = $state<Card[]>([]);
  let picked = $state<string | null>(null);
  let ready = $state(false);
  let error = $state('');
  /** An arrow key moved the focus: the card it lands on is picked, as in any radio group. */
  let arrowed = false;

  const before = $derived(phase === 'before');
  const chip = $derived(before ? 'Before we begin' : 'Before you go');
  const helper = $derived(before ? 'There is no right or wrong answer. We will ask this once more at the end.' : 'There is no right or wrong answer. Answer for how you feel now.');
  const action = $derived(before ? 'Continue' : 'Finish');
  const uid = $props.id();

  /** Is this visit on the right step for this screen? Where it belongs otherwise; null when it is here. */
  async function elsewhere(): Promise<string | null> {
    if (!participant.clientTrackId || !participant.sessionId) return '/welcome';
    if (!sessionCheck()) return '/agenda';
    if (before) return checkAnswer('before') ? visitStepPath() : null;
    if (checkAnswer('after')) return '/thank-you';
    const progress = await getKnownProgress(participant.sessionId, participant.clientTrackId);
    const needed = progress.sections.filter((section) => (section.questionIds ?? []).length > 0);
    const allDone = needed.length > 0 && needed.every((section) => section.complete);
    return visitStep({ allDone, finishing: true }) === 'check-out' ? null : visitStepPath({ allDone, finishing: true });
  }

  onMount(() => {
    let active = true;
    void (async () => {
      try {
        if (!preview) {
          const away = await elsewhere();
          if (away) { if (active) await navigateTo(away, true); return; }
        }
        const check = sessionCheck({ preview });
        const loaded = check ? await loadActivity(check.section.id) : null;
        const question = loaded?.questions.find((each) => each.id === check?.questionId) ?? null;
        if (!active) return;
        if (!question) { error = 'This question is not available right now.'; ready = true; return; }
        prompt = question.prompt;
        cards = question.options
          .map((option, at) => ({ id: option.id, value: Number(option.value) || at + 1, label: option.label }))
          .sort((left, right) => left.value - right.value);
        const held = preview ? null : checkPick(phase);
        picked = cards.some((card) => card.id === held) ? held : null;
        ready = true;
        await tick();
        if (active) focusHeading(heading);
      } catch (cause) {
        if (active) { error = loadFailure(cause, 'Could not load this question.'); ready = true; }
      }
    })();
    return () => { active = false; };
  });

  function pick(id: string) {
    if (preview) return;
    picked = id;
    setCheckPick(phase, id);
  }

  function confirm() {
    if (preview || !picked) return;
    recordCheckAnswer(phase, picked);
    // (Saving goes on in the background, as for every answer: the next screen does not wait for it.)
    void navigateTo(before ? visitStepPath() : '/thank-you');
  }

  const onGroupKeydown = (event: KeyboardEvent) => { arrowed = /^Arrow|^Home$|^End$/.test(event.key); };
  // The one card in the tab order: the picked one, or the first.
  const tabOf = (card: Card, at: number) => (picked ? (card.id === picked ? 0 : -1) : (at === 0 ? 0 : -1));
</script>

<svelte:head>{#if !preview}<title>{chip} | {APP_NAME}</title>{/if}</svelte:head>

<section class="pms-check" aria-busy={!ready} data-phase={phase}>
  {#if !ready}
    <!-- (Nothing for the first moment: the question is usually held already.) -->
  {:else if error}
    <p class="pms-check-alert" role="alert">{error}</p>
  {:else}
    <div class="pms-check-ask" use:motion={{ role: 'title' }}>
      <p class="pms-check-chip">{chip}</p>
      <h1 class="pms-check-question" id="{uid}-question" bind:this={heading} tabindex="-1">{prompt}</h1>
      <p class="pms-check-helper">{helper}</p>
    </div>

    <div class="pms-check-panel">
      <p class="pms-check-hint" id="{uid}-hint">Tap the one that fits best</p>
      <div class="pms-check-cards" role="radiogroup" aria-labelledby="{uid}-question" aria-describedby="{uid}-hint" use:arrowKeys onkeydowncapture={onGroupKeydown}>
        {#each cards as card, at (card.id)}
          <button
            type="button"
            role="radio"
            class="pms-check-card"
            aria-checked={picked === card.id}
            aria-disabled={preview ? 'true' : undefined}
            tabindex={tabOf(card, at)}
            data-picked={picked === card.id}
            onclick={() => pick(card.id)}
            onfocus={() => { if (arrowed) { arrowed = false; pick(card.id); } }}
            use:motion={{ role: 'options', type: 'confidence-continuum', index: at, count: cards.length }}
          >
            <span class="pms-check-value" aria-hidden="true">{card.value}</span>
            <span class="pms-check-label">{card.label}</span>
            <span class="pms-check-tick" aria-hidden="true">{picked === card.id ? '✓' : ''}</span>
          </button>
        {/each}
      </div>
      <div class="pms-check-action">
        <PillButton disabled={preview || !picked} onclick={confirm}>{action}</PillButton>
      </div>
    </div>
  {/if}
</section>

<style>
  /* The screen fills the stage below the header. Portrait: the question in the upper 61.8%, centred near the 38.2% line (its spacers are
     1.618 to 1, so a short question sits on the line and a long one a little lower), and the answer panel in the lower 38.2%. */
  .pms-check {
    display: grid;
    grid-template-rows: minmax(0, var(--check-major)) minmax(min-content, var(--check-minor));
    flex: 1;
    min-height: min(calc(100dvh - 9rem), calc(var(--check-frame-height) - var(--check-header)));
    gap: 0;
  }

  .pms-check-ask {
    display: grid;
    grid-template-rows: 1.618fr auto auto auto 1fr;
    min-width: 0;
    padding-bottom: var(--check-space-4);
  }

  .pms-check-chip {
    grid-row: 2;
    justify-self: start;
    margin: 0;
    padding: var(--check-space-1) var(--check-space-3);
    font: var(--fw-semibold) var(--check-type-1) / 1.3 var(--font-sans);
    border: 2px solid var(--surface-border);
    border-radius: var(--radius-full);
  }

  .pms-check-question {
    grid-row: 3;
    margin: var(--check-space-3) 0 0;
    font: var(--fw-bold) clamp(var(--check-type-2), 5.47vw, var(--check-type-3)) / 1.2 var(--font-sans);
    overflow-wrap: anywhere;
  }

  .pms-check-helper {
    grid-row: 4;
    margin: var(--check-space-3) 0 0;
    color: var(--text-soft);
    font: var(--fw-regular) var(--check-type-1) / 1.5 var(--font-sans);
  }

  /* The answer panel, tinted, from the 61.8% line to the foot: the hint, the five cards, the button under the thumb. */
  .pms-check-panel {
    display: flex;
    flex-direction: column;
    gap: var(--check-space-3);
    margin-inline: calc(-1 * var(--gutter));
    padding: var(--check-space-4) var(--gutter) var(--check-space-3);
    background: var(--surface);
    border-top: 2px solid var(--surface-border);
  }

  .pms-check-hint {
    margin: 0;
    font: var(--fw-regular) var(--check-type-1) / 1.4 var(--font-sans);
    color: var(--text-soft);
  }

  .pms-check-cards {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--check-card-gap);
  }

  .pms-check-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--check-space-2);
    box-sizing: border-box;
    aspect-ratio: var(--check-card-ratio);
    min-width: 0;
    min-height: var(--target-min);
    padding: var(--check-space-3) var(--check-space-1) var(--check-space-2);
    color: var(--text);
    font-family: var(--font-sans);
    text-align: center;
    background: var(--bg-bottom);
    border: 2px solid var(--surface-border);
    border-radius: var(--check-space-2);
    cursor: pointer;
  }

  .pms-check-value {
    font: var(--fw-bold) clamp(var(--check-type-2), 5.47vw, var(--check-type-3)) / 1.2 var(--font-sans);
  }

  .pms-check-label {
    font: var(--fw-regular) var(--check-type-1) / 1.3 var(--font-sans);
    overflow-wrap: anywhere;
  }

  .pms-check-tick {
    min-height: 1.3em;
    margin-top: auto;
    font: var(--fw-bold) var(--check-type-2) / 1 var(--font-sans);
  }

  /* Picked: the page's own picked answer (OptionPill), filled with the action colour and ringed, and a tick: never colour alone. */
  .pms-check-card[data-picked='true'] {
    background: var(--action);
    box-shadow: inset 0 0 0 3px var(--text);
  }

  .pms-check-card[aria-disabled='true'] {
    cursor: default;
  }

  .pms-check-action {
    display: flex;
    justify-content: center;
    margin-top: auto;
    padding-top: var(--check-space-2);
  }

  .pms-check-action :global(.pill-button) {
    width: calc(100% / var(--check-phi));
    min-height: max(var(--check-button-height), var(--target-min));
  }

  .pms-check-alert {
    margin: 0;
    padding: 0.75rem 1rem;
    color: var(--on-plate);
    font: var(--fw-semibold) var(--fs-body) / 1.4 var(--font-sans);
    background: var(--plate);
    border-left: 6px solid var(--danger);
    border-radius: 0.5rem;
  }

  /* Landscape: the split turns a quarter: the question in the left 61.8%, the cards stacked in the right 38.2%, each at least 89 px high. */
  @media (orientation: landscape) and (min-width: 600px) {
    .pms-check {
      grid-template-rows: none;
      grid-template-columns: minmax(0, var(--check-major)) minmax(0, var(--check-minor));
      column-gap: var(--check-space-4);
    }

    .pms-check-ask {
      grid-template-rows: 1fr auto auto auto 1fr;
      padding-bottom: 0;
    }

    .pms-check-panel {
      margin: 0 calc(-1 * var(--gutter)) 0 0;
      padding: var(--check-space-3) var(--gutter) var(--check-space-3) var(--check-space-4);
      border-top: 0;
      border-left: 2px solid var(--surface-border);
    }

    .pms-check-cards {
      grid-template-columns: none;
      grid-auto-rows: minmax(var(--check-card-stacked-min), 1fr);
    }

    .pms-check-card {
      flex-direction: row;
      justify-content: flex-start;
      aspect-ratio: auto;
      padding: var(--check-space-2) var(--check-space-3);
      text-align: left;
    }

    .pms-check-value {
      min-width: 1.4em;
      font-size: var(--check-type-2);
    }

    .pms-check-tick {
      margin: 0 0 0 auto;
    }

    .pms-check-action :global(.pill-button) {
      width: 100%;
    }
  }

  /* A phone (under 600 px wide): the cards become full-width rows, each at least 55 px high. */
  @media (max-width: 599.98px) {
    .pms-check {
      grid-template-rows: auto auto;
    }

    .pms-check-ask {
      grid-template-rows: 0 auto auto auto 0;
      padding-bottom: var(--check-space-3);
    }

    .pms-check-cards {
      grid-template-columns: none;
      grid-auto-rows: minmax(var(--check-card-row-min), auto);
      gap: var(--check-space-1);
    }

    .pms-check-card {
      flex-direction: row;
      justify-content: flex-start;
      aspect-ratio: auto;
      padding: var(--check-space-1) var(--check-space-3);
      text-align: left;
    }

    .pms-check-value {
      min-width: 1.4em;
      font-size: var(--check-type-2);
    }

    .pms-check-tick {
      margin: 0 0 0 auto;
    }

    .pms-check-action :global(.pill-button) {
      width: 100%;
    }
  }
</style>
