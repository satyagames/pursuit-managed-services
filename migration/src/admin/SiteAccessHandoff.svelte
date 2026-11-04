<script lang="ts">
  // A person's site access (Prompt 27), for a Super admin only: "Site access: Not checked" until it is checked, then which PMS groups they are in. With
  // Setup's switch on, checking also fixes (lib/access/site-access.js syncSiteAccess: only the difference), and it runs by itself after each change the
  // screen around it makes (`changed`). With the switch off, or when SharePoint does not let this account change a group, it hands on: a button copies the
  // person's email and opens the group's SharePoint page (the address is the one PCOE answered, 3 Nov 2026). Nothing is read until it is needed, so a
  // person's page costs no more requests. An Admin sees none of this: the person waits in the People page's drift report.
  import * as dataService from '../lib/data/dataService.js';
  import { can } from '../lib/access/can.js';
  import { MANAGED_GROUPS, desiredGroups, groupIds, syncSiteAccess } from '../lib/access/site-access.js';

  /** `settled` (Prompt 28): the last check found the person in the groups their roles ask for, so an email need not say they are waiting. */
  let { access, person, assignments, changed = 0, settled = $bindable(false) }: { access: any; person: { id: string; email?: string; status?: string }; assignments: any[]; changed?: number; settled?: boolean } = $props();

  type Key = keyof typeof MANAGED_GROUPS;
  const may = $derived(can(access, 'roles.global', {}));
  const wanted = $derived(desiredGroups(person, assignments) as Key[]);
  let phase = $state<'idle' | 'busy' | 'done' | 'same' | 'manual' | 'failed'>('idle');
  let words = $state('');
  let said = $state('');
  let seen = 0;
  /** This copy's titles of the groups, once its row is read (a copy with a list prefix has its own). */
  let titles = $state<Record<string, string>>({ ...MANAGED_GROUPS });

  async function check() {
    if (phase === 'busy') return;
    phase = 'busy';
    said = '';
    const result = await syncSiteAccess(dataService, access, person.id) as { status: typeof phase; words: string };
    phase = result.status;
    settled = ['done', 'same'].includes(result.status);
    words = result.words;
    const groups = await groupIds(dataService).catch(() => null);
    if (groups) titles = Object.fromEntries(Object.entries(MANAGED_GROUPS).map(([key, title]) => [key, groups[key]?.title ?? title]));
  }

  // (After a change the screen made: a role given or removed, a person turned off or on.)
  $effect(() => {
    if (may && changed > seen) { seen = changed; void check(); }
  });

  async function open(key: Key) {
    // (Opened before the reads: a browser allows a new tab only on the click itself.)
    const tab = window.open('', '_blank');
    said = '';
    try {
      const groups = await groupIds(dataService);
      if (!groups) throw new Error('Setup has not made the site groups yet.');
      const answer = await (dataService.probeSharePointRead as any)(null, '/web?$select=Url');
      if (!answer.ok) throw new Error(answer.message);
      const email = person.email || person.id;
      try { await navigator.clipboard.writeText(email); said = `${email} is copied. Paste it into ${titles[key]}'s New menu.`; } catch { said = `Add ${email} to ${titles[key]}.`; }
      if (tab) tab.location.href = `${answer.data.Url}/_layouts/15/people.aspx?MembershipGroupId=${groups[key].id}`;
    } catch (cause) {
      tab?.close();
      said = cause instanceof Error ? cause.message : 'Could not open the site groups.';
    }
  }
</script>

{#if may}
  <div class="handoff" data-testid="site-handoff">
    <p class="small" role="status">
      {#if phase === 'idle'}Site access: Not checked. This person belongs in {wanted.length ? wanted.map((key) => titles[key]).join(' and ') : 'no PMS group'}.
      {:else if phase === 'busy'}Checking site access...
      {:else}{words}{/if}
    </p>
    <button class="btn" type="button" onclick={() => void check()} disabled={phase === 'busy'}>{phase === 'manual' || phase === 'failed' ? 'Try again' : 'Check and fix'}</button>
    {#if phase === 'manual' || phase === 'failed'}
      {#each wanted as key (key)}
        <button class="btn" type="button" onclick={() => void open(key)}>Open site groups: {titles[key]}</button>
      {/each}
    {/if}
    {#if said}<p class="muted small" role="status">{said}</p>{/if}
  </div>
{/if}

<style>
  .handoff { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
  .handoff p { flex-basis: 100%; margin: 0; }
</style>
