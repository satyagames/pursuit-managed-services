<script lang="ts">
  // The Live display's admin view, in the order the facilitator works (Prompt 34, on Prompt 33's rule 4): 1 check the room is ready (how many
  // answered, the confidence check's counts, Refresh), 2 show the wall (the one main action, full screen), 3 share it (the wall's own address,
  // in a new tab, for a second screen). Under them one Download group, each button with its verb and its format. A step is "done" only where the
  // page knows it: the room has answered. Nothing here reads anything; every press is LiveDisplay's.
  import type { ComponentProps } from 'svelte';
  import Icon from './Icon.svelte';
  import LiveCheckCard from './LiveCheckCard.svelte';

  let {
    meta, answers, check, exporting, newTabAddress, onExport, onRefresh, onEnter,
  }: {
    /** "48 answers from 6 iPads · updated 11:59:18". */
    meta: string;
    /** How many answers are in: step 1 is done once there are any. */
    answers: number;
    /** The confidence check, when the session asks it (LiveCheckCard's counts). */
    check: ComponentProps<typeof LiveCheckCard>['check'] | null | undefined;
    /** The download in progress ('' when none). */
    exporting: string;
    newTabAddress: string;
    onExport: (kind: 'csv' | 'pdf' | 'pptx') => void;
    onRefresh: () => void;
    onEnter: () => void;
  } = $props();

  const ready = $derived(answers > 0);
  const step = $derived(ready ? 2 : 1);
  const downloads = [
    { kind: 'pdf', label: 'Download PDF pack' },
    { kind: 'pptx', label: 'Download PowerPoint pack' },
    { kind: 'csv', label: 'Download CSV' },
  ] as const;
</script>

<ol class="steps live-steps" aria-label="Steps">
  <li class="step" aria-current={step === 1 ? 'step' : undefined} data-done={ready}>
    <h3 class="step__title"><span class="step__mark" aria-hidden="true">{#if ready}<Icon name="check" size={18} />{:else}1{/if}</span><span class="sr-only">Step 1{ready ? ', done' : ''}:</span>Check the room is ready{#if step === 1}<span class="step__now">Do this now</span>{/if}</h3>
    <p class="step__summary live__meta" aria-live="off" data-testid="live-meta">{meta}</p>
    {#if check}<LiveCheckCard {check} />{/if}
    <div class="step__actions"><button class="btn" type="button" onclick={onRefresh} title="Read the questions and answers again now">Refresh</button></div>
  </li>
  <li class="step" aria-current={step === 2 ? 'step' : undefined}>
    <h3 class="step__title"><span class="step__mark" aria-hidden="true">2</span><span class="sr-only">Step 2:</span>Show the wall{#if step === 2}<span class="step__now">Do this now</span>{/if}</h3>
    <p class="step__why">One question at a time, large, with nobody's name.</p>
    <div class="step__actions"><button class="btn btn--primary" type="button" onclick={onEnter}>Show the wall full screen</button></div>
  </li>
  <li class="step">
    <h3 class="step__title"><span class="step__mark" aria-hidden="true">3</span><span class="sr-only">Step 3:</span>Share the wall</h3>
    <p class="step__why">For a second screen or the room's computer.</p>
    <div class="step__actions"><a class="btn" href={newTabAddress} target="_blank" rel="noopener">Open the wall in a new tab</a></div>
  </li>
</ol>

<section class="live-downloads" aria-labelledby="live-downloads-title">
  <h3 id="live-downloads-title" class="live-downloads__title"><Icon name="download" />Download</h3>
  <p class="live-downloads__lead">The session's results as a pack for leaders, or as a table.</p>
  <div class="live-downloads__buttons">
    {#each downloads as download (download.kind)}
      <button class="btn live-downloads__button" type="button" onclick={() => onExport(download.kind)} disabled={!!exporting}>
        <Icon name="download" />{exporting === download.kind ? 'Downloading...' : download.label}
      </button>
    {/each}
  </div>
</section>

<style>
  .live-steps {
    margin: 0;
  }

  .live-downloads {
    display: grid;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.65rem;
  }

  .live-downloads__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.1rem;
  }

  .live-downloads__title > :global(.icon) {
    color: var(--adm-deep);
  }

  .live-downloads__lead {
    margin: 0;
    color: var(--adm-muted);
  }

  .live-downloads__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .live-downloads__button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
