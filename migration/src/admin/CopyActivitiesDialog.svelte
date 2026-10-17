<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { activitiesOfClient, copyOutcome, copyTotalsText } from '../lib/admin/admin-content.js';

  type Client = { id: string; name: string; status?: string };
  type Section = { id: string; title: string; order?: number; enabled?: boolean; questionIds?: string[]; clientId?: string | null };
  type Question = { id: string; type: string; prompt: string; optionIds?: string[] };
  type Option = { id: string; questionId: string; label: string };
  type Content = { sections: Section[]; questions: Question[]; options: Option[] };
  type Plan = { items: unknown[]; skipped: { source: Section; reason: string; message: string }[]; totals: { activities: number; questions: number; options: number } };
  type Progress = { written: number; total: number; activity: string; activityIndex: number; activities: number };
  type Result = { copied: { source: Section }[]; skipped: { source: Section; message: string }[]; failed: { source: Section; error: Error }[]; notAttempted: Section[]; stopped: string | null; liveSessionSynced: boolean | null };

  // "Copy from another client...": choose a source client, tick its activities, see what would be
  // copied (and what would be skipped because the client has it), confirm. The copy is
  // dataService.copyActivities(): activity, questions and options with new ids, the client's own,
  // not live; written a few at a time with progress, and one that fails leaves nothing behind.
  let { target, clients, sections, onDone, onClose }: {
    target: Client;
    clients: Client[];
    /** Every activity, from the Content screen. */
    sections: Section[];
    /** The target's activities changed: the screen reads them again. */
    onDone: (copiedIds: string[]) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let sourceSelect = $state<HTMLSelectElement>();
  let sourceId = $state('');
  let content = $state<Content | null>(null);
  let loadingSource = $state(false);
  let loadError = $state('');
  let picked = $state<string[]>([]);
  let phase = $state<'choose' | 'running' | 'done'>('choose');
  let progress = $state<Progress | null>(null);
  let result = $state<Result | null>(null);
  let failure = $state('');
  let controller: AbortController | null = null;
  let stopping = $state(false);

  const sources = $derived(clients.filter((client) => client.id !== target.id && sections.some((section) => section.clientId === client.id)));
  const targetSections = $derived(activitiesOfClient(sections, target.id));
  const source = $derived(clients.find((client) => client.id === sourceId) ?? null);
  const questionIndex = $derived(new Map((content?.questions ?? []).map((question) => [question.id, question])));
  const optionIds = $derived(new Set((content?.options ?? []).map((option) => option.id)));
  const chosen = $derived((content?.sections ?? []).filter((section) => picked.includes(section.id)));
  const everything = $derived(content ? dataService.planCopy({ ...content, toClientId: target.id, targetSections }) as Plan : null);
  const skippedIds = $derived(new Set((everything?.skipped ?? []).map((entry) => entry.source.id)));
  const plan = $derived(content ? dataService.planCopy({ ...content, sections: chosen, toClientId: target.id, targetSections }) as Plan : null);
  const willSkip = $derived(plan?.skipped ?? []);
  const archived = $derived(target.status === 'archived');

  const countsOf = (section: Section) => {
    const own = (section.questionIds ?? []).flatMap((id) => (questionIndex.has(id) ? [questionIndex.get(id)!] : []));
    return { questions: own.length, options: own.reduce((sum, question) => sum + (question.optionIds ?? []).filter((id) => optionIds.has(id)).length, 0) };
  };
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  onMount(() => {
    sourceId = sources[0]?.id ?? '';
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    sourceSelect?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  });

  $effect(() => {
    const id = sourceId;
    untrack(() => { void loadSource(id); });
  });

  async function loadSource(id: string) {
    content = null;
    picked = [];
    loadError = '';
    if (!id) return;
    loadingSource = true;
    try {
      const owned = activitiesOfClient(sections, id);
      const read = await dataService.readActivityContent(owned) as { questions: Question[]; options: Option[] };
      if (sourceId === id) content = { sections: owned, ...read };
    } catch (cause) {
      if (sourceId === id) loadError = cause instanceof Error ? cause.message : 'Could not read that client\'s activities.';
    } finally {
      if (sourceId === id) loadingSource = false;
    }
  }

  function toggle(id: string, on: boolean) {
    picked = on ? [...picked, id] : picked.filter((entry) => entry !== id);
  }

  function toggleAll(on: boolean) {
    picked = on ? (content?.sections ?? []).filter((section) => !skippedIds.has(section.id)).map((section) => section.id) : [];
  }

  async function run() {
    if (!content || phase === 'running' || !plan || plan.totals.activities === 0) return;
    phase = 'running';
    failure = '';
    stopping = false;
    result = null;
    controller = new AbortController();
    progress = { written: 0, total: plan.totals.activities + plan.totals.questions + plan.totals.options, activity: '', activityIndex: 0, activities: plan.totals.activities };
    try {
      result = await dataService.copyActivities({
        toClientId: target.id,
        content: { sections: chosen, questions: content.questions, options: content.options },
        onProgress: (step: Progress) => { progress = step; },
        signal: controller.signal,
      }) as unknown as Result;
      // Whatever was copied is done with: running it again takes up what is missing.
      const done = new Set(result.copied.map((item) => item.source.id));
      picked = picked.filter((id) => !done.has(id));
      onDone([...done]);
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : 'The copy failed.';
    } finally {
      controller = null;
      phase = 'done';
    }
  }

  function stop() {
    stopping = true;
    controller?.abort();
  }

  const outcome = $derived(result ? copyOutcome(result as never, target.name) : null);
</script>

<dialog bind:this={dialog} class="adm-dialog adm-dialog--wide" aria-labelledby="copy-title" oncancel={(event) => { event.preventDefault(); if (phase !== 'running') onClose(); }}>
  <div class="adm-dialog__body">
    <h2 id="copy-title">Copy activities to {target.name}</h2>

    {#if archived}
      <p class="notice" role="note">{target.name} is archived. Restore it on Clients before adding activities.</p>
    {:else if sources.length === 0}
      <p class="muted">No other client has activities to copy.</p>
    {/if}

    {#if phase === 'choose' && !archived && sources.length > 0}
      <div class="field">
        <label class="field__label" for="copy-source">Copy from</label>
        <select id="copy-source" class="select" bind:this={sourceSelect} bind:value={sourceId}>
          {#each sources as client (client.id)}<option value={client.id}>{client.name}</option>{/each}
        </select>
      </div>
      {#if loadingSource}<p role="status">Reading {source?.name ?? 'the client'}'s activities...</p>
      {:else if loadError}<p class="error" role="alert">{loadError}</p>
      {:else if content}
        <div class="copy-bar">
          <label class="tick"><input type="checkbox" checked={chosen.length > 0 && chosen.length === content.sections.length - skippedIds.size} indeterminate={chosen.length > 0 && chosen.length < content.sections.length - skippedIds.size} onchange={(event) => toggleAll(event.currentTarget.checked)} /> <span>Select all</span></label>
        </div>
        <ul class="copy-list" aria-label={`${source?.name ?? ''} activities`}>
          {#each content.sections as section (section.id)}
            {@const counts = countsOf(section)}
            <li class="copy-row">
              <label class="tick">
                <input type="checkbox" checked={picked.includes(section.id)} onchange={(event) => toggle(section.id, event.currentTarget.checked)} />
                <span class="copy-row__text">
                  <span class="row__title">{section.title}</span>
                  <span class="muted small">{plural(counts.questions, 'question', 'questions')}, {plural(counts.options, 'option', 'options')}{skippedIds.has(section.id) ? ` · ${target.name} already has it` : ''}</span>
                </span>
              </label>
            </li>
          {/each}
        </ul>
        <div class="copy-summary" role="status" data-testid="copy-summary">
          {#if chosen.length === 0}
            <span class="muted">Tick the activities to copy.</span>
          {:else if plan && plan.totals.activities > 0}
            <strong>Copying {copyTotalsText(plan.totals)} to {target.name}.</strong>
            They start switched off, so no participant sees them until you switch them on.
          {:else}
            <strong>Nothing to copy.</strong>
          {/if}
          {#if willSkip.length > 0}
            <span class="copy-summary__skips">Skipping {willSkip.length} that {target.name} already has: {willSkip.map((entry) => `"${entry.source.title}"`).join(', ')}.</span>
          {/if}
        </div>
      {/if}
    {/if}

    {#if phase === 'running' && progress}
      <div role="status" data-testid="copy-progress">
        <p><strong>{progress.activity ? `Copying "${progress.activity}"` : 'Starting...'}</strong>{progress.activities ? ` (activity ${Math.max(1, progress.activityIndex)} of ${progress.activities})` : ''}</p>
        <progress class="copy-progress" max={progress.total} value={progress.written} aria-label="Copy progress"></progress>
        <p class="muted small">{progress.written} of {progress.total} records written. {stopping ? 'Stopping: the activity being written is removed again.' : 'An activity that cannot be finished is removed again, so nothing half-built is left.'}</p>
      </div>
    {/if}

    {#if phase === 'done'}
      {#if failure}<p class="error" role="alert">{failure}</p>{/if}
      {#if outcome}
        <div class="copy-result copy-result--{outcome.level}" role="status" data-testid="copy-result">
          <strong>{outcome.headline}</strong>
          {#if outcome.lines.length}<ul>{#each outcome.lines as line}<li>{line}</li>{/each}</ul>{/if}
          {#if outcome.rerun}<p class="small">Run it again to copy what is missing: activities that were copied are skipped.</p>{/if}
        </div>
      {/if}
    {/if}

    <div class="dialog__actions">
      {#if phase === 'running'}
        <button class="btn" type="button" onclick={stop} disabled={stopping}>{stopping ? 'Stopping...' : 'Stop'}</button>
      {:else if phase === 'done'}
        {#if outcome?.rerun || failure}<button class="btn btn--primary" type="button" onclick={() => void run()} disabled={chosen.length === 0 && !failure}>Run it again</button>{/if}
        <button class="btn" class:btn--primary={!outcome?.rerun && !failure} type="button" onclick={onClose}>Close</button>
      {:else}
        <button class="btn" type="button" onclick={onClose}>Cancel</button>
        <button class="btn btn--primary" type="button" onclick={() => void run()} disabled={archived || !plan || plan.totals.activities === 0}>{plan && plan.totals.activities > 0 ? `Copy ${plural(plan.totals.activities, 'activity', 'activities')}` : 'Copy'}</button>
      {/if}
    </div>
  </div>
</dialog>
