<script lang="ts">
  // The hand-off after a role is given (Prompt 27, Part 3): for a Super admin, a button that copies the person's email and opens the SharePoint page of a
  // group they should be in, so they finish there in two clicks. The app changes no group's members. It reads nothing until it is pressed, so a person's
  // page costs no more requests. An Admin sees none of this: the person waits in the People page's drift report. The address is ASSUMED (QA-TESTING.md).
  import * as dataService from '../lib/data/dataService.js';
  import { can } from '../lib/access/can.js';
  import { MANAGED_GROUPS, desiredGroups, groupsOfRow, siteGroupsAddress } from '../lib/access/site-access.js';

  let { access, person, assignments }: { access: any; person: { id: string; email?: string; status?: string }; assignments: any[] } = $props();

  const may = $derived(can(access, 'roles.global', {}));
  const wanted = $derived(desiredGroups(person, assignments) as (keyof typeof MANAGED_GROUPS)[]);
  let said = $state('');

  const read = async (resource: string) => {
    const answer = await (dataService.probeSharePointRead as any)(null, resource);
    if (answer.ok) return answer.data;
    throw new Error(answer.message);
  };

  async function open(key: keyof typeof MANAGED_GROUPS) {
    // (Opened before the reads: a browser allows a new tab only on the click itself.)
    const tab = window.open('', '_blank');
    said = '';
    try {
      const data = await read(siteGroupsAddress(dataService.sharePointListTitles()));
      const groups = groupsOfRow((data?.results ?? data?.value ?? [])[0]);
      if (!groups) throw new Error('Setup has not made the site groups yet.');
      const site = (await read('/web?$select=Url'))?.Url;
      const email = person.email || person.id;
      try { await navigator.clipboard.writeText(email); said = `${email} is copied. Paste it into ${MANAGED_GROUPS[key]}'s New menu.`; } catch { said = `Add ${email} to ${MANAGED_GROUPS[key]}.`; }
      if (tab) tab.location.href = `${site}/_layouts/15/people.aspx?MembershipGroupId=${groups[key].id}`;
    } catch (cause) {
      tab?.close();
      said = cause instanceof Error ? cause.message : 'Could not open the site groups.';
    }
  }
</script>

{#if may && wanted.length}
  <div class="handoff" data-testid="site-handoff">
    <p class="muted small">Site access: this person belongs in {wanted.map((key) => MANAGED_GROUPS[key]).join(' and ')}.</p>
    {#each wanted as key (key)}
      <button class="btn" type="button" onclick={() => void open(key)}>Open site groups: {MANAGED_GROUPS[key]}</button>
    {/each}
    {#if said}<p class="muted small" role="status">{said}</p>{/if}
  </div>
{/if}

<style>
  .handoff { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
  .handoff p { flex-basis: 100%; margin: 0; }
</style>
