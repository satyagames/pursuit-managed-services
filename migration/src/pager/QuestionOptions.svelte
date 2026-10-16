<script lang="ts">
  import { LogoTile, OptionPill, PillButton } from '../components/index.js';
  import type { AnswerState } from '../components/index.js';
  import { arrowKeys } from '../lib/roving.js';
  import {
    MAX_TEXT_LENGTH, gradedOptionState, isGraded, letterFor, showsLetters, usesTiles,
    type Answer, type GradedState, type Question,
  } from '../lib/pager-logic.js';

  let { question, labelledby, graded, draft, preview = false, showKey = false, onchoose, ontoggle, onrank, onclearrank, ontext }: {
    question: Question;
    /** Id of the heading that names the group. */
    labelledby: string;
    /** The feedback state of a graded question. */
    graded: GradedState;
    /** What has been picked or typed so far on an ungraded one. */
    draft: Answer | undefined;
    /** Read-only. */
    preview?: boolean;
    /**
     * With `preview`: mark the right answers. Off unless asked, because `index.html?preview=<clientId>` has no PIN and must never carry
     * the answer key (Phase 9b, SEC-1); only the facilitator's Content preview, behind the admin PIN, asks for it.
     */
    showKey?: boolean;
    onchoose: (optionId: string) => void;
    ontoggle: (optionId: string) => void;
    onrank: (optionId: string) => void;
    onclearrank: () => void;
    ontext: (value: string) => void;
  } = $props();

  const tiles = $derived(usesTiles(question));
  const letters = $derived(showsLetters(question));
  const isGradedQuestion = $derived(isGraded(question));
  const list = $derived(Array.isArray(draft) ? draft : []);

  function stateOf(optionId: string): AnswerState {
    if (preview) return showKey && question.options.find((option) => option.id === optionId)?.correct === true ? 'correct' : 'default';
    if (isGradedQuestion) return gradedOptionState(question, graded, optionId);
    if (question.type === 'multi-select' || question.type === 'ranked-voting') return list.includes(optionId) ? 'selected' : 'default';
    return draft === optionId ? 'selected' : 'default';
  }

  // The first tap on a graded question is the only one that counts; once it is answered the
  // options stay put (Retry clears them), so a stray second tap changes nothing.
  const locked = $derived(isGradedQuestion && graded.phase !== 'choosing');

  function tap(optionId: string) {
    if (preview) return;
    if (question.type === 'multi-select') ontoggle(optionId);
    else if (question.type === 'ranked-voting') onrank(optionId);
    else onchoose(optionId);
  }

  const rankOf = (optionId: string) => list.indexOf(optionId) + 1;
  const typed = $derived(typeof draft === 'string' ? draft.length : 0);
  const uid = $props.id();
</script>

{#if question.type === 'open-text-feedback'}
  <textarea
    class="pms-text"
    rows="6"
    maxlength={MAX_TEXT_LENGTH}
    aria-labelledby={labelledby}
    aria-describedby={preview ? undefined : `${uid}-count`}
    placeholder="Share your thoughts..."
    disabled={preview}
    value={typeof draft === 'string' ? draft : ''}
    oninput={(event) => ontext(event.currentTarget.value)}
  ></textarea>
  {#if !preview}
    <p class="pms-count-text" id="{uid}-count" class:pms-count-full={typed >= MAX_TEXT_LENGTH}>
      {typed} of {MAX_TEXT_LENGTH} characters{typed >= MAX_TEXT_LENGTH ? '. That is the most an answer can hold.' : ''}
    </p>
  {/if}
{:else}
  {#if question.type === 'ranked-voting' && !preview}
    <p class="pms-hint">Tap your choices in order: the first you tap is your top choice.</p>
  {:else if question.type === 'multi-select' && !preview}
    <p class="pms-hint">Choose all that apply.</p>
  {/if}
  <div class="pms-options" class:pms-grid={tiles} role="group" aria-labelledby={labelledby} inert={preview} use:arrowKeys>
    {#each question.options as option, index (option.id)}
      {#if tiles}
        <LogoTile
          src={option.imageUrl || undefined}
          alt={option.label}
          label={option.label}
          state={stateOf(option.id)}
          announce={false}
          aria-disabled={locked ? 'true' : undefined}
          onclick={() => tap(option.id)}
        />
      {:else if question.type === 'ranked-voting'}
        <OptionPill
          label={option.label}
          letter={rankOf(option.id) ? String(rankOf(option.id)) : '–'}
          state={stateOf(option.id)}
          announce={false}
          aria-label={rankOf(option.id) ? `${option.label}, rank ${rankOf(option.id)}` : `${option.label}, not ranked`}
          onclick={() => tap(option.id)}
        />
      {:else}
        <OptionPill
          label={option.label}
          letter={letters ? letterFor(index) : undefined}
          state={stateOf(option.id)}
          announce={false}
          aria-disabled={locked ? 'true' : undefined}
          onclick={() => tap(option.id)}
        />
      {/if}
    {/each}
  </div>
  {#if question.type === 'ranked-voting' && !preview && list.length > 0}
    <div class="pms-clear"><PillButton variant="secondary" size="md" onclick={onclearrank}>Clear ranking</PillButton></div>
  {/if}
{/if}

<style>
  .pms-options {
    display: grid;
    gap: 0.75rem;
    margin-top: clamp(1rem, 3vw, 1.5rem);
  }

  .pms-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: clamp(0.75rem, 3vw, 1.5rem);
  }

  .pms-hint {
    margin: 0.75rem 0 0;
    color: var(--text);
    font: var(--fw-light) var(--fs-body) / 1.4 var(--font-sans);
  }

  .pms-hint + .pms-options {
    margin-top: 0.75rem;
  }

  .pms-clear {
    margin-top: 1rem;
  }

  .pms-text {
    box-sizing: border-box;
    width: 100%;
    min-height: 9rem;
    margin-top: clamp(1rem, 3vw, 1.5rem);
    padding: 0.85rem 1.1rem;
    color: var(--on-plate);
    font: var(--fw-regular) var(--fs-body) / 1.45 var(--font-sans);
    background: var(--plate);
    border: 1px solid var(--surface-border);
    border-radius: 1.25rem;
    resize: vertical;
  }

  .pms-text::placeholder {
    color: color-mix(in srgb, var(--on-plate) 62%, var(--plate));
  }

  .pms-text:disabled {
    opacity: 0.75;
  }

  .pms-count-text {
    margin: 0.5rem 0 0;
    color: var(--text);
    font: var(--fw-light) var(--fs-small) / 1.4 var(--font-sans);
    text-align: right;
  }

  .pms-count-full {
    font-weight: var(--fw-semibold);
  }
</style>
