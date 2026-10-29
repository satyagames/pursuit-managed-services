<script lang="ts">
  // A client's page (Prompt 21, Phase 3; wireframe boards 5 and 6), opened from Clients: its sessions, planned ahead and several a day
  // (ClientSessions.svelte: the list and New session), and its team (ClientTeam.svelte: who may run, design or look at its sessions). It reads, once
  // and again after each change, the settings item and the client's sessions (one request on SharePoint), and the people and their roles (read
  // whole, as People does). What may be done here is the role matrix's (can(), lib/access): an Admin plans and picks the team, a Producer starts a
  // session on Today. The data layer asks the same before every write.
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { DEFAULT_FISCAL_START, ONE_LIVE_LIMIT } from '../lib/admin/session-plan.js';
  import ClientSessions from './ClientSessions.svelte';
  import ClientTeam from './ClientTeam.svelte';

  type Client = { id: string; name: string; slug?: string; status?: string };

  let { client, access = null, onBack, onToast }: {
    client: Client;
    /** The signed-in person's access (lib/access); null where nobody is signed in (the local server's PIN gives a legacy admin's). */
    access?: any;
    onBack: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let settings = $state<any>(null);
  let sessions = $state<any[]>([]);
  let users = $state<any[]>([]);
  let assignments = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let heading = $state<HTMLElement>();
  /** A session just planned with its own team: the team panel opens on it. */
  let teamFor = $state<string | null>(null);

  const fiscalStartMonth = $derived(settings?.fiscalYearStartMonth ?? DEFAULT_FISCAL_START);

  async function load() {
    const [[settingRows, sessionRows], people, roles] = await Promise.all([
      dataService.readLists([{ list: 'appsettings' }, { list: 'sessions', where: { clientId: client.id } }]),
      dataService.listAccessRecords('users'),
      dataService.listAccessRecords('roleassignments'),
    ]);
    settings = (settingRows as any[]).find((row) => row.id === 'default') ?? null;
    sessions = sessionRows as any[];
    users = [...(people as any[])].sort((a, b) => String(a.fullName || a.email || a.id).localeCompare(String(b.fullName || b.email || b.id)));
    assignments = roles as any[];
    error = '';
  }

  onMount(() => {
    void load().catch((cause) => { error = errorText(cause, 'Could not load this client\'s sessions and team.'); })
      .finally(() => { loading = false; focusHeading(heading); });
  });

  /** After a change: read again, then say what was done. */
  async function changed(words: string) {
    try {
      await load();
      onToast(words, 'success');
    } catch (cause) {
      error = errorText(cause, 'Could not read this client again.');
    }
  }

  async function planned(words: string, sessionId: string, ownTeam: boolean) {
    await changed(words);
    if (ownTeam) teamFor = sessionId; // (the team panel opens its form on it, and takes the focus)
  }
</script>

<section class="panel workspace" aria-labelledby="workspace-heading" aria-busy={loading}>
  <header class="panel__head">
    <div>
      <h2 id="workspace-heading" bind:this={heading} tabindex="-1">{client.name}</h2>
      <p class="muted">Plan this client's sessions, several in one day if needed, and choose who runs them. A Producer starts a session on Today.</p>
    </div>
    <button class="btn" type="button" onclick={onBack}>Back to clients</button>
  </header>
  {#if loading}<p class="muted" role="status">Loading sessions and team...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}
    <p class="muted small" data-testid="one-live-limit">{ONE_LIVE_LIMIT}</p>
    <ClientSessions {client} {access} {sessions} {settings} {users} {assignments} {fiscalStartMonth} onPlanned={(words, id, ownTeam) => void planned(words, id, ownTeam)} {onToast} />
    <ClientTeam {client} {access} {sessions} {users} {assignments} preset={teamFor} onChanged={(words) => void changed(words)} {onToast} />
  {/if}
</section>

<style>
  .workspace {
    display: grid;
    gap: 1.25rem;
  }
</style>
