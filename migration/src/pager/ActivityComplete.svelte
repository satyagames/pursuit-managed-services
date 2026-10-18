<script lang="ts">
  import { onMount } from 'svelte';
  import { CheckBadge, HomeButton, PillButton } from '../components/index.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { hiLine } from '../lib/participant/pager-logic.js';
  import { motion } from '../lib/motion/motion.js';

  let { name, title, right, total, allDone, onback, onfinish, onhome }: {
    name: string;
    /** The activity just finished. */
    title: string;
    /** Graded questions answered right on the first try, out of `total`. */
    right: number;
    total: number;
    /** Every activity is finished, so the finale is next. */
    allDone: boolean;
    onback: () => void;
    onfinish: () => void;
    onhome: () => void;
  } = $props();

  let heading = $state<HTMLElement>();
  onMount(() => { focusHeading(heading); });

  const headline = $derived(name ? `Nice work, ${name}!` : 'Nice work!');
  const summary = $derived(total > 0 ? `${right} of ${total} right on the first try` : 'Thanks for sharing');
</script>

<div class="pms-complete" use:motion={{ role: 'card' }}>
  <CheckBadge />
  <h1 bind:this={heading} tabindex="-1">{headline}</h1>
  <p class="pms-complete-summary" role="status">{summary}</p>
  <p class="pms-complete-title">{title}</p>
  <div class="pms-complete-actions">
    {#if allDone}
      <PillButton onclick={onfinish}>Finish</PillButton>
      <PillButton variant="secondary" onclick={onback}>Back to activities</PillButton>
    {:else}
      <PillButton onclick={onback}>Back to activities</PillButton>
    {/if}
    <HomeButton onclick={onhome} />
  </div>
</div>

<style>
  .pms-complete {
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

  .pms-complete-summary {
    margin: 0;
    font: var(--fw-semibold) var(--fs-description) / 1.3 var(--font-sans);
  }

  .pms-complete-title {
    margin: 0;
    color: var(--text-soft);
    font: var(--fw-light) var(--fs-body) / 1.4 var(--font-sans);
  }

  .pms-complete-actions {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: clamp(0.75rem, 2.4vw, 1.25rem);
    margin-top: clamp(0.5rem, 3vw, 1.5rem);
  }
</style>
