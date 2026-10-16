<script lang="ts">
  import { onMount } from 'svelte';
  import { draftFromClient } from '../lib/brand-studio.js';
  import { deriveTheme } from '../lib/theme.js';

  type Client = { id: string; name: string; status?: string; theme?: unknown };
  let { clients, onChoose, onCancel }: {
    /** The other clients (never the one being edited). */
    clients: Client[];
    onChoose: (client: Client) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let chosen = $state('');
  const uid = $props.id();

  onMount(() => {
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  });

  const swatches = (client: Client) => {
    const draft = draftFromClient(client);
    const tokens = deriveTheme(draft.primary, draft.accent ?? undefined, { plate: draft.plate }).tokens;
    return [tokens['--bg-top'], tokens['--bg-mid'], tokens['--bg-bottom']];
  };
</script>

<dialog bind:this={dialog} class="copy" aria-labelledby="{uid}-title" onclose={onCancel}>
  <form class="copy__body" onsubmit={(event) => { event.preventDefault(); const client = clients.find((entry) => entry.id === chosen); if (client) onChoose(client); }}>
    <h2 id="{uid}-title">Copy brand from another client</h2>
    <p class="muted">Copies the colours and the logo plate. Pictures are not copied: each client keeps its own files. You can still change anything before you save.</p>
    {#if clients.length === 0}
      <p>There is no other client to copy from.</p>
    {:else}
      <fieldset class="copy__list">
        <legend class="sr-only">Client to copy from</legend>
        {#each clients as client (client.id)}
          <label class="copy__row">
            <input type="radio" name="{uid}-client" value={client.id} bind:group={chosen} />
            <span class="copy__swatches" aria-hidden="true">{#each swatches(client) as colour}<span style:background={colour}></span>{/each}</span>
            <span class="copy__name">{client.name}{client.status === 'archived' ? ' (archived)' : ''}</span>
          </label>
        {/each}
      </fieldset>
    {/if}
    <div class="copy__actions">
      <button class="btn" type="button" onclick={() => dialog?.close()}>Cancel</button>
      <button class="btn btn--primary" type="submit" disabled={!chosen}>Copy colours</button>
    </div>
  </form>
</dialog>

<style>
  .copy {
    width: min(30rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    overflow: auto;
    border: 0;
    border-radius: 1rem;
    color: var(--adm-ink);
    background: var(--adm-card);
    box-shadow: 0 1.5rem 4rem rgb(11 31 58 / 0.35);
  }

  .copy::backdrop {
    background: rgb(11 31 58 / 0.55);
  }

  .copy__body {
    display: grid;
    gap: 0.9rem;
    padding: 1.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.35rem;
  }

  .copy__body p {
    margin: 0;
  }

  .copy__list {
    display: grid;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .copy__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: var(--target-min);
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--adm-line);
    border-radius: 0.65rem;
    cursor: pointer;
  }

  .copy__row:has(input:checked) {
    border-color: var(--action);
    box-shadow: inset 0 0 0 1px var(--action);
  }

  .copy__swatches {
    display: inline-flex;
    flex: none;
    overflow: hidden;
    border: 1px solid var(--adm-line);
    border-radius: 0.4rem;
  }

  .copy__swatches span {
    width: 1.25rem;
    height: 1.75rem;
  }

  .copy__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
  }
</style>
