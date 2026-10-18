<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { AnswerState } from './types.js';
  import { motion as move, type MotionParams } from '../lib/motion/motion.js';

  let { src, alt = '', label, state = 'default', announce = true, motion = null, ...rest }: Omit<HTMLButtonAttributes, 'children'> & {
    /** Brand image. Without it the tile shows `label` as text. */
    src?: string;
    /** What the image shows, e.g. the brand name. It becomes the button's accessible name. */
    alt?: string;
    /** Text shown on the tile when there is no image (and the fallback name when `alt` is empty). */
    label?: string;
    state?: AnswerState;
    /** Announce the verdict through the tile's own live region. A screen that announces the outcome itself turns this off. */
    announce?: boolean;
    /** Its part in the screen's motion (lib/motion/motion.ts): its place among the answers. Its verdict is added from `state`. */
    motion?: MotionParams | null;
  } = $props();

  const verdict = $derived(state === 'correct' ? 'Correct' : state === 'incorrect' ? 'Incorrect' : '');
  const moving = $derived(motion ? { ...motion, label: label || alt, verdict: state === 'correct' || state === 'incorrect' || state === 'selected' ? state : null } : null);

  /**
   * A picture that cannot be loaded (its file was removed, the address is wrong, the library cannot be read) must not leave an
   * empty tile: the answer is shown in words instead, as it is for a tile with no picture. Done on the elements themselves (this
   * component has a prop called `state`, so it cannot hold a rune of that name); the markup is keyed on the address, so a new
   * address is tried afresh.
   */
  function wordsInstead(event: Event) {
    const picture = event.currentTarget as HTMLImageElement;
    picture.style.display = 'none';
    const words = picture.nextElementSibling as HTMLElement | null;
    if (!words) return;
    // From here on it is a text tile like any other: the same class, so the same style (and what a test of text tiles counts).
    words.classList.add('text');
    words.style.display = '';
  }
</script>

<div class="tile-wrap" use:move={moving}>
  <button
    type="button"
    class="tile"
    data-state={state}
    aria-pressed={state === 'selected' ? true : undefined}
    disabled={state === 'disabled'}
    aria-label={src ? alt || label || undefined : undefined}
    {...rest}
  >
    {#if src}
      {#key src}
        <img class="logo" {src} alt="" onerror={wordsInstead} />
        <span class="tile-words" style="display: none">{label || alt}</span>
      {/key}
    {:else}
      <span class="text">{label}</span>
    {/if}
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
  .tile-wrap {
    display: block;
    min-width: 0;
  }

  .tile {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--tile-h);
    padding: 1rem;
    color: var(--text);
    font: var(--fw-bold) var(--fs-option) / 1.25 var(--font-sans);
    text-align: center;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--tile-radius);
    cursor: pointer;
    transition: background-color var(--motion-duration-quick) var(--motion-ease-standard), border-color var(--motion-duration-quick) var(--motion-ease-standard), transform var(--motion-duration-quick) var(--motion-ease-standard);
  }

  .tile:active:not(:disabled) {
    transform: scale(0.985);
  }

  .logo {
    display: block;
    box-sizing: border-box;
    max-width: 100%;
    max-height: calc(var(--tile-h) - 2rem);
    padding: 0.5rem 0.75rem;
    object-fit: contain;
    background: var(--plate);
    border-radius: calc(var(--tile-radius) * 0.6);
  }

  .tile[data-state='correct'] .logo,
  .tile[data-state='incorrect'] .logo {
    transform: translateY(-0.9rem) scale(0.8);
  }

  .text,
  .tile-words {
    overflow-wrap: anywhere;
  }

  .verdict {
    position: absolute;
    right: 0.75rem;
    bottom: 0.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.1rem 0.6rem;
    font-size: 1rem;
    font-weight: var(--fw-bold);
    border-radius: var(--radius-full);
  }

  .tile[data-state='selected'] {
    background: var(--action);
    box-shadow: inset 0 0 0 2px var(--surface-border);
  }

  /* The mockup turns the right answer white with a green frame ... */
  .tile[data-state='correct'] {
    color: #000102;
    background: #fff;
    border-color: var(--success);
    box-shadow: inset 0 0 0 3px var(--success);
  }

  .tile[data-state='correct'] .verdict {
    color: var(--on-success);
    background: var(--success);
  }

  /* ... and the wrong pick purple-tinted with a red frame. */
  .tile[data-state='incorrect'] {
    background: var(--danger-tint);
    border-color: var(--danger);
    box-shadow: inset 0 0 0 3px var(--danger);
  }

  .tile[data-state='incorrect'] .verdict {
    color: #fff;
    background: var(--danger);
  }

  .tile[data-state='disabled'] {
    color: var(--on-disabled);
    background: var(--disabled);
    border-color: color-mix(in srgb, var(--on-disabled) 45%, transparent);
    cursor: not-allowed;
  }

  .tile[data-state='disabled'] .logo {
    opacity: 0.45;
  }

  @media (prefers-reduced-motion: reduce) {
    .tile { transition: none; }
    .tile:active:not(:disabled) { transform: none; }
  }
</style>
