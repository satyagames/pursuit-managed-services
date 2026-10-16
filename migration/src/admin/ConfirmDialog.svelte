<script lang="ts">
  import { onMount } from 'svelte';

  // A confirmation the facilitator reads before anything changes. A real <dialog> opened with
  // showModal(): the page behind is inert, Escape cancels, and focus starts on Cancel so that Enter
  // never confirms by accident.
  let { title, lead, points = [], confirmLabel, cancelLabel = 'Cancel', busy = false, onConfirm, onCancel }: {
    title: string;
    lead: string;
    points?: string[];
    confirmLabel: string;
    cancelLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let cancel = $state<HTMLButtonElement>();

  onMount(() => {
    dialog?.showModal();
    cancel?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  });
</script>

<dialog bind:this={dialog} class="confirm" aria-labelledby="confirm-title" oncancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
  <div class="confirm__body">
    <h2 id="confirm-title">{title}</h2>
    <p class="confirm__lead">{lead}</p>
    {#if points.length > 0}
      <ul class="confirm__points">
        {#each points as point}<li>{point}</li>{/each}
      </ul>
    {/if}
    <div class="confirm__actions">
      <button bind:this={cancel} class="btn" type="button" onclick={onCancel} disabled={busy}>{cancelLabel}</button>
      <button class="btn btn--primary" type="button" onclick={onConfirm} disabled={busy}>{busy ? 'Working...' : confirmLabel}</button>
    </div>
  </div>
</dialog>

<style>
  .confirm {
    width: min(34rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    overflow: auto;
    border: 0;
    border-radius: 1rem;
    color: var(--adm-ink);
    background: var(--adm-card);
    box-shadow: 0 1.5rem 4rem rgb(11 31 58 / 0.35);
  }

  .confirm::backdrop {
    background: rgb(11 31 58 / 0.55);
  }

  .confirm__body {
    display: grid;
    gap: 0.9rem;
    padding: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.35rem;
    font-weight: var(--fw-bold);
    line-height: 1.25;
  }

  .confirm__lead {
    margin: 0;
    font-weight: var(--fw-semibold);
  }

  .confirm__points {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding-left: 1.25rem;
    color: var(--adm-muted);
    line-height: 1.45;
  }

  .confirm__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
</style>
