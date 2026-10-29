<script lang="ts">
  // Setup's plan for this copy's lists (Phase 10c-3, lib/setup/provision.js), as a person reads it: one block for each list that has something to
  // create or something wrong, what will be created in plain words, what Setup will not touch and how to fix it, and the internal names and
  // definitions under "Technical details". It shows a plan; it changes nothing. Only Setup loads this. Last, the access lists' permissions a site owner
  // sets by hand (Prompt 21, Phase 7: lib/setup/list-permissions.js; Setup does not change permissions, and its self-test reads what is set).
  type Item = { words: string; name?: string; label?: string; xml?: string; column?: string | null; changes?: Record<string, unknown>; kind?: string };
  type Kept = { column: string | null; found: string; fix: string; harmless: boolean };
  type Group = { key: string; title: string; state: 'new' | 'exists'; purpose: string; lists: Item[]; columns: Item[]; settings: Item[]; untouched: Kept[] };
  type Plan = { summary: string; toFix: number; groups: Group[] };
  let { plan, permissions = [] }: { plan: Plan; permissions?: string[] } = $props();

  const busy = (group: Group) => group.lists.length + group.columns.length + group.settings.length + group.untouched.length > 0;
  const shown = $derived(plan.groups.filter(busy));
  const settled = $derived(plan.groups.filter((group) => !busy(group)));
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
</script>

<div class="plan" data-testid="plan">
  <p class="plan-summary" data-testid="plan-summary"><strong>{plan.summary}.</strong>
    {#if plan.toFix}{' '}{plural(plan.toFix, 'thing')} Setup will not touch {plan.toFix === 1 ? 'needs' : 'need'} fixing by hand (below).{/if}
  </p>
  {#each shown as group (group.key)}
    <div class="plan-list" data-list={group.key}>
      <h4>{group.title} <span class="plan-state">({group.state === 'new' ? 'new' : 'exists'})</span></h4>
      <p class="muted">{group.purpose}</p>
      <ul>
        {#each group.lists as item (item.words)}<li>{item.words}</li>{/each}
        {#if group.columns.length}
          <li>Create {plural(group.columns.length, 'column')}: {group.columns.map((item) => item.name).join(', ')}.</li>
        {/if}
        {#each group.settings as item, index (`${item.kind}-${item.column ?? ''}-${index}`)}<li>{item.words}</li>{/each}
      </ul>
      {#if group.untouched.length}
        <p class="plan-kept-heading">Setup will not touch:</p>
        <ul class="plan-kept">
          {#each group.untouched as item, index (`${item.column ?? ''}-${index}`)}
            <li data-harmless={item.harmless}>{item.found} <em>{item.harmless ? '' : 'To fix: '}{item.fix}</em></li>
          {/each}
        </ul>
      {/if}
      {#if group.columns.length || group.settings.length}
        <details>
          <summary>Technical details</summary>
          <ul class="plan-tech">
            {#each group.columns as item (item.name)}<li><code>{item.name}</code>: {item.label}. <code>{item.xml}</code></li>{/each}
            {#each group.settings as item, index (`${item.kind}-${item.column ?? ''}-${index}`)}
              <li>{item.column ? `${item.column}: ` : 'The list: '}<code>{JSON.stringify(item.changes)}</code></li>
            {/each}
          </ul>
        </details>
      {/if}
    </div>
  {/each}
  {#if settled.length}
    <p class="muted" data-testid="plan-settled">Already as the app needs: {settled.map((group) => group.title).join(', ')}.</p>
  {/if}
  {#if permissions.length}
    <div class="plan-list" data-testid="plan-permissions">
      <h4>Who may change the access lists (by hand)</h4>
      <p class="muted">The admin page checks every change itself; these permissions are what holds when someone writes to the lists another way. Setup does not
        change permissions: a site owner does this once, and the self-test then reads what is set. Not yet tried on the PCOE site.</p>
      <ol>{#each permissions as step (step)}<li>{step}</li>{/each}</ol>
    </div>
  {/if}
</div>

<style>
  .plan { margin-top: 16px; }
  .plan-summary { font-size: 1.05rem; }
  .plan-list { padding: 8px 0 12px; border-top: 1px solid var(--line, currentColor); }
  h4 { margin: 8px 0 4px; font-size: 1rem; }
  .plan-state { font-weight: 400; }
  ul, ol { margin: 4px 0; padding-left: 20px; }
  li { margin: 2px 0; overflow-wrap: anywhere; }
  .plan-kept-heading { margin: 8px 0 0; font-weight: 600; }
  em { font-style: normal; }
  details { margin-top: 4px; }
  summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; }
  code { overflow-wrap: anywhere; font-size: 0.9em; }
</style>
