<script lang="ts">
  // A low-priority block, folded (Prompt 33, rule 5): one header row (chevron, icon, title, a count or one-line summary, and the word Show or
  // Hide) that is a real button with aria-expanded and aria-controls; the panel under it carries the `hidden` attribute while closed, so Tab
  // skips it. It starts closed. Open or closed lives in this component only: nothing is stored, so a reload closes it again. `open` is
  // bindable, so a screen can open it when a deep link or a search reaches something inside. What is inside loads as it did before: folding
  // reads nothing.
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let { title, summary = '', icon, open = $bindable(false), testid, children }: {
    title: string;
    /** The count or one line beside the title ("12 entries, latest 09:41"), read aloud with it. */
    summary?: string;
    icon?: IconName;
    open?: boolean;
    testid?: string;
    children?: Snippet;
  } = $props();

  const uid = $props.id();
</script>

<section class="fold" class:fold--open={open} aria-labelledby="{uid}-button" data-testid={testid}>
  <h3 class="fold__heading">
    <button id="{uid}-button" class="fold__button" type="button" aria-expanded={open} aria-controls="{uid}-panel" onclick={() => { open = !open; }}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} />
      {#if icon}<Icon name={icon} />{/if}
      <span class="fold__title">{title}</span>{#if summary}<span class="fold__summary"> · {summary}</span>{/if}
      <span class="fold__word">{open ? 'Hide' : 'Show'}</span>
    </button>
  </h3>
  <div id="{uid}-panel" class="fold__panel" hidden={!open}>
    {@render children?.()}
  </div>
</section>

<style>
  .fold {
    border: 1px solid var(--adm-line);
    border-radius: 0.65rem;
    background: var(--adm-card);
    margin-top: 1.5rem;
  }

  .fold__heading {
    margin: 0;
    font-size: 1.05rem;
  }

  .fold__button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: var(--target-min);
    padding: 0.5rem 1rem;
    border: 0;
    border-radius: 0.65rem;
    background: transparent;
    color: var(--adm-ink);
    font: inherit;
    font-weight: var(--fw-semibold);
    text-align: start;
    cursor: pointer;
  }

  .fold__button:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: -3px;
    box-shadow: inset 0 0 0 6px var(--adm-ink);
  }

  .fold__summary {
    color: var(--adm-muted);
    font-weight: var(--fw-regular);
  }

  .fold__word {
    margin-inline-start: auto;
    color: var(--adm-link);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .fold__panel {
    padding: 0 1rem 1rem;
  }

  @media (forced-colors: active) {
    .fold {
      border-color: CanvasText;
    }

    .fold__word {
      color: LinkText;
    }
  }
</style>
