<script lang="ts">
  // The drift report on the People page (Prompt 27, Part 2), for a Super admin: who the roles say should be in the PMS groups against who is. Read only, and
  // read only when asked: lib/access/site-access.js. "Waiting for site access" is the queue an Admin's grant lands in.
  import * as dataService from '../lib/data/dataService.js';
  import { MANAGED_GROUPS, readDrift } from '../lib/access/site-access.js';

  /** `onRead` (Prompt 28): who the check found waiting, by key, so that an email to one of them can say so. Nothing more is read for it. */
  // Prompt 39: the page's title row draws Check site access (`button` false) and calls check(); `busy` is bound so it can say Checking...
  let { users, assignments, onRead, button = true, busy = $bindable(false) }: { users: any[]; assignments: any[]; onRead?: (waiting: string[]) => void; button?: boolean; busy?: boolean } = $props();

  type Drift = { waiting: any[]; more: any[]; strangers: any[] };
  let drift = $state<Drift | null>(null);
  let said = $state('');
  /** This copy's titles of the groups (its row says: a copy with a list prefix has its own). */
  let titles = $state<Record<string, string>>({ ...MANAGED_GROUPS });
  const names = (keys: (keyof typeof MANAGED_GROUPS)[]) => keys.map((key) => titles[key]).join(', ');

  const read = async (resource: string) => {
    const answer = await (dataService.probeSharePointRead as any)(null, resource);
    if (answer.ok) return answer.data;
    throw Object.assign(new Error(answer.message), { status: answer.status });
  };

  export async function check() {
    busy = true;
    said = '';
    drift = null;
    try {
      const found = await readDrift(read, dataService.sharePointListTitles(), { users, assignments }) as { ready: boolean; words?: string; drift?: Drift; groups?: Record<string, { title?: string }> };
      if (found.ready) {
        drift = found.drift ?? null;
        onRead?.((drift?.waiting ?? []).map((each) => each.key));
        titles = Object.fromEntries(Object.entries(MANAGED_GROUPS).map(([key, title]) => [key, found.groups?.[key]?.title ?? title]));
      }
      else said = found.words ?? '';
    } catch (cause) {
      said = cause instanceof Error ? cause.message : 'Could not check site access.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="drift" data-testid="site-drift">
  {#if button}<button class="btn" type="button" onclick={() => void check()} disabled={busy}>{busy ? 'Checking...' : 'Check site access'}</button>{/if}
  {#if said}<p class="muted small" role="status">{said}</p>{/if}
  {#if drift}
    <h3>Waiting for site access</h3>
    {#if drift.waiting.length}<ul>{#each drift.waiting as each (each.key)}<li>{each.name}: add to {names(each.missing)}</li>{/each}</ul>{:else}<p class="muted small">No one.</p>{/if}
    <h3>Has more access than the role says</h3>
    {#if drift.more.length}<ul>{#each drift.more as each (each.key)}<li>{each.name}: in {names(each.extra)}</li>{/each}</ul>{:else}<p class="muted small">No one.</p>{/if}
    <h3>In a group but not in People</h3>
    {#if drift.strangers.length}<ul>{#each drift.strangers as each (each.name)}<li>{each.name}: in {names(each.groups)}</li>{/each}</ul>{:else}<p class="muted small">No one.</p>{/if}
  {/if}
</div>

<style>
  .drift { margin-bottom: 0.75rem; }
  h3 { margin: 0.75rem 0 0.25rem; font-size: 1rem; }
  ul { margin: 0; padding-left: 1.25rem; }
</style>
