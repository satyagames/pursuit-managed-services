<script lang="ts">
  import { onMount } from 'svelte';
  import { MAX_ACTIVITY_TITLE, cleanTitle, titleProblem } from '../lib/admin/admin-content.js';

  // Adding an activity, or renaming one and editing its description. A real <dialog> opened with
  // showModal(): the page behind is inert and Escape cancels. The name must read differently from the
  // client's other activities (copying skips an activity whose title the client already has).
  let { mode, title = '', description = '', siblings, ignoreId = null, clientName, busy = false, onSave, onCancel }: {
    mode: 'add' | 'edit';
    title?: string;
    description?: string;
    /** The client's other activities, for the "already has an activity called" check. */
    siblings: { id: string; title?: string }[];
    ignoreId?: string | null;
    clientName: string;
    busy?: boolean;
    onSave: (title: string, description: string) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let nameInput = $state<HTMLInputElement>();
  let name = $state('');
  let about = $state('');
  let submitted = $state(false);
  const problem = $derived(titleProblem(name, siblings, ignoreId));

  onMount(() => {
    name = title;
    about = description;
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    nameInput?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      // The dialog is removed with its state, so the browser cannot return focus: do it, if what opened it is still there.
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    submitted = true;
    if (problem || busy) return;
    onSave(cleanTitle(name), about.trim());
  }
</script>

<dialog bind:this={dialog} class="adm-dialog" aria-labelledby="activity-form-title" oncancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
  <form class="adm-dialog__body" onsubmit={submit} novalidate>
    <h2 id="activity-form-title">{mode === 'add' ? 'Add an activity' : 'Rename and describe'}</h2>
    {#if mode === 'add'}<p class="muted">It goes after the last activity of {clientName} and is not live until you switch it on.</p>{/if}
    <div class="field">
      <label class="field__label" for="activity-name">Name</label>
      <input id="activity-name" class="input" bind:this={nameInput} bind:value={name} maxlength={MAX_ACTIVITY_TITLE} autocomplete="off" disabled={busy} aria-invalid={submitted && Boolean(problem)} aria-describedby={submitted && problem ? 'activity-name-problem' : undefined} />
      {#if submitted && problem}<span id="activity-name-problem" class="error small" role="alert">{problem}</span>{/if}
    </div>
    <div class="field">
      <label class="field__label" for="activity-description">Description</label>
      <textarea id="activity-description" class="input" rows="3" bind:value={about} placeholder="One line under the name on the activities screen" disabled={busy}></textarea>
    </div>
    <div class="dialog__actions">
      <button class="btn" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving...' : mode === 'add' ? 'Add activity' : 'Save'}</button>
    </div>
  </form>
</dialog>
