<script lang="ts" module>
  import { HIDE_NAMES_BY_DEFAULT } from '../lib/results/metric-words.js';
  /** The Hide names switch (Prompt 21, Phase 6; decision B): one for every view of Results and their exports, kept while this page is open. */
  let keptHidden = HIDE_NAMES_BY_DEFAULT;
</script>

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
  /** A role without results.names never sees a guest's name (decision B), whatever the switch says; before there were roles, the PIN's admin does. */
  const mayName = $derived(!access || canView(access, 'results.names', {}));
  let switchedHidden = $state(keptHidden);
  const hideNames = $derived(switchedHidden || !mayName);
  function setHideNames(on: boolean) {
    switchedHidden = on;
    keptHidden = on;
  }
</script>

<!-- (Prompt 39: the switch sits in each view's title row, beside its controls, not above it.) -->
{#snippet viewSwitch()}
  <div class="results-views" role="group" aria-label="Results view">
    <button class="btn btn--small results-views__choice" type="button" aria-pressed={view === 'dashboard'} onclick={() => { chosen = 'dashboard'; }}>Dashboard</button>
    <button class="btn btn--small results-views__choice" type="button" aria-pressed={view === 'sessions'} onclick={() => { chosen = 'sessions'; }}>Sessions</button>
  </div>
{/snippet}
{#if view === 'dashboard'}
  <LeaderDashboard {access} {onToast} {hideNames} onHideNames={setHideNames} {viewSwitch} />
{:else}
  <AdminResults {access} {onToast} {onLiveDisplay} {hideNames} {mayName} onHideNames={setHideNames} {viewSwitch} />
{/if}

<style>
  .results-views {
    display: flex;
    flex: none;
    gap: var(--adm-s1);
  }

  /* (Prompt 38: the chosen view in the primary wash, not a black fill; it is also aria-pressed.) */
  .results-views__choice[aria-pressed='true'] {
    border-color: var(--adm-green);
    background: var(--adm-green-wash);
    color: var(--adm-text);
    box-shadow: inset 0 0 0 1px var(--adm-green);
  }
</style>
