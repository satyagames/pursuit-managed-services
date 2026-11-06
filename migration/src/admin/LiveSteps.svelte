<script lang="ts">
  // The Live display's admin view, in the order the facilitator works (Prompt 34, on Prompt 33's rule 4): 1 check the room is ready (how many
  // answered, the confidence check's counts, Refresh), 2 show the wall (Dark or Light, then the one main action, full screen), 3 share it (the
  // wall's own address, in a new tab, for a second screen). Under them one Download row: the look of the packs and a button for
  // each file, with its verb and its format. A step is "done" only where the page knows it: the room has answered. Nothing here reads anything;
  // every press is LiveDisplay's.
  import type { ComponentProps } from 'svelte';
  import Icon from './Icon.svelte';
  import LiveCheckCard from './LiveCheckCard.svelte';
  import LookChoice, { type Look } from './LookChoice.svelte';

  let {
    meta, answers, check, exporting, newTabAddress, wallLook, fileLook, onWallLook, onFileLook, onExport, onRefresh, onEnter,
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
    wallLook: Look;
    fileLook: Look;
    onWallLook: (look: Look) => void;
    onFileLook: (look: Look) => void;
    onExport: (kind: 'csv' | 'pdf' | 'pptx') => void;
    onRefresh: () => void;
    onEnter: () => void;
  } = $props();

  const ready = $derived(answers > 0);
  const step = $derived(ready ? 2 : 1);
  const downloads = [
    { kind: 'pdf', label: 'Download PDF pack', icon: 'file' },
    { kind: 'pptx', label: 'Download PowerPoint pack', icon: 'slides' },
    { kind: 'csv', label: 'Download CSV', icon: 'sheet' },
  ] as const;
</script>

<div class="live-top">
  <ol class="steps live-steps" aria-label="Steps">
    <li class="step" aria-current={step === 1 ? 'step' : undefined} data-done={ready}>
      <h3 class="step__title"><span class="step__mark" aria-hidden="true">{#if ready}<Icon name="check" size={18} />{:else}1{/if}</span><span class="sr-only">Step 1{ready ? ', done' : ''}:</span>Check the room is ready{#if step === 1}<span class="step__now">Do this now</span>{/if}</h3>
      <p class="step__summary live__meta" aria-live="off" data-testid="live-meta">{meta}</p>
      {#if check}<LiveCheckCard {check} />{/if}
      <div class="step__actions"><button class="btn live-action" type="button" onclick={onRefresh} title="Read the questions and answers again now"><Icon name="refresh" />Refresh</button></div>
    </li>
    <li class="step" aria-current={step === 2 ? 'step' : undefined}>
      <h3 class="step__title"><span class="step__mark" aria-hidden="true">2</span><span class="sr-only">Step 2:</span>Show the wall{#if step === 2}<span class="step__now">Do this now</span>{/if}</h3>
      <p class="step__why">One question at a time, with nobody's name.</p>
      <LookChoice label="Wall" value={wallLook} onChange={onWallLook} />
      <div class="step__actions"><button class="btn btn--primary live-action" type="button" onclick={onEnter}><Icon name="screen" />Show the wall full screen</button></div>
    </li>
    <li class="step">
      <h3 class="step__title"><span class="step__mark" aria-hidden="true">3</span><span class="sr-only">Step 3:</span>Share the wall</h3>
      <p class="step__why">On a second screen or the room's computer.</p>
      <div class="step__actions"><a class="btn live-action" href={newTabAddress} target="_blank" rel="noopener"><Icon name="external" />Open the wall in a new tab</a></div>
    </li>
  </ol>

  <section class="live-downloads" aria-labelledby="live-downloads-title">
    <h3 id="live-downloads-title" class="live-downloads__title"><Icon name="download" />Download</h3>
    <LookChoice label="Packs" value={fileLook} onChange={onFileLook} />
    <div class="live-downloads__buttons">
      {#each downloads as download (download.kind)}
        <button class="btn live-action" type="button" onclick={() => onExport(download.kind)} disabled={!!exporting}>
          <Icon name={download.icon} />{exporting === download.kind ? 'Downloading...' : download.label}
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  /* The three steps across the page, as wide as it is, and Download as one row under them (one under the other on a narrow window). */
  .live-top {
    display: grid;
    gap: 1rem;
  }

  .live-steps {
    margin: 0;
  }

  .live-steps .step__now {
    white-space: nowrap;
  }

  .live-action {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .live-downloads {
    display: grid;
    align-content: start;
    gap: 1rem;
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

  .live-downloads__buttons {
    display: grid;
    gap: 0.5rem;
  }

  .live-downloads__buttons .live-action {
    justify-content: flex-start;
  }
  @media (min-width: 1100px) {
    .live-steps {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .live-downloads {
      grid-template-columns: auto auto 1fr;
      align-items: center;
      column-gap: 2rem;
    }

    .live-downloads__buttons {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }
</style>
