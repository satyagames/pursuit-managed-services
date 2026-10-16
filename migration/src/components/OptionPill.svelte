<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { AnswerState } from './types.js';

  let { label, letter, state = 'default', announce = true, ...rest }: Omit<HTMLButtonAttributes, 'children'> & {
    /** The answer text. */
    label: string;
    /** A, B, C ... shown before the text. */
    letter?: string;
    state?: AnswerState;
    /** Announce the verdict through the pill's own live region. A screen that announces the outcome itself turns this off. */
    announce?: boolean;
  } = $props();

  // Correct and wrong are never colour alone: an icon and a word are printed in the pill too,
  // and the word is announced politely when the state changes.
  const verdict = $derived(state === 'correct' ? 'Correct' : state === 'incorrect' ? 'Incorrect' : '');
</script>

<div class="option-pill">
  <button
    type="button"
    class="pill"
    data-state={state}
    aria-pressed={state === 'selected' ? true : undefined}
    disabled={state === 'disabled'}
    {...rest}
  >
    {#if letter}<span class="letter" aria-hidden="true">{letter}</span>{/if}
    <span class="label">{label}</span>
    {#if verdict}
      <span class="verdict">
        <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">
          {#if state === 'correct'}
            <path d="m3 8.5 3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          {:else}
            <path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          {/if}
        </svg>
        {verdict}
      </span>
    {/if}
  </button>
  {#if announce}<span class="sr-only" aria-live="polite">{verdict}</span>{/if}
</div>

<style>
  .option-pill {
    display: block;
  }

  /* The letter, the words and the verdict ("Correct", "Incorrect") share a row, and when the text is made larger (200% is what a phone's text-size setting or
     the browser's zoom gives) or the window is narrow, the verdict goes under the words instead of pushing the pill wider than the screen (Phase 8: at 200% on
     a phone the answer pills reached 57 px past the edge). */
  .pill {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--option-h);
    padding: 0.5rem clamp(0.75rem, 4vw, 1.5rem);
    color: var(--text);
    font: var(--fw-regular) var(--fs-option) / 1.3 var(--font-sans);
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--option-radius);
    cursor: pointer;
    transition: background-color 160ms ease, border-color 160ms ease, transform 160ms ease;
  }

  .pill:active:not(:disabled) {
    transform: scale(0.985);
  }

  .letter {
    flex: none;
    min-width: 1.1em;
  }

  .label {
    flex: 1 1 8ch;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .verdict {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.35em;
    font-size: 1rem;
    font-weight: var(--fw-bold);
  }

  .pill[data-state='selected'] {
    background: var(--action);
    box-shadow: inset 0 0 0 1px var(--surface-border);
  }

  .pill[data-state='correct'] {
    color: var(--on-success);
    background: var(--success);
    border-color: var(--success);
  }

  .pill[data-state='incorrect'] {
    color: #fff;
    background: var(--danger);
    border-color: var(--surface-border);
  }

  .pill[data-state='disabled'] {
    color: var(--on-disabled);
    background: var(--disabled);
    border-color: color-mix(in srgb, var(--on-disabled) 45%, transparent);
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    .pill { transition: none; }
    .pill:active:not(:disabled) { transform: none; }
  }
</style>
