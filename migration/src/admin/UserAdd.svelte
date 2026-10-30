<script lang="ts">
  // Add user (Prompt 21, Phase 2; board 4): search the firm's directory (or type a full email), then add the person. Adding gives them no access to
  // any client: they are given access from their own page afterwards. A real <dialog> opened with showModal(), like the other dialogs of this page.
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { addPerson } from '../lib/access/people-ops.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import UserPicker from './UserPicker.svelte';

  type Chosen = { email: string; name: string; loginName: string; jobTitle: string; source: 'Directory' | 'Typed' };
  let { access, onDone, onCancel }: {
    access: unknown;
    /** The key of the person added, or of the one who was there already. */
    onDone: (key: string, already: boolean) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let chosen = $state<Chosen | null>(null);
  let busy = $state(false);
  let error = $state('');

  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  });

  async function add() {
    if (!chosen || busy) return;
    busy = true;
    error = '';
    try {
      const done = await addPerson(dataService, access, chosen);
      onDone(done.key, done.already);
    } catch (cause) {
      error = errorText(cause, 'Could not add this person.');
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="user-add-title" oncancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
  <div class="add">
    <h2 id="user-add-title">Add user</h2>
    <p class="muted">Search for a colleague by name or email. Adding someone gives them no access to any client: you choose that on their page afterwards.</p>
    {#if chosen}
      <div class="add__chosen" data-testid="user-chosen">
        <strong>{chosen.name || chosen.email}</strong>
        <span class="muted">{chosen.email}{chosen.jobTitle ? `, ${chosen.jobTitle}` : ''}</span>
        {#if chosen.source === 'Typed'}<span class="muted small">Typed in by hand: this email is not checked against the directory.</span>{/if}
        <button class="btn" type="button" onclick={() => { chosen = null; error = ''; }} disabled={busy}>Choose someone else</button>
      </div>
    {:else}
      <UserPicker
        onChoose={(person) => { chosen = { email: person.email, name: person.name, loginName: person.loginName, jobTitle: person.jobTitle, source: 'Directory' }; error = ''; }}
        onTyped={(email) => { chosen = { email, name: '', loginName: '', jobTitle: '', source: 'Typed' }; error = ''; }}
        disabled={busy}
      />
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="dialog__actions">
      <button class="btn" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="btn btn--primary" type="button" onclick={() => void add()} disabled={busy || !chosen}>{busy ? 'Adding...' : 'Add user'}</button>
    </div>
  </div>
</dialog>

<style>
  .add {
    display: grid;
    gap: 0.9rem;
    padding: 1.5rem;
  }

  .add h2 {
    margin: 0;
    font-size: 1.35rem;
  }

  .add__chosen {
    display: grid;
    gap: 0.25rem;
    justify-items: start;
    padding: 0.75rem 1rem;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
    background: var(--card);
  }
</style>
