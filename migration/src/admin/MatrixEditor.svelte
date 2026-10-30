<script lang="ts">
  import { AOP_LIMITS, DIRECTIONS } from '../lib/schema/aop-rules.js';
  import { editingNotice, newCriterion, parsePastedRows, rowsLine } from '../lib/admin/aop-editor.js';
  import ConfirmDialog from './ConfirmDialog.svelte';

  // The part of a question's editor that an Art of the Possible question has instead of options (Prompt 23, board 16): its criteria and its sub-processes. The rows are the
  // question's options, kept in the editor's own draft. What may be saved is lib/schema/aop-rules.js, asked by QuestionEditor when it saves; the rules here are
  // lib/admin/aop-editor.js's. Removing a row or a criterion after guests rated asks first; ratings are never deleted by an edit.
  export type Criterion = { id: string; label: string; hint: string; direction: string };
  export type RowDraft = { key: string; id?: string; label: string; people: string };

  let { criteria = $bindable(), rows = $bindable(), usedIds, busy = false, answered = 0, copiedFrom = '', mixed = false, newRow, id }: {
    criteria: Criterion[];
    rows: RowDraft[];
    /** Every criterion id this editor has met: a removed one is never made again. */
    usedIds: Set<string>;
    busy?: boolean;
    /** Guests who have rated in a session of this activity. */
    answered?: number;
    /** The client whose list a copy holds, until its rows are saved here. */
    copiedFrom?: string;
    /** The activity has other questions too. */
    mixed?: boolean;
    newRow: (label?: string, people?: string) => RowDraft;
    id: string;
  } = $props();

  const DIRECTION_WORDS: Record<string, string> = { favours: 'Favours', against: 'Counts against', none: 'Not in the score' };

  let pasting = $state(false);
  let pasted = $state('');
  let asking = $state<{ what: 'criterion' | 'row'; key: string; name: string } | null>(null);

  const notice = $derived(editingNotice(answered));
  const line = $derived(rowsLine(rows));
  const preview = $derived(pasted.trim() ? parsePastedRows(pasted, { existing: rows.filter((row) => row.label.trim()).map((row) => row.label) }) : null);

  function move<T>(list: T[], index: number, direction: -1 | 1): T[] {
    const target = index + direction;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }

  /** Remove: at once when nobody has rated, and otherwise after the question. */
  function askRemove(what: 'criterion' | 'row', key: string, name: string) {
    if (answered > 0) { asking = { what, key, name }; return; }
    remove(what, key);
  }

  function remove(what: 'criterion' | 'row', key: string) {
    if (what === 'criterion') criteria = criteria.filter((criterion) => criterion.id !== key);
    else rows = rows.filter((row) => row.key !== key);
  }

  function addPasted() {
    if (!preview || preview.refused || preview.rows.length === 0) return;
    rows = [...rows.filter((row) => row.label.trim() || row.people.trim()), ...preview.rows.map((row) => newRow(row.label, row.people))];
    pasted = '';
    pasting = false;
  }
</script>

{#if copiedFrom}<p class="notice small" role="note" data-testid="matrix-copied">This list is {copiedFrom}'s. Replace the sub-processes before using it for this client. This line goes when the question is saved.</p>{/if}
{#if notice}<p class="notice small" role="note" data-testid="matrix-answered">{notice}</p>{/if}
{#if mixed}<p class="muted small" data-testid="matrix-mixed">This activity has other questions too. Art of the Possible reads best as an activity of its own.</p>{/if}

<fieldset class="field">
  <legend class="field__label">Criteria</legend>
  <p class="muted small">Low, Medium and High are the same for every criterion. Say what High means, and whether a High counts for handing the work over.</p>
  <ul class="opts" data-testid="matrix-criteria">
    {#each criteria as criterion, index (criterion.id)}
      <li class="opt matrix-criterion">
        <div class="opt__line">
          <input class="input" aria-label={`Criterion ${index + 1} name`} placeholder="Criterion name" bind:value={criterion.label} maxlength={AOP_LIMITS.maxLabel} disabled={busy} />
          <select class="select" aria-label={`Criterion ${index + 1} direction`} bind:value={criterion.direction} disabled={busy}>
            {#each DIRECTIONS as direction}<option value={direction}>{DIRECTION_WORDS[direction]}</option>{/each}
          </select>
          <button class="btn btn--small" type="button" aria-label={`Move criterion ${index + 1} up`} onclick={() => { criteria = move(criteria, index, -1); }} disabled={busy || index === 0}>▲</button>
          <button class="btn btn--small" type="button" aria-label={`Move criterion ${index + 1} down`} onclick={() => { criteria = move(criteria, index, 1); }} disabled={busy || index === criteria.length - 1}>▼</button>
          <button class="btn btn--small btn--danger" type="button" aria-label={`Remove criterion ${index + 1}`} onclick={() => askRemove('criterion', criterion.id, criterion.label)} disabled={busy}>✕</button>
        </div>
        <input class="input" aria-label={`Criterion ${index + 1}: what High means`} placeholder="What High means" bind:value={criterion.hint} maxlength={AOP_LIMITS.maxHint} disabled={busy} />
      </li>
    {/each}
  </ul>
  <button class="btn btn--small" type="button" onclick={() => { criteria = [...criteria, newCriterion(usedIds)]; }} disabled={busy || criteria.length >= AOP_LIMITS.maxCriteria}>+ Add criterion</button>
</fieldset>

<fieldset class="field">
  <legend class="field__label">Sub-processes</legend>
  <p class="muted small" data-testid="matrix-line">{line}</p>
  <ul class="opts" data-testid="matrix-rows">
    {#each rows as row, index (row.key)}
      <li class="opt">
        <div class="opt__line">
          <input class="input" aria-label={`Sub-process ${index + 1} name`} placeholder="Sub-process" bind:value={row.label} maxlength={AOP_LIMITS.maxRowName} disabled={busy} />
          <input class="input matrix-people" aria-label={`Sub-process ${index + 1}: people (FTE)`} placeholder="People (FTE)" inputmode="decimal" bind:value={row.people} disabled={busy} />
          <button class="btn btn--small" type="button" aria-label={`Move sub-process ${index + 1} up`} onclick={() => { rows = move(rows, index, -1); }} disabled={busy || index === 0}>▲</button>
          <button class="btn btn--small" type="button" aria-label={`Move sub-process ${index + 1} down`} onclick={() => { rows = move(rows, index, 1); }} disabled={busy || index === rows.length - 1}>▼</button>
          <button class="btn btn--small btn--danger" type="button" aria-label={`Remove sub-process ${index + 1}`} onclick={() => askRemove('row', row.key, row.label)} disabled={busy}>✕</button>
        </div>
      </li>
    {/each}
  </ul>
  <div class="matrix-tools">
    <button class="btn btn--small" type="button" onclick={() => { rows = [...rows, newRow()]; }} disabled={busy || rows.length >= AOP_LIMITS.maxRows}>+ Add sub-process</button>
    <button class="btn btn--small" type="button" aria-expanded={pasting} aria-controls={`${id}-paste`} onclick={() => { pasting = !pasting; }} disabled={busy}>Paste from a spreadsheet</button>
  </div>
  {#if pasting}
    <div class="matrix-paste" id={`${id}-paste`}>
      <label class="field"><span class="field__label">Two columns copied from Excel: name, then people</span>
        <textarea class="input" rows="5" bind:value={pasted} disabled={busy} aria-describedby={`${id}-paste-preview`}></textarea>
      </label>
      <div id={`${id}-paste-preview`} class="small" data-testid="matrix-paste-preview" aria-live="polite">
        {#if preview}
          {#if preview.refused}<p class="error">{preview.refused}</p>{:else}<p>{preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'} will be added{preview.rows.length ? `: ${preview.rows.map((row) => row.label).join(', ')}` : ''}.</p>{/if}
          {#if preview.duplicates.length}<p class="muted">Already in the list, so left out: {preview.duplicates.join(', ')}.</p>{/if}
          {#if preview.blanks}<p class="muted">{preview.blanks} blank {preview.blanks === 1 ? 'line' : 'lines'} left out.</p>{/if}
          {#each preview.problems as problem}<p class="error">{problem}</p>{/each}
        {/if}
      </div>
      <button class="btn btn--small" type="button" onclick={addPasted} disabled={busy || !preview || !!preview.refused || preview.rows.length === 0}>Add{preview && !preview.refused && preview.rows.length ? ` ${preview.rows.length}` : ''}</button>
    </div>
  {/if}
</fieldset>

{#if asking}
  <ConfirmDialog
    title={asking.what === 'row' ? `Remove ${asking.name || 'this sub-process'}?` : `Remove ${asking.name || 'this criterion'}?`}
    lead={`${answered} ${answered === 1 ? 'guest has' : 'guests have'} already rated.`}
    points={[asking.what === 'row' ? 'Its ratings are kept, but hidden from Results.' : 'Its ratings are kept, but hidden from Results. A criterion added later starts with none of them.', 'Nothing changes until you save.']}
    confirmLabel="Remove"
    onConfirm={() => { const held = asking; asking = null; if (held) remove(held.what, held.key); }}
    onCancel={() => { asking = null; }}
  />
{/if}

<style>
  .matrix-criterion {
    display: grid;
    gap: 0.4rem;
  }

  .matrix-people {
    flex: 0 0 8rem;
    width: 8rem;
  }

  .matrix-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .matrix-paste {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .matrix-paste p {
    margin: 0.25rem 0;
  }
</style>
