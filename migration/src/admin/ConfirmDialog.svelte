<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  // A confirmation the facilitator reads before anything changes. A real <dialog> opened with
  // showModal(): the page behind is inert, Escape cancels, and focus starts on Cancel so that Enter
  // never confirms by accident. Phase 16 (Delete session... on Results) added what an action with no undo needs, each optional so the
  // other uses are as they were: `tone` 'danger' for the confirming button, `status` (progress, in a status region), `error` (in an alert),
  // and `children`, shown under the points (Results puts the leader report's buttons there). `confirmText`, when given, must be typed
  // before the confirming button works: more friction for an action with no undo, off unless a screen asks for it (DECISIONS.md).
  let { title, lead, points = [], confirmLabel, cancelLabel = 'Cancel', busy = false, tone = 'primary', status = '', error = '', confirmText = '', children, onConfirm, onCancel }: {
    title: string;
    lead: string;
    points?: string[];
    confirmLabel: string;
    cancelLabel?: string;
    busy?: boolean;
    tone?: 'primary' | 'danger';
    status?: string;
    error?: string;
    children?: Snippet;
    confirmText?: string;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let cancel = $state<HTMLButtonElement>();
  let typed = $state('');
  const typedOk = $derived(!confirmText || typed.trim() === confirmText);

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
    {@render children?.()}
    {#if confirmText}<label class="field"><span class="field__label">Type {confirmText} to confirm</span><input class="input" bind:value={typed} autocomplete="off" disabled={busy} /></label>{/if}
    {#if error}<p class="confirm__error" role="alert">{error}</p>{/if}
    {#if status}<p class="confirm__status" role="status">{status}</p>{/if}
    <div class="confirm__actions">
      <button bind:this={cancel} class="btn" type="button" onclick={onCancel} disabled={busy}>{cancelLabel}</button>
      <button class={tone === 'danger' ? 'btn btn--danger-solid' : 'btn btn--primary'} type="button" onclick={onConfirm} disabled={busy || !typedOk}>{busy ? 'Working...' : confirmLabel}</button>
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

  /* The button of an action that cannot be undone: white on the fixed "wrong" red, 5.0:1 (styles/tokens.css). */
  .btn--danger-solid {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
  }

  .btn--danger-solid:hover:not(:disabled) {
    filter: brightness(0.93);
  }

  .confirm__error {
    margin: 0;
    color: var(--danger);
    font-weight: var(--fw-semibold);
  }

  .confirm__status {
    margin: 0;
  }

  .confirm__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.4rem;
  }
</style>
