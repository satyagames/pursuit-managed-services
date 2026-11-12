<script lang="ts">
  // A client's page (Prompt 21, Phase 3; wireframe boards 5 and 6), opened from Clients: its sessions, planned ahead and several a day
  // (ClientSessions.svelte: the list and New session), and its team (ClientTeam.svelte: who may run, design or look at its sessions). It reads, once
  // and again after each change, the settings item and the client's sessions (one request on SharePoint), and the people and their roles (read
  // whole, as People does). What may be done here is the role matrix's (can(), lib/access): an Admin plans and picks the team, a Producer starts a
  // session on Today. The data layer asks the same before every write. Prompt 22: About this client (ClientAbout.svelte), its Industry and Region,
  // shown as labels under its name.
  import { onMount, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import PageHead from './ui/PageHead.svelte';
  import Breadcrumb from './ui/Breadcrumb.svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { DEFAULT_FISCAL_START, ONE_LIVE_LIMIT } from '../lib/admin/session-plan.js';
  import ClientAbout from './ClientAbout.svelte';
  import ClientSessions from './ClientSessions.svelte';
  import ClientTagChips from './ClientTagChips.svelte';
  import ClientTeam from './ClientTeam.svelte';
  import { embeddedAssetUrl } from '../lib/brand/assets.js';
  import { withoutRetiredLogo } from '../lib/brand/retired-logos.js';

  type Client = { id: string; name: string; slug?: string; status?: string; logoUrl?: string | null; industry?: string | null; region?: string | null };

  let { client, clients = [], access = null, onBack, onEdit, editor, onToast }: {
    client: Client;
    /** Every client Clients read: the suggestions for Industry and Region. */
    clients?: Client[];
    /** The signed-in person's access (lib/access); null where nobody is signed in (the local server's PIN gives a legacy admin's). */
    access?: any;
    onBack: () => void;
    /** (Prompt 33) Opens Clients' own editor of this client's details; `editor` is that form, drawn in Client details when it is open. */
    onEdit?: () => void;
    editor?: Snippet;
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
  /** (Prompt 33) Whether Add session or Add team member is open: the breadcrumb names it, and the client's name in it closes both. */
  let planning = $state(false);
  let teaming = $state(false);
  const crumbs = $derived([
    { label: 'Clients', onclick: onBack },
    { label: client.name, onclick: planning || teaming ? () => { planning = false; teaming = false; } : undefined },
    ...(planning ? [{ label: 'New session' }] : teaming ? [{ label: 'New team member' }] : []),
  ]);
  /** Its Industry and Region as saved here (Clients reads them again on the way back). */
  let tags = $state<{ industry: string; region: string } | null>(null);
  const shown = $derived({ ...client, ...(tags ?? {}) });

  /** (Prompt 40) The context strip's logo and status: which client this page is, held in view as it scrolls. */
  const logoAt = $derived(withoutRetiredLogo(client.logoUrl ?? null));
  const logo = $derived(logoAt ? embeddedAssetUrl(logoAt) ?? '' : '');
  const archived = $derived(client.status === 'archived');

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
  <!-- (Prompt 40: the client this page is, and the way back, held at the top of the column while the page scrolls.) -->
  <div class="adm-context" data-testid="client-context">
    {#if logo}<img class="adm-context__logo" src={logo} alt="" onerror={(event) => { (event.currentTarget as HTMLImageElement).hidden = true; }} />{/if}
    <span class="adm-context__name">{client.name}</span>
    <span class="pill" class:pill--archived={archived}>{archived ? 'Archived' : 'Active'}</span>
    <button class="btn btn--back" type="button" onclick={onBack}><Icon name="arrow-left" /> Back to clients</button>
  </div>
  <Breadcrumb parts={crumbs} />
  <PageHead id="workspace-heading" icon="building" title={client.name} focusable bind:heading
    description="Plan this client's sessions and choose who runs them; a Producer starts a session on Today.">
    {#snippet extra()}<ClientTagChips client={shown} />{/snippet}
  </PageHead>
  {#if loading}<p class="muted" role="status">Loading sessions and team...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}
    <div class="workspace__parts">
      <section class="part" aria-labelledby="details-heading">
        <div class="part__head">
          <h3 id="details-heading">Client details</h3>
          {#if onEdit}<button class="btn btn--with-icon" type="button" onclick={onEdit}><Icon name="pencil" /> Edit client details</button>{/if}
        </div>
        <p class="part__intro">Client details: its name, the words on its pages, its industry and region.</p>
        {@render editor?.()}
        <ClientAbout client={shown} {clients} {access} onSaved={(saved) => { tags = saved; }} {onToast} />
      </section>
      <p class="muted" data-testid="one-live-limit">{ONE_LIVE_LIMIT}</p>
      <ClientSessions {client} {access} {sessions} {settings} {users} {assignments} {fiscalStartMonth} bind:open={planning} onPlanned={(words, id, ownTeam) => void planned(words, id, ownTeam)} {onToast} />
      <ClientTeam {client} {access} {sessions} {users} {assignments} preset={teamFor} bind:open={teaming} onChanged={(words) => void changed(words)} {onToast} />
    </div>
  {/if}
</section>

<style>
  .workspace {
    display: grid;
    gap: 1rem;
  }

  .workspace__parts {
    display: grid;
    gap: 1.5rem;
  }

  .workspace__parts > :global(*) {
    margin: 0;
  }

  .part {
    display: grid;
    gap: 1rem;
  }

  .part__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .part__head h3 {
    margin: 0;
  }

  .btn--back,
  .btn--with-icon {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
