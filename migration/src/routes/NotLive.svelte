<script lang="ts">
  import { onMount } from 'svelte';
  import { PillButton } from '../components/index.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { motion } from '../lib/motion/motion.js';

  // Shown instead of every participant screen while no client is live: nothing has been started
  // today, the client was archived, or today's session has ended. It names no client and wears
  // the default look. The page keeps checking by itself (a Reopen brings the activities back); the
  // button is for the impatient. The same "This session has ended" screen is what a page that was
  // already open shows on Welcome and the hub when the facilitator presses End session.
  let { reason = null, oncheck, announce = true }: {
    /** Why nothing is live (experience.reason). Only an ended session changes the wording. */
    reason?: string | null;
    oncheck: () => void;
    /** Move focus to the heading when the screen appears. Off only where it is shown as a sample (the styleguide). */
    announce?: boolean;
  } = $props();

  const ended = $derived(reason === 'session-ended');
  let heading = $state<HTMLElement>();
  onMount(() => { if (announce) focusHeading(heading); });
</script>

<svelte:head><title>{APP_NAME}</title></svelte:head>

<section class="pms-notlive" use:motion={{ role: 'card' }}>
  <h1 bind:this={heading} tabindex="-1">{ended ? 'This session has ended.' : "Today's experience isn't live yet"}</h1>
  <p class="pms-notlive-line">
    {ended ? 'Thank you. Your answers are saved.' : 'Your facilitator will start it shortly. This page will update by itself.'}
  </p>
  {#if !ended}
    <div class="pms-notlive-action">
      <PillButton variant="secondary" size="md" onclick={oncheck}>Check again</PillButton>
    </div>
  {/if}
</section>

<style>
  .pms-notlive {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(1rem, 3dvh, 1.75rem);
    text-align: center;
  }

  h1 {
    margin: 0;
    font: normal var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
    overflow-wrap: anywhere;
  }

  .pms-notlive-line {
    margin: 0;
    font: var(--fw-light) var(--fs-description) / 1.45 var(--font-sans);
  }

  .pms-notlive-action {
    margin-top: clamp(0.5rem, 2dvh, 1.5rem);
  }
</style>
