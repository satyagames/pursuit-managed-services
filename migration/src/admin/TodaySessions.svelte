<script lang="ts">
  // The body of Today's "All sessions" panel, inside AdminToday.svelte's details and under its summary: every other session, newest first, with
  // Reopen or Make live, eight at a time until Show all (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its styles). What
  // each button does is AdminToday's.
  type Session = { id: string; clientId: string; date?: string; status?: string };

  let { sessions, all, busy, nameOf, canMakeLive, onReopen, onMakeLive, onShowAll }: {
    /** The other sessions, in their order (lib/admin/today-view.js otherSessionsOf). */
    sessions: Session[];
    /** Every one is shown, not only the first eight. */
    all: boolean;
    busy: boolean;
    nameOf: (clientId: string) => string;
    /** Whether the session's client is known, so it can be made live. */
    canMakeLive: (session: Session) => boolean;
    onReopen: (session: Session) => void;
    onMakeLive: (session: Session) => void;
    onShowAll: () => void;
  } = $props();
</script>

<p class="muted small">Sessions made by Go live are found by client and date above. This list is for any other session, and to reopen one that has ended.</p>
<ul class="rows rows--flat">
  {#each (all ? sessions : sessions.slice(0, 8)) as session (session.id)}
    <li class="row">
      <div class="row__main"><span class="row__title">{nameOf(session.clientId)} · {session.date ?? 'Undated'}</span><span class="muted small mono">{session.id} · {session.status ?? 'not-started'}</span></div>
      {#if session.status === 'completed'}
        <button class="btn btn--small" type="button" onclick={() => onReopen(session)} disabled={busy}>Reopen</button>
      {:else}
        <button class="btn btn--small" type="button" onclick={() => onMakeLive(session)} disabled={busy || !canMakeLive(session)}>Make live</button>
      {/if}
    </li>
  {/each}
</ul>
{#if sessions.length > 8 && !all}<button class="btn btn--small" type="button" onclick={onShowAll}>Show all</button>{/if}

<style>
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }
</style>
