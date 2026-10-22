<script lang="ts">
  // The body of Today's Go live card, inside AdminToday.svelte's section and under its heading: the client and the date, the button, and what it
  // says about them (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its styles). The picking and the going live are
  // AdminToday's; this draws them and hands each press back.
  type Pickable = { id: string; name: string; status?: string };

  let { pickable, clientId, date = $bindable(), busy, canGo, label, why, verified, problem, onPickClient, onPickDate, onGo, onNavigate }: {
    pickable: Pickable[];
    clientId: string;
    date: string;
    busy: boolean;
    canGo: boolean;
    /** The button's words (lib/admin/today-view.js goLiveLabel). */
    label: string;
    why: string;
    verified: string;
    problem: string;
    onPickClient: (event: Event) => void;
    onPickDate: () => void;
    onGo: () => void;
    onNavigate: (tab: string) => void;
  } = $props();
</script>

{#if pickable.length === 0}
  <p class="muted">There are no active clients yet. <button class="link" type="button" onclick={() => onNavigate('clients')}>Add one on Clients</button>.</p>
{:else}
  <div class="picker">
    <div class="field"><label class="field__label" for="today-client">Client</label>
      <select id="today-client" class="select" value={clientId} onchange={onPickClient} disabled={busy}>
        {#each pickable as entry (entry.id)}<option value={entry.id}>{entry.name}{entry.status === 'archived' ? ' (archived)' : ''}</option>{/each}
      </select>
    </div>
    <div class="field"><label class="field__label" for="today-date">Date</label>
      <input id="today-date" class="input" type="date" bind:value={date} onchange={onPickDate} disabled={busy} />
    </div>
    <button class="btn btn--primary btn--go" type="button" onclick={onGo} disabled={!canGo}>
      {label}
    </button>
  </div>
  {#if why}<p class="why" role="status" data-testid="go-live-why">{why}</p>{/if}
  {#if verified}<p class="verified" role="status">{verified}</p>{/if}
  {#if problem}<p class="error" role="alert">{problem}</p>{/if}
{/if}

<style>
  .picker {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(10.5rem, 1fr) auto;
    gap: 0.9rem;
    align-items: end;
  }

  .picker .select,
  .picker .input {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .btn--go {
    min-width: 8rem;
    min-height: 3rem;
    font-weight: var(--fw-bold);
  }

  @media (max-width: 640px) {
    .picker {
      grid-template-columns: 1fr;
    }

    .btn--go {
      width: 100%;
    }
  }

  .why {
    margin: 0;
    color: var(--adm-muted);
  }

  .verified {
    margin: 0;
    padding: 0.6rem 0.9rem;
    border-radius: 0.6rem;
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
    font-weight: var(--fw-semibold);
  }

  .error {
    margin: 0;
    padding: 0.6rem 0.9rem;
    border-radius: 0.6rem;
    color: var(--adm-bad-ink);
    background: var(--adm-bad-bg);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--adm-primary);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
