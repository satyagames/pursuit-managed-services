<script lang="ts" module>
  /** The view "Save this view" keeps: in this page's memory while it is open (the repository keeps nothing in the browser between page loads). */
  let savedView: Record<string, unknown> | null = null;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { can, canView } from '../lib/access/can.js';
  import { readDashboard, rebuildSummaries } from '../lib/admin/session-summaries.js';
  import { BASELINES } from '../lib/results/index-math.js';
  import { SPANS, dashboardFileName, dashboardOf, defaultFilters, emptyStateOf, filterOptions, rebuildQuestion, reportCsv, shiftWords } from '../lib/results/dashboard-model.js';
  import { METRICS } from '../lib/results/metric-words.js';
  import { readQueries, reachOf, sessionsFor } from '../lib/access/scope.js';
  import ClientTagChips from './ClientTagChips.svelte';
  import MetricInfo from './MetricInfo.svelte';
  import ReportExports from './ReportExports.svelte';
  import ReportingSettings from './ReportingSettings.svelte';

  // The Leadership dashboard (Prompt 21, Phase 5; wireframe board 9): Results as a leader's view, from the sessions' summaries (PMSSessionSummary), never
  // every answer. The person sees only their scope: the clients they hold, or every client for their period (lib/admin/session-summaries.js); a Producer sees
  // the same, limited to their clients. Every figure is lib/results/dashboard-model.js's, its words lib/results/metric-words.js's. "Save this view" keeps the
  // filters while the page is open, across its tabs (ASSUMED: nothing is kept between page loads, scripts/test-participant-storage.js; a view kept across
  // visits needs a place of its own, docs/history/RELEASE-21E.md).
  // Hide names is Results' one switch (ResultsTab), shared with Sessions and every export; it rides in the saved view.
  // Prompt 22: a Super admin opens Reporting settings from here (the fiscal-year start month and the minimum sample); the figures are read again after.
  let { access = null, onToast, hideNames = false, onHideNames = () => {} }: {
    access?: any;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    hideNames?: boolean;
    onHideNames?: (on: boolean) => void;
  } = $props();

  type Filters = ReturnType<typeof defaultFilters>;
  let summaries = $state<any[]>([]);
  let clients = $state<any[]>([]);
  let startMonth = $state(6);
  let minSample = $state<number | null>(null);
  let loading = $state(true);
  let error = $state('');
  let filters = $state<Filters>(defaultFilters());
  let open = $state<string[]>([]);
  let rebuilding = $state('');
  let missing = $state<string[]>([]);
  let heading = $state<HTMLElement>();
  let settingsOpen = $state(false);

  /** A role without results.names never sees a guest's name (decision B); before there were roles, the PIN's admin does. */
  const mayName = $derived(!access || canView(access, 'results.names', {}));
  /** Rebuild writes summaries: a person who may run sessions (a Producer, a Super admin, the PIN's admin). */
  const mayRebuild = $derived(!access || canView(access, 'events.run', {}));
  /** Reporting settings: a Super admin's alone (settings.manage). */
  const maySettings = $derived(Boolean(access) && can(access, 'settings.manage', {}));
  const clientById = $derived(new Map(clients.map((client) => [client.id, client])));
  const board = $derived(dashboardOf({ summaries, clients, filters: { ...filters, hideNames }, startMonth, minSample, mayName }));
  const options = $derived(filterOptions(summaries, clients));
  /** No client, session or period given (nothing is read), or no summary yet: said instead of the filters and figures (Prompt 21, Phase 6). */
  const reach = $derived(access ? reachOf(access) : null);
  const empty = $derived(emptyStateOf({ reach, summaries, waiting: mayRebuild ? missing.length : 0 }));
  const shownClients = $derived([...clients].filter((client) => summaries.some((each) => each.clientId === client.id)).sort((a, b) => String(a.name).localeCompare(String(b.name))));
  const years = $derived([...new Set([...options.years, filters.year])].sort());
  const scaleTop = $derived(Math.max(150, ...board.byClient.map((row) => Math.ceil((row.index ?? 0) / 10) * 10)));
  const tile = (id: string) => board.tiles.find((each) => each.id === id);
  const whole = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(Math.round(value)));
  const quarterWords = (period: string) => period.replace('-', ' ');

  function restore(): Filters | null {
    return savedView ? { ...defaultFilters({ startMonth }), ...savedView } as Filters : null;
  }

  async function load() {
    loading = true;
    error = '';
    if (emptyStateOf({ reach, summaries: [] })?.kind === 'no-scope') { loading = false; return; }
    try {
      const settings = await dataService.getAppSettings().catch(() => null) as { fiscalYearStartMonth?: number | null; minSample?: number | null } | null;
      const month = Number(settings?.fiscalYearStartMonth);
      startMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : 6; // (ASSUMED June until the manager confirms it)
      minSample = Number(settings?.minSample) > 0 ? Number(settings?.minSample) : null;
      const read = await readDashboard(access, { startMonth });
      summaries = read.summaries;
      clients = read.clients;
      if (mayRebuild) missing = await sessionsWithout(read.summaries);
    } catch (cause) {
      error = errorText(cause, 'Could not load the dashboard.');
    } finally {
      loading = false;
    }
  }

  /** The ended sessions the person may run that have no summary yet: what Rebuild would write. */
  async function sessionsWithout(have: any[]) {
    const reach = access ? reachOf(access) : null;
    const queries = reach ? readQueries(reach, 'sessions') : [{ list: 'sessions' }];
    const rows = queries.length ? (await dataService.readLists(queries)).flat() as any[] : [];
    const mine = (access ? sessionsFor(access, rows) : rows).filter((session: any) => session.status === 'completed' && (!access || can(access, 'events.run', { clientId: session.clientId, sessionId: session.id, date: session.date })));
    const known = new Set(have.map((each) => each.id));
    return mine.map((session: any) => session.id).filter((id: string) => !known.has(id));
  }

  async function rebuild() {
    if (rebuilding || !missing.length) return;
    if (!window.confirm(rebuildQuestion(missing.length))) return;
    rebuilding = 'Starting...';
    try {
      const result = await rebuildSummaries(missing, { writtenBy: access?.person?.name ?? '', startMonth, onProgress: (done, of) => { rebuilding = `Rebuilt ${done} of ${of}...`; } });
      onToast(result.failed.length ? `${result.written} summaries written; ${result.failed.length} could not be` : `${result.written} summaries written`, result.failed.length ? 'error' : 'success');
    } catch (cause) {
      onToast(errorText(cause, 'Could not rebuild the summaries.'), 'error');
    } finally {
      rebuilding = '';
    }
    await load();
  }

  function saveView() {
    savedView = JSON.parse(JSON.stringify({ ...filters, hideNames }));
    onToast('This view is kept while this page is open', 'success');
  }

  function reset() {
    filters = defaultFilters({ startMonth });
    onHideNames(filters.hideNames);
    savedView = null;
    void tick().then(() => focusHeading(heading));
  }

  function exportReport() {
    const blob = new Blob([`﻿${reportCsv(board)}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = dashboardFileName(board.window.words);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function setSpan(span: string) {
    filters = { ...filters, span, ...(span.startsWith('q') ? { period: `${filters.year}-Q${span.slice(1)}` } : {}) };
  }

  function toggleClient(id: string, on: boolean) {
    filters = { ...filters, clientIds: on ? [...filters.clientIds, id] : filters.clientIds.filter((each) => each !== id) };
  }

  function toggleRow(id: string) {
    open = open.includes(id) ? open.filter((each) => each !== id) : [...open, id];
  }

  function closeSettings() {
    settingsOpen = false;
    void tick().then(() => document.getElementById('dash-settings')?.focus());
  }

  onMount(() => {
    void load().then(() => { const saved = restore(); filters = saved ?? defaultFilters({ startMonth }); if (saved) onHideNames(Boolean(saved.hideNames)); });
    void tick().then(() => focusHeading(heading));
  });
</script>

{#if settingsOpen}
  <ReportingSettings {access} onBack={closeSettings} onSaved={() => void load()} {onToast} />
{:else}
<section class="panel dash" aria-busy={loading || Boolean(rebuilding)} aria-labelledby="dash-title">
  <header class="panel__head">
    <div>
      <h2 id="dash-title" bind:this={heading} tabindex="-1">Leadership dashboard</h2>
      <p class="muted">Each figure comes from the sessions' summaries, written when a session ends. Press i beside a figure to see how it is worked out.</p>
    </div>
    <div class="dash__actions">
      <button class="btn btn--small" type="button" onclick={saveView}>Save this view</button>
      <button class="btn btn--small" type="button" onclick={reset}>Reset</button>
      <button class="btn btn--small btn--primary" type="button" onclick={exportReport} disabled={board.empty}>Export report</button>
      {#if maySettings}<button class="btn btn--small" id="dash-settings" type="button" onclick={() => { settingsOpen = true; }}>Reporting settings</button>{/if}
    </div>
  </header>

  {#if loading}<p role="status">Loading the dashboard...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}
    {#if mayRebuild && missing.length}
      <p class="notice dash__rebuild" role="status">
        {missing.length} ended {missing.length === 1 ? 'session has' : 'sessions have'} no summary yet, so {missing.length === 1 ? 'it is' : 'they are'} not in these figures.
        <button class="btn btn--small" type="button" onclick={() => void rebuild()} disabled={Boolean(rebuilding)}>{rebuilding || 'Rebuild summaries'}</button>
      </p>
    {/if}
    {#if empty}
      <div class="dash__empty" role="status"><h3>{empty.title}</h3><p>{empty.line}</p></div>
    {:else}

    <form class="dash__filters" aria-label="Filters" onsubmit={(event) => event.preventDefault()}>
      <fieldset class="dash__group">
        <legend>Period</legend>
        <div class="dash__chips">
          {#each SPANS as span (span.id)}
            <button class="btn btn--small dash__chip" type="button" aria-pressed={filters.span === span.id} onclick={() => setSpan(span.id)}>{span.label}</button>
          {/each}
        </div>
        <label class="dash__field"><span>Fiscal year</span>
          <select value={filters.year} onchange={(event) => { const year = (event.currentTarget as HTMLSelectElement).value; filters = { ...filters, year, period: filters.span.startsWith('q') ? `${year}-Q${filters.span.slice(1)}` : year }; }}>
            {#each years as year (year)}<option value={year}>{year}</option>{/each}
          </select>
        </label>
        {#if filters.span === 'month'}
          <label class="dash__field"><span>Month</span><input type="month" value={filters.month} onchange={(event) => { filters = { ...filters, month: (event.currentTarget as HTMLInputElement).value }; }} /></label>
        {:else if filters.span === 'custom'}
          <label class="dash__field"><span>From</span><input type="date" value={filters.from} onchange={(event) => { filters = { ...filters, from: (event.currentTarget as HTMLInputElement).value }; }} /></label>
          <label class="dash__field"><span>To</span><input type="date" value={filters.to} onchange={(event) => { filters = { ...filters, to: (event.currentTarget as HTMLInputElement).value }; }} /></label>
        {/if}
      </fieldset>
      <label class="dash__field"><span>Compare with</span>
        <select value={filters.compare} onchange={(event) => { filters = { ...filters, compare: (event.currentTarget as HTMLSelectElement).value }; }}>
          {#each BASELINES as baseline (baseline.id)}<option value={baseline.id}>{baseline.label}</option>{/each}
        </select>
      </label>
      {#if filters.compare === 'client'}
        <label class="dash__field"><span>Client to compare with</span>
          <select value={filters.compareClient} onchange={(event) => { filters = { ...filters, compareClient: (event.currentTarget as HTMLSelectElement).value }; }}>
            <option value="">Choose a client</option>
            {#each shownClients as client (client.id)}<option value={client.id}>{client.name}</option>{/each}
          </select>
        </label>
      {/if}
      <details class="dash__more">
        <summary>Clients{filters.clientIds.length ? ` (${filters.clientIds.length} chosen)` : ' (all)'}</summary>
        <fieldset class="dash__group"><legend class="dash__quiet">Clients</legend>
          {#each shownClients as client (client.id)}
            <label class="choice"><input type="checkbox" checked={filters.clientIds.includes(client.id)} onchange={(event) => toggleClient(client.id, (event.currentTarget as HTMLInputElement).checked)} /><span>{client.name}</span></label>
          {/each}
        </fieldset>
      </details>
      <label class="dash__field"><span>Industry</span>
        <select value={filters.industry} onchange={(event) => { filters = { ...filters, industry: (event.currentTarget as HTMLSelectElement).value }; }}>
          <option value="">All industries</option>
          {#each options.industries as industry (industry)}<option value={industry}>{industry}</option>{/each}
        </select>
      </label>
      <details class="dash__more">
        <summary>More filters</summary>
        <div class="dash__group">
          <label class="dash__field"><span>Region</span>
            <select value={filters.region} onchange={(event) => { filters = { ...filters, region: (event.currentTarget as HTMLSelectElement).value }; }}>
              <option value="">All regions</option>
              {#each options.regions as region (region)}<option value={region}>{region}</option>{/each}
            </select>
          </label>
          <label class="dash__field"><span>Facilitator</span>
            <select value={filters.facilitator} onchange={(event) => { filters = { ...filters, facilitator: (event.currentTarget as HTMLSelectElement).value }; }}>
              <option value="">Anyone</option>
              {#each options.facilitators as name (name)}<option value={name}>{name}</option>{/each}
            </select>
          </label>
          <label class="dash__field"><span>Activity type</span>
            <select value={filters.kind} onchange={(event) => { filters = { ...filters, kind: (event.currentTarget as HTMLSelectElement).value }; }}>
              <option value="">Any type</option>
              {#each options.kinds as kind (kind.id)}<option value={kind.id}>{kind.label}</option>{/each}
            </select>
          </label>
          <label class="dash__field"><span>Guest group</span>
            <select value={filters.group} onchange={(event) => { filters = { ...filters, group: (event.currentTarget as HTMLSelectElement).value }; }}>
              <option value="">Every group</option>
              {#each options.groups as group (group)}<option value={group}>{group}</option>{/each}
            </select>
          </label>
          <label class="dash__field"><span>Minimum sample</span>
            <input type="number" min="1" max="1000" inputmode="numeric" value={filters.minSample ?? board.minSample} onchange={(event) => { const value = Number((event.currentTarget as HTMLInputElement).value); filters = { ...filters, minSample: value > 0 ? value : null }; }} />
          </label>
          {#if mayName}
            <label class="choice"><input type="checkbox" checked={hideNames} disabled={!mayName} onchange={(event) => onHideNames((event.currentTarget as HTMLInputElement).checked)} /><span>Hide names</span></label>
          {/if}
        </div>
      </details>
    </form>

    <p class="dash__headline" aria-live="polite">{board.headline}</p>

    {#if !board.empty}
      <ul class="dash__tiles" aria-label="Key figures">
        {#each board.tiles as each (each.id)}
          <li class="dash__tile">
            <span class="dash__tile-name">{METRICS[each.id].label}<MetricInfo id={each.id} /></span>
            <span class="dash__tile-value">{each.text}</span>
            {#if each.low}<span class="tag">Low sample (n = {each.n})</span>{/if}
          </li>
        {/each}
      </ul>

      <div class="dash__grid">
        <section class="card dash__card" aria-labelledby="dash-by-client">
          <h3 id="dash-by-client">Confidence index and shift by client<MetricInfo id="client-index" /></h3>
          <p class="muted">Against {filters.compare === 'all' ? 'the all-client average' : BASELINES.find((each) => each.id === filters.compare)?.label.toLowerCase()}: the line is 100.</p>
          <p class="dash__shift-head">Under each bar: the shift<MetricInfo id="confidence-shift" /> and moved to confident<MetricInfo id="moved" />, which are not compared with the baseline.</p>
          <ul class="dash__bars">
            {#each board.byClient as row (row.clientId)}
              {@const said = shiftWords(row, row.guests)}
              <li class="dash__bar-row">
                <span class="dash__bar-label">{row.name}</span>
                <span class="dash__bar-track" aria-hidden="true">
                  <span class="dash__bar" style:width="{Math.min(100, ((row.index ?? 0) / scaleTop) * 100)}%"></span>
                  <span class="dash__bar-line" style:left="{(100 / scaleTop) * 100}%"></span>
                </span>
                <span class="dash__bar-value">{row.index === null ? 'Not measured' : whole(row.index)}{row.low ? ' (low sample)' : ''}</span>
                <span class="dash__shift" data-testid="client-shift">
                  <span>{said.shift}{#if row.shiftLow} <span class="tag">Low sample (n = {row.shift.n})</span>{/if}</span>
                  {#if said.moved}<span>{said.moved}{#if row.movedLow} <span class="tag">Low sample (n = {row.moved.started})</span>{/if}</span>{/if}
                  <span>{said.answered}</span>
                </span>
              </li>
            {/each}
          </ul>
        </section>

        <section class="card dash__card" aria-labelledby="dash-trend">
          <h3 id="dash-trend">{METRICS.trend.label}<MetricInfo id="trend" /></h3>
          <ul class="dash__bars">
            {#each board.trend as row (row.period)}
              <li class="dash__bar-row">
                <span class="dash__bar-label">{quarterWords(row.period)}</span>
                <span class="dash__bar-track" aria-hidden="true">
                  <span class="dash__bar" style:width="{Math.min(100, ((row.index ?? 0) / 150) * 100)}%"></span>
                  <span class="dash__bar-line" style:left="{(100 / 150) * 100}%"></span>
                </span>
                <span class="dash__bar-value">{row.index === null ? 'No sessions' : whole(row.index)}{row.low ? ' (low sample)' : ''}</span>
              </li>
            {/each}
          </ul>
        </section>
      </div>

      <section class="card dash__card" aria-labelledby="dash-clients">
        <h3 id="dash-clients">By client</h3>
        <div class="dash__rows" role="list">
          {#each board.byClient as row (row.clientId)}
            {@const expanded = open.includes(row.clientId)}
            {@const said = shiftWords(row, row.guests)}
            <div class="dash__client" role="listitem">
              <div class="dash__client-head">
                <button class="btn btn--small dash__arrow" type="button" aria-expanded={expanded} aria-controls="dash-sessions-{row.clientId}" onclick={() => toggleRow(row.clientId)}>
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><span class="dash__sr">{expanded ? 'Hide' : 'Show'} the sessions of</span> {row.name}
                </button>
                {#if clientById.get(row.clientId)}<ClientTagChips client={clientById.get(row.clientId)} />{/if}
                <span>{row.sessions.length} {row.sessions.length === 1 ? 'session' : 'sessions'}, {row.guests} guests</span>
                <span>Index {row.index === null ? 'not measured' : whole(row.index)}{row.low ? ' (low sample)' : ''}</span>
                <span>Change {row.change === null ? 'none to compare' : `${row.change > 0 ? '+' : ''}${whole(row.change)}`}<MetricInfo id="change" /></span>
                <span>{said.shift}{#if row.shiftLow} <span class="tag">Low sample (n = {row.shift.n})</span>{/if}</span>
                {#if said.moved}<span>{said.moved}{#if row.movedLow} <span class="tag">Low sample (n = {row.moved.started})</span>{/if}</span>{/if}
                <span>{said.answered}</span>
              </div>
              {#if expanded}
                <ul class="dash__sessions" id="dash-sessions-{row.clientId}" aria-label="Sessions of {row.name}">
                  {#each row.sessions as each (each.id)}
                    {@const told = shiftWords(each, each.guests)}
                    <li class="dash__session">
                      <span class="dash__session-name">{each.label}</span>
                      <span>{each.guests} guests, {each.completed} finished</span>
                      <span>Session index {each.index === null ? 'not measured' : whole(each.index)}{each.low ? ' (low sample)' : ''}<MetricInfo id="session-index" /></span>
                      <span class="dash__shift">
                        <span>{told.shift}{#if each.shiftLow} <span class="tag">Low sample (n = {each.shift.n})</span>{/if}</span>
                        {#if told.moved}<span>{told.moved}{#if each.movedLow} <span class="tag">Low sample (n = {each.moved.started})</span>{/if}</span>{/if}
                        <span>{told.answered}</span>
                      </span>
                      {#if !access || can(access, 'results.export', { clientId: row.clientId, sessionId: each.id, date: each.date })}<ReportExports sessionId={each.id} clientName={row.name} {hideNames} {onToast} />{/if}
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <div class="dash__grid">
        <section class="card dash__card" aria-labelledby="dash-priority">
          <h3 id="dash-priority">{METRICS['priority-index'].label}<MetricInfo id="priority-index" /></h3>
          {#if board.priority.length === 0}<p class="muted">No poll or ranking was answered in these sessions.</p>
          {:else}
            <ul class="dash__list">
              {#each board.priority as row (row.label)}
                <li><strong>{row.label}</strong>: first for {whole(row.share)}% here, {whole(row.baseShare)}% in the baseline. Index {row.index === null ? 'none' : whole(row.index)}{row.low ? ' (low sample)' : ''}</li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="card dash__card" aria-labelledby="dash-steps">
          <h3 id="dash-steps">{METRICS.distribution.label}<MetricInfo id="distribution" /></h3>
          {#if !board.distribution}<p class="muted">The confidence check was not asked in these sessions.</p>
          {:else}
            {#each [['Before', board.distribution.before, board.distribution.beforeCount], ['After', board.distribution.after, board.distribution.afterCount]] as [side, steps, count] (side)}
              <p class="dash__steps-name">{side} ({count} answers)</p>
              <ul class="dash__bars">
                {#each steps as value, at (at)}
                  <li class="dash__bar-row">
                    <span class="dash__bar-label">Step {at + 1}</span>
                    <span class="dash__bar-track" aria-hidden="true"><span class="dash__bar dash__bar--{side === 'After' ? 'after' : 'before'}" style:width="{value}%"></span></span>
                    <span class="dash__bar-value">{whole(value)}%</span>
                  </li>
                {/each}
              </ul>
            {/each}
          {/if}
        </section>
      </div>

      <section class="card dash__card" aria-labelledby="dash-themes">
        <h3 id="dash-themes">{METRICS.themes.label}<MetricInfo id="themes" /></h3>
        {#if board.themes.length === 0}<p class="muted">No Survey feedback was written in these sessions.</p>
        {:else}
          <ul class="dash__themes">{#each board.themes as theme (theme.word)}<li>{theme.word} <span class="muted">({theme.count})</span></li>{/each}</ul>
          <ul class="dash__quotes" aria-label="Comments">
            {#each board.quotes as quote, at (at)}<li>"{quote.text}" <span class="muted">{quote.name}</span></li>{/each}
          </ul>
        {/if}
      </section>
    {/if}
    {/if}
  {/if}
</section>
{/if}

<style>
  .dash__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .dash__filters {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem 1.25rem;
    margin: 0.5rem 0 1rem;
  }

  .dash__group {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem 1rem;
    border: 0;
    margin: 0;
    padding: 0;
  }

  .dash__group legend,
  .dash__field > span {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: 600;
  }

  .dash__quiet {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .dash__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .dash__chip[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: #fff;
  }

  .dash__field select,
  .dash__field input {
    min-height: 44px;
    font: inherit;
  }

  .dash__more > summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    cursor: pointer;
    font-weight: 600;
  }

  .dash__empty {
    padding: 1.5rem;
    border: 1px dashed var(--line);
    border-radius: 12px;
  }

  .dash__empty h3 {
    margin: 0 0 0.5rem;
  }

  .dash__headline {
    margin: 0 0 1rem;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .dash__tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 11rem), 1fr));
    gap: 0.75rem;
    margin: 0 0 1rem;
    padding: 0;
    list-style: none;
  }

  .dash__tile {
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem 1rem;
    border-top: 4px solid var(--viz-brand);
    border-radius: 6px;
    background: #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
  }

  .dash__tile-name {
    display: flex;
    align-items: center;
    font-weight: 600;
  }

  .dash__tile-value {
    font-size: 2rem;
    font-weight: 700;
  }

  .dash__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .dash__card {
    margin-bottom: 1rem;
    padding: 1rem;
  }

  .dash__card h3 {
    display: flex;
    align-items: center;
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }

  .dash__bars,
  .dash__list,
  .dash__themes,
  .dash__quotes,
  .dash__sessions {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dash__bar-row {
    display: grid;
    grid-template-columns: minmax(6rem, 10rem) 1fr minmax(5rem, auto);
    align-items: center;
    gap: 0.75rem;
    min-height: 2.25rem;
  }

  .dash__bar-track {
    position: relative;
    height: 1.1rem;
    background: var(--viz-grid, #e6e6e6);
    border-radius: 3px;
  }

  .dash__bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--viz-primary);
    border-radius: 3px;
  }

  .dash__bar--before {
    background: var(--viz-primary-tint);
  }

  .dash__bar-line {
    position: absolute;
    top: -0.3rem;
    bottom: -0.3rem;
    width: 2px;
    background: var(--viz-marker);
  }

  .dash__bar-value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .dash__shift-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 0.5rem;
  }

  .dash__shift {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    margin-bottom: 0.5rem;
    font-variant-numeric: tabular-nums;
  }

  .dash__client {
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line, #d0d0ce);
  }

  .dash__client-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
  }

  .dash__arrow {
    min-height: 44px;
    font-weight: 700;
  }

  .dash__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .dash__session {
    display: grid;
    gap: 0.25rem;
    margin: 0.5rem 0 0 2.5rem;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--viz-primary-tint);
  }

  .dash__session-name {
    font-weight: 600;
  }

  .dash__list li,
  .dash__quotes li {
    margin: 0.35rem 0;
  }

  .dash__themes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-bottom: 0.75rem;
    font-weight: 600;
  }

  .dash__steps-name {
    margin: 0.5rem 0 0.25rem;
    font-weight: 600;
  }

  .dash__rebuild {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
</style>
