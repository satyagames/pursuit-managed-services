<script lang="ts">
  // The PMS groups and the lists' permissions (Prompt 27, Part 1): prints the matrix, reads what is set as a checklist, and has the two buttons a site owner
  // presses: Apply, which only adds, and later Remove the site's groups. The rules are lib/setup/list-permissions.js. The self-test never presses either.
  import { matrixTable } from '../lib/setup/list-permissions.js';
  import { groupsOfRow } from '../lib/access/site-access.js';
  import { applySitePermissions, listTitles, readSitePermissions, removeSiteGroupsNow, setSiteGroupsSyncNow, siteGroupsRemoval, type PermissionPlan } from '../lib/setup/setupData.js';

  let { blocked, folder }: { blocked: boolean; folder: string } = $props();

  const titles = listTitles();
  const matrix = matrixTable(titles);
  let plan = $state<PermissionPlan | null>(null);
  let status = $state('');
  let failed = $state(false);
  let busy = $state(false);
  let undo = $state<string[]>([]);
  const removal = $derived(plan ? siteGroupsRemoval(plan) : []);
  const toDo = $derived(plan ? plan.steps.filter((step) => step.state === 'To do') : []);
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Unknown error.');
  /** The switch (Prompt 27, Part 4): read from the groups' row; there is none to turn on until Apply has kept the ids. */
  const saved = $derived(plan ? groupsOfRow(plan.state.row) : null);

  async function reread(after = 'Nothing on the site was changed.') {
    plan = await readSitePermissions(folder);
    status = after;
  }
  async function showIt() {
    busy = true;
    failed = false;
    status = 'Reading the permissions...';
    try { await reread(); } catch (cause) { failed = true; status = `Could not read the permissions: ${message(cause)}`; } finally { busy = false; }
  }
  async function apply() {
    if (!plan || busy) return;
    const lists = toDo.filter((step) => step.id.startsWith('list:')).map((step) => step.words.split(':')[0]);
    if (!window.confirm(`Apply makes the PMS groups and gives these their own permissions, keeping what people have: ${lists.join(', ') || 'no list'}. It runs a rehearsal on a scratch list first and removes nothing. Continue?`)) return;
    busy = true;
    undo = [];
    try {
      const result = await applySitePermissions(plan, folder, (line) => { status = line; });
      failed = !result.ok;
      undo = result.undo;
      await reread(result.words);
    } catch (cause) { failed = true; status = message(cause); } finally { busy = false; }
  }
  async function remove() {
    if (!plan || busy) return;
    const who = [...new Set(removal.flatMap((each) => each.who))];
    if (!window.confirm(`Remove ${who.join(', ')} from ${removal.length} ${removal.length === 1 ? 'list' : 'lists'}? Anyone who reaches the app only through them stops being able to open it, until they are in a PMS group. The site's other content is not changed.`)) return;
    busy = true;
    try {
      const result = await removeSiteGroupsNow(plan, (line) => { status = line; });
      failed = !result.ok;
      await reread(result.words);
    } catch (cause) { failed = true; status = message(cause); } finally { busy = false; }
  }
  async function switchSync(event: Event) {
    const box = event.currentTarget as HTMLInputElement;
    const on = box.checked;
    if (on && !window.confirm('Let Super admins add people to and take them out of PMS access managers, PMS staff and PMS leadership from the admin page? Only those three groups; an Admin never does, and the site\'s owners keep PMS super admins and PMS participants.')) { box.checked = false; return; }
    busy = true;
    try {
      const result = await setSiteGroupsSyncNow(on);
      failed = !result.ok;
      await reread(result.words);
    } catch (cause) { failed = true; status = message(cause); } finally { busy = false; }
  }
</script>

<section aria-labelledby="permissions-heading">
  <h3 id="permissions-heading">Site groups and permissions</h3>
  <p class="muted">
    The app's own groups, with rights on its lists and the folder its pages are in. The site's other content and the site's own groups are not changed. A
    site owner does this once. Apply only adds: people keep what they have until Remove the site's groups is pressed. Not yet tried on a real site.
  </p>
  <div class="permissions-table">
    <table data-testid="permissions-matrix">
      <thead><tr>{#each matrix.head as cell (cell)}<th scope="col">{cell}</th>{/each}</tr></thead>
      <tbody>{#each matrix.rows as row (row[0])}<tr>{#each row as cell, index (index)}<td>{cell}</td>{/each}</tr>{/each}</tbody>
    </table>
  </div>
  <p class="muted small">The site's owners keep Full Control of each. People in PMS participants and PMS super admins are chosen by the site's owners, by hand; the app never changes who is in those two.</p>
  <button class="btn" type="button" onclick={() => void showIt()} disabled={busy || blocked}>Read what is set</button>
  <button class="btn btn--primary" type="button" onclick={() => void apply()} disabled={busy || blocked || toDo.length === 0}>Apply</button>
  <button class="btn" type="button" onclick={() => void remove()} disabled={busy || blocked || removal.length === 0}>Remove the site's groups</button>
  {#if status}<p class="setup-status setup-status--{failed ? 'error' : 'info'}" role="status" aria-live="polite" data-testid="permissions-status">{status}</p>{/if}
  {#if saved}
    <label class="setup-check">
      <input type="checkbox" checked={saved.sync} onchange={(event) => void switchSync(event)} disabled={busy || blocked} />
      Super admins change who is in PMS access managers, PMS staff and PMS leadership from the admin page (off: they finish on SharePoint's own page)
    </label>
  {/if}
  {#if plan}
    <ul class="permissions-plan" data-testid="permissions-plan">
      {#each plan.steps as step (step.id)}<li><strong>{step.state}</strong>: {step.words}</li>{/each}
    </ul>
  {/if}
  {#if undo.length}
    <details open={failed}>
      <summary>How to take back each list</summary>
      <ul class="permissions-plan">{#each undo as line (line)}<li><code>{line}</code></li>{/each}</ul>
    </details>
  {/if}
</section>

<style>
  .permissions-table { overflow-x: auto; }
  .permissions-plan { margin: 8px 0; padding-left: 20px; overflow-wrap: anywhere; }
  summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; }
</style>
