<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { fieldProblem } from '../lib/access/field-values.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { DEFAULT_FISCAL_START } from '../lib/admin/session-plan.js';
  import { MIN_SAMPLE } from '../lib/results/index-math.js';
  import {
    MONTH_NAMES, fiscalChangeWords, moveQuestion, moveStoredPeriods, periodsToMove, readReportingSettings, saveReportingSettings,
  } from '../lib/admin/reporting-settings.js';

  // Reporting settings (Prompt 22, Part 2): a Super admin's (the matrix's settings.manage) screen for the two settings the Leadership dashboard reads, the
  // month the fiscal year starts in and the minimum sample. Opened from the dashboard. A new start month first says what follows it at once and what keeps
  // the quarters it was given (lib/admin/reporting-settings.js fiscalChangeWords); once saved, the stored quarters are moved only if the person asks.
  type Settings = { fiscalYearStartMonth: number | null; minSample: number | null };
  type Moves = ReturnType<typeof periodsToMove>;
  let { access, onBack, onSaved, onToast }: {
    access: any;
    onBack: () => void;
    onSaved: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let before = $state<Settings>({ fiscalYearStartMonth: null, minSample: null });
  let month = $state(String(DEFAULT_FISCAL_START));
  let min = $state('');
  let loading = $state(true);
  let error = $state('');
  let problem = $state('');
  let saving = $state(false);
  let pending = $state<{ moves: Moves; month: number } | null>(null);
  let moving = $state('');
  let heading = $state<HTMLElement>();

  async function load() {
    before = await readReportingSettings(dataService);
    month = String(before.fiscalYearStartMonth ?? DEFAULT_FISCAL_START);
    min = before.minSample === null ? '' : String(before.minSample);
  }

  /** What the form changes, against what is stored (an empty setting is its default: June, and 10). */
  function changesOf(): Record<string, number | null> {
    const changes: Record<string, number | null> = {};
    const wantedMonth = Number(month);
    if (wantedMonth !== (before.fiscalYearStartMonth ?? DEFAULT_FISCAL_START)) changes.fiscalYearStartMonth = wantedMonth;
    const wantedMin = min.trim() === '' ? null : Number(min.trim());
    if (wantedMin !== before.minSample) changes.minSample = wantedMin; // (NaN, from words, is never the stored value: it is refused below)
    return changes;
  }

  async function storedQuarters(newMonth: number): Promise<Moves> {
    const [[sessions], summaries] = await Promise.all([dataService.readLists([{ list: 'sessions' }]), dataService.readSessionSummaries()]);
    return periodsToMove(sessions as any[], summaries as any[], newMonth);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    const changes = changesOf();
    problem = Object.entries(changes).map(([field, value]) => fieldProblem('appsettings', field, value)).find(Boolean) ?? '';
    if (problem) return;
    if (!Object.keys(changes).length) { onToast('Nothing changed', 'info'); return; }
    saving = true;
    try {
      let moves: Moves | null = null;
      if ('fiscalYearStartMonth' in changes) {
        moves = await storedQuarters(Number(changes.fiscalYearStartMonth));
        const words = fiscalChangeWords({ from: before.fiscalYearStartMonth, to: Number(changes.fiscalYearStartMonth), sessions: moves.sessions.length, summaries: moves.summaries.length });
        if (!window.confirm(words)) return;
      }
      await saveReportingSettings(dataService, access, before, changes);
      await load();
      onToast('Reporting settings saved', 'success');
      onSaved();
      if (moves && moves.sessions.length + moves.summaries.length) pending = { moves, month: Number(changes.fiscalYearStartMonth) };
    } catch (cause) {
      problem = errorText(cause, 'Could not save the reporting settings.');
    } finally {
      saving = false;
    }
  }

  async function move() {
    if (!pending || moving) return;
    const { moves, month: to } = pending;
    if (!window.confirm(moveQuestion({ sessions: moves.sessions.length, summaries: moves.summaries.length, month: to }))) return;
    moving = 'Starting...';
    try {
      const done = await moveStoredPeriods(dataService, access, moves, { month: to, onProgress: (count, of) => { moving = `Moved ${count} of ${of}...`; } });
      onToast(done.failed.length ? `${done.moved} moved; ${done.failed.length} could not be` : `${done.moved} stored quarters moved`, done.failed.length ? 'error' : 'success');
      pending = null;
      onSaved();
    } catch (cause) {
      onToast(errorText(cause, 'Could not move the stored quarters.'), 'error');
    } finally {
      moving = '';
    }
  }

  onMount(() => {
    void load().catch((cause) => { error = errorText(cause, 'Could not read the reporting settings.'); })
      .finally(() => { loading = false; void tick().then(() => focusHeading(heading)); });
  });
</script>

<section class="panel reporting" aria-labelledby="reporting-heading" aria-busy={loading || saving || Boolean(moving)}>
  <header class="panel__head">
    <div>
      <h2 id="reporting-heading" bind:this={heading} tabindex="-1">Reporting settings</h2>
      <p class="muted">What the Leadership dashboard counts quarters from, and how few answers it marks as a low sample. Only a Super admin changes them; each change is kept in the history of changes.</p>
    </div>
    <button class="btn" type="button" onclick={onBack}>Back to the dashboard</button>
  </header>
  {#if loading}<p role="status">Loading the settings...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}
    <form class="reporting__form" onsubmit={(event) => void save(event)} novalidate>
      <div class="field">
        <label class="field__label" for="reporting-month">Fiscal year starts in</label>
        <select id="reporting-month" class="input" bind:value={month} disabled={saving}>
          {#each MONTH_NAMES as name, at (name)}<option value={String(at + 1)}>{name}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="reporting-min">Minimum sample</label>
        <input id="reporting-min" class="input" type="text" inputmode="numeric" autocomplete="off" bind:value={min} disabled={saving}
          aria-describedby="reporting-min-hint" aria-invalid={Boolean(problem)} />
        <p id="reporting-min-hint" class="muted">A whole number, 1 or more. Empty means {MIN_SAMPLE}.</p>
      </div>
      {#if problem}<p class="error reporting__problem" role="alert">{problem}</p>{/if}
      <button class="btn btn--primary" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save settings'}</button>
    </form>
    {#if pending}
      <div class="notice reporting__move" role="status">
        <p>{pending.moves.sessions.length + pending.moves.summaries.length} stored {pending.moves.sessions.length + pending.moves.summaries.length === 1 ? 'quarter keeps' : 'quarters keep'} the old start month. The trend and the quarter-before comparisons use them until they are moved.</p>
        <button class="btn" type="button" onclick={() => void move()} disabled={Boolean(moving)}>{moving || 'Move stored quarters'}</button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .reporting__form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0.75rem 1.5rem;
    max-width: 48rem;
  }

  .reporting__form .field {
    flex: 1 1 14rem;
  }

  .reporting__form .input {
    min-height: 44px;
  }

  .reporting__form > .btn {
    align-self: flex-end;
    margin-bottom: 1.6rem;
  }

  .reporting__problem {
    flex-basis: 100%;
  }

  .reporting__move {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .reporting__move p {
    margin: 0;
  }
</style>
