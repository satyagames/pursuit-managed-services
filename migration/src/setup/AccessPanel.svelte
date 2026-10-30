<script lang="ts">
  // People and access on Setup (Prompt 21, Phase 1): who the Super admins are now (so that a surprise shows up), the site owner's "Make me a Super
  // admin" (decision I), and the one-time copy of the old admins list (PMSAdminUsers: a name and a PIN each) into PMSUsers and PMSRoleAssignments,
  // the switch-over after which a copied admin signs in without a PIN. The rules are lib/access's; this shows them and says what happened. The old
  // list's PIN hashes are never read into this screen: only names and ids.
  import * as dataService from '../lib/data/dataService.js';
  import { forgetAccess, resolveAccess } from '../lib/access/resolve.js';
  import { superAdmins } from '../lib/access/grants.js';
  import { grantsOf } from '../lib/access/can.js';
  import { makeMeSuperAdmin, migrateAdmins, MIGRATED_ROLES } from '../lib/access/migrate-admins.js';

  let { active }: { active: boolean } = $props();

  let access = $state<any>(null);
  let supers = $state<{ id: string; fullName?: string }[] | null>(null);
  let admins = $state<{ id: string; name: string }[]>([]);
  let emails = $state<Record<string, string>>({});
  let status = $state('');
  let failed = $state(false);
  let busy = $state(false);
  const mine = $derived(access ? grantsOf({ ...access, owner: false }).some((grant) => grant.role === 'Super admin') : false);

  const words = (cause: unknown) => (cause instanceof Error && cause.message ? cause.message : 'Please try again.');

  async function load() {
    failed = false;
    try {
      forgetAccess();
      access = await resolveAccess(dataService);
      const [users, roles, old] = await Promise.all([
        dataService.listAccessRecords('users') as Promise<any[]>, dataService.listAccessRecords('roleassignments') as Promise<any[]>,
        dataService.listAdminUsers() as Promise<{ id: string; name: string }[]>,
      ]);
      supers = superAdmins(users, roles);
      admins = old.map(({ id, name }) => ({ id, name }));
    } catch (cause) {
      supers = null;
      failed = true;
      status = (cause as { code?: string })?.code === 'PMS-LST-010' || (cause as { status?: number })?.status === 404
        ? 'The access lists do not exist yet: make the lists first (Show the plan, then Create).'
        : `Could not read who has access: ${words(cause)}`;
    }
  }
  $effect(() => { if (active) void load(); });

  async function makeMe() {
    if (busy) return;
    busy = true;
    failed = false;
    status = 'Adding...';
    try {
      const result = await makeMeSuperAdmin(dataService, access);
      status = result.already ? 'You were a Super admin already.' : 'You are now a Super admin with a row of your own: the admin page\'s banner goes.';
      await load();
    } catch (cause) {
      failed = true;
      status = `Not added: ${words(cause)}`;
    } finally {
      busy = false;
    }
  }

  async function copyAdmins(event: Event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    failed = false;
    status = 'Copying...';
    try {
      const counts = await migrateAdmins(dataService, access, $state.snapshot(emails), { admins });
      status = `Copied: ${counts.people} people added (${counts.peopleAlready} there already), ${counts.roles} roles given (${counts.rolesAlready} there already).`
        + (counts.skipped.length ? ` Left out, with no email, and still on their PIN: ${counts.skipped.join(', ')}.` : '');
      await load();
    } catch (cause) {
      failed = true;
      status = `Not copied: ${words(cause)}`;
    } finally {
      busy = false;
    }
  }
</script>

<h3 id="access-heading">People and access</h3>
<p class="muted">
  People sign in with their own account; their roles are rows of the access lists. The site owner is always treated as a Super admin. The admins below
  still unlock with a PIN until they are copied: each one given an email becomes {MIGRATED_ROLES.join(', ')} on all clients and signs in without a PIN.
  Safe to run again: nothing is copied twice.
</p>
{#if supers}
  <p data-testid="super-admins">{supers.length ? `Super admins now: ${supers.map((user) => user.fullName || user.id).join('; ')}.` : 'There is no Super admin with a row yet.'}</p>
{/if}
{#if access?.person}
  <p>Signed in as {access.person.email || access.person.name}{access.owner ? ', an owner of this site: treated as a Super admin' : ''}.</p>
  {#if access.owner && supers && !mine}
    <button class="btn btn--primary" type="button" onclick={() => void makeMe()} disabled={busy}>Make me a Super admin</button>
  {/if}
{/if}
{#if supers && admins.length}
  <form class="setup-form" onsubmit={(event) => void copyAdmins(event)} aria-labelledby="access-copy-heading">
    <h4 id="access-copy-heading">Copy the PIN admins into the new lists</h4>
    {#each admins as admin (admin.id)}
      <label for={`access-email-${admin.id}`}>{admin.name}'s email</label>
      <input id={`access-email-${admin.id}`} type="email" autocomplete="off" maxlength="255" bind:value={emails[admin.id]} disabled={busy} />
    {/each}
    <button class="btn btn--primary" type="submit" disabled={busy}>Copy into the new lists</button>
  </form>
{/if}
{#if status}<p class="setup-status setup-status--{failed ? 'error' : busy ? 'info' : 'success'}" role={failed ? 'alert' : 'status'} data-testid="access-status">{status}</p>{/if}
