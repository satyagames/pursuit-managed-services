<script lang="ts">
  import { canView } from '../lib/access/can.js';
  import AdminResults from './AdminResults.svelte';
  import LeaderDashboard from './LeaderDashboard.svelte';

  // The Results tab (Prompt 21, Phase 5): two views, the Leadership dashboard (summaries, board 9) and Sessions (each session's live results, its iPads and
  // its exports, as Results always was). A role that runs no session (Leadership) opens on the dashboard; everyone else on Sessions, as before. Only the
  // view shown is mounted, so the dashboard never reads every session's answers.
  let { access = null, onToast, onLiveDisplay }: {
    access?: any;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    onLiveDisplay: (sessionId: string) => void;
  } = $props();

  const runsSessions = $derived(!access || canView(access, 'events.run', {}) || canView(access, 'results.live', {}));
  let chosen = $state<'dashboard' | 'sessions' | null>(null);
  const view = $derived(chosen ?? (runsSessions ? 'sessions' : 'dashboard'));
</script>

<div class="results-views" role="group" aria-label="Results view">
  <button class="btn btn--small results-views__choice" type="button" aria-pressed={view === 'dashboard'} onclick={() => { chosen = 'dashboard'; }}>Dashboard</button>
  <button class="btn btn--small results-views__choice" type="button" aria-pressed={view === 'sessions'} onclick={() => { chosen = 'sessions'; }}>Sessions</button>
</div>
{#if view === 'dashboard'}
  <LeaderDashboard {access} {onToast} />
{:else}
  <AdminResults {access} {onToast} {onLiveDisplay} />
{/if}

<style>
  .results-views {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }

  .results-views__choice[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: #fff;
  }
</style>
