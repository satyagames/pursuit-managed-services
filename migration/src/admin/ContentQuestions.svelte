<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { answersToQuestions, orphanNote } from '../lib/admin/adminData.js';
  import { layoutApplies, orderedContent } from '../lib/admin/admin-content.js';
  import { setLeaveGuard } from '../lib/admin/unsaved.js';
  import { questionLayout } from '../lib/participant/pager-logic.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import QuestionEditor, { QUESTION_SPECS, type Draft, type Option, type Question, type QuestionType } from './QuestionEditor.svelte';

  type Section = { id: string; title: string; clientId?: string | null; questionIds?: string[] };

  let { section, clientSlug, onToast, onChanged }: {
    section: Section;
    /** The activity's client's slug, for the name a picture is stored under. */
    clientSlug: string;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** The activity's list of questions changed: the left-hand list shows the new count. */
    onChanged: (sectionId: string, questionIds: string[]) => void;
  } = $props();

  // This instance belongs to one activity (the screen keys it by id). `section` reads the screen's selection, which is
  // another activity once the facilitator clicks elsewhere, even while a save of this one is still on its way: every
  // write and every callback below uses the id it was opened with, never what `section` says by then.
  const sectionId = untrack(() => section.id);
  let alive = true;

  const specs = QUESTION_SPECS;

  let questions = $state<Question[]>([]);
  let optionsByQuestion = $state<Record<string, Option[]>>({});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');

  // ---- The editor, in place (Phase 16) ------------------------------------------------------------------------------------------
  // Edit opens the question's editor inside its own row, under its text, and Add question in a new row at the end of the list, where the
  // question will appear: one at a time. The draft is the editor's (QuestionEditor.svelte), so a refresh of the list never resets it.
  /** The new question's slot. */
  const NEW = 'new';
  /** Which question is being edited: its id, NEW, or nothing. */
  let editingId = $state<string | null>(null);
  let editorBusy = $state(false);
  let dirty = $state(false);
  let editor = $state<QuestionEditor>();
  /** What was typed, last time the editor said: offered back if its question is deleted elsewhere. */
  let typed: Draft | null = null;
  /** A new question's starting point: a draft offered back. */
  let seed = $state<Draft | null>(null);
  /** The text of a question that was deleted elsewhere while it was being edited, until the person takes it or dismisses it. */
  let gone = $state<Draft | null>(null);
  /** A switch or close that waits for "keep editing" or "discard": where the person wanted to go. */
  let asking = $state<{ next: string | null } | null>(null);
  /** Leaving the tab (or locking the page) with unsaved changes: the shell waits for the answer. */
  let leaving = $state<((go: boolean) => void) | null>(null);

  const editorId = (id: string) => `question-editor-${id}`;

  onMount(() => {
    void refresh().catch((cause) => { if (alive) error = cause instanceof Error ? cause.message : 'Could not load the questions.'; })
      .finally(() => { if (alive) loading = false; });
    return () => { alive = false; };
  });

  // Unsaved changes, as Brand Studio: the shell asks before it switches tab or locks, and the browser before the page is closed.
  $effect(() => {
    if (!dirty) return;
    const remove = setLeaveGuard(() => new Promise<boolean>((resolve) => { leaving = resolve; }));
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => { remove(); window.removeEventListener('beforeunload', warn); };
  });

  /** One read for the activity's questions and options (one $batch on SharePoint). */
  async function refresh() {
    if (!alive) return;
    error = '';
    const held = section;
    const content = await dataService.readActivityContent([held]) as { questions: Question[]; options: Option[] };
    if (!alive) return;
    const ordered = orderedContent(held, content.questions, content.options) as (Question & { options: Option[] })[];
    questions = ordered.map(({ options: _options, ...question }) => question);
    optionsByQuestion = Object.fromEntries(ordered.map((question) => [question.id, question.options]));
    // The question being edited was deleted elsewhere: say so, and keep what was typed.
    if (editingId && editingId !== NEW && !questions.some((question) => question.id === editingId)) questionGone(typed);
  }

  function questionKind(question: Question): string {
    const questionOptions = optionsByQuestion[question.id] ?? [];
    if (question.type === 'single-select') return questionOptions.some((option) => option.correct === true) ? 'MCQ' : 'Poll';
    return specs[question.type as QuestionType]?.label ?? question.type;
  }

  /** Focus back on what opened the editor: the row's Edit button, or Add question. */
  async function focusOpener(id: string) {
    await tick();
    document.querySelector<HTMLElement>(id === NEW ? '[data-add-question]' : `[data-edit-question="${CSS.escape(id)}"]`)?.focus();
  }

  function forgetEditor() {
    editingId = null;
    dirty = false;
    typed = null;
    seed = null;
  }

  /** Edit (or Add question) pressed: open that editor, close it when it is the one open, and ask first when the open one has changes. */
  function request(next: string) {
    if (editorBusy) return;
    const target = next === editingId ? null : next;
    if (editingId && dirty) { asking = { next: target }; return; }
    go(target);
  }

  /** Closes the open editor (the pictures it uploaded and nobody saved are tidied) and opens `next`, or none. */
  function go(next: string | null) {
    const was = editingId;
    if (was) editor?.discard();
    const keep = next === NEW ? seed : null;
    forgetEditor();
    seed = keep;
    editingId = next;
    if (next === null && was) void focusOpener(was);
  }

  async function saved(id: string) {
    forgetEditor();
    await refresh();
    await focusOpener(id);
  }

  function cancelled(ask: boolean) {
    if (ask) { asking = { next: null }; return; }
    const was = editingId;
    forgetEditor();
    if (was) void focusOpener(was);
  }

  function questionGone(draft: Draft | null) {
    forgetEditor();
    gone = draft;
    if (!draft) onToast('That question was deleted by someone else.', 'info');
  }

  async function deleteQuestion(question: Question) {
    if (busy) return;
    busy = true;
    try {
      const answers = await answersToQuestions({ id: sectionId, clientId: section.clientId }, [question.id]);
      const options = optionsByQuestion[question.id] ?? [];
      const warning = orphanNote(answers);
      if (!window.confirm(`Delete "${question.prompt}" and its ${options.length} options?${warning}`)) return;
      const current = await dataService.getSection(question.sectionId) as Section | null;
      const questionIds = (current?.questionIds ?? []).filter((id) => id !== question.id);
      if (current) await dataService.updateSection(current.id, { questionIds });
      await dataService.deleteQuestion(question.id);
      for (const option of options) await dataService.deleteOption(option.id);
      onToast('Question deleted', 'success');
      onChanged(sectionId, questionIds);
      await refresh();
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not delete this question.', 'error');
    } finally {
      busy = false;
    }
  }
</script>

{#snippet editorFor(question: Question | null)}
  {@const key = question?.id ?? NEW}
  <QuestionEditor bind:this={editor} bind:busy={editorBusy} {question} held={question ? optionsByQuestion[question.id] ?? [] : []} {sectionId} {clientSlug}
    id={editorId(key)} labelledBy={question ? `${editorId(key)}-heading question-title-${key}` : `${editorId(key)}-heading`} seed={question ? null : seed}
    {onToast} {onChanged} onSaved={saved} onCancel={cancelled} onDirty={(now, draft) => { dirty = now; typed = draft; }} onGone={questionGone} />
{/snippet}

<div class="questions" aria-busy={loading || busy || editorBusy}>
  <div class="panel__head questions__head">
    <div>
      <h3 id="questions-heading">Questions</h3>
      <p class="muted small">{section.title}. Changes to a live activity are live for participants.</p>
    </div>
    <button class="btn btn--primary" type="button" data-add-question aria-expanded={editingId === NEW} aria-controls={editingId === NEW ? editorId(NEW) : undefined} onclick={() => request(NEW)} disabled={busy || loading || editorBusy}>Add question</button>
  </div>

  {#if gone}
    <div class="notice questions__gone" role="status" data-testid="question-gone">
      <p>This question was deleted by someone else while you were editing it, so your changes were not saved{gone.prompt.trim() ? `. You wrote: "${gone.prompt.trim()}"` : ''}.</p>
      <div class="dialog__actions"><button class="btn" type="button" onclick={() => { gone = null; }}>Dismiss</button><button class="btn btn--primary" type="button" onclick={() => { const draft = gone; gone = null; seed = draft; request(NEW); }} disabled={busy || editorBusy}>Add it as a new question</button></div>
    </div>
  {/if}

  {#if loading}<p role="status">Loading content...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if questions.length === 0 && editingId !== NEW}<p class="muted">This activity has no questions yet.</p>
  {:else}
    <ul class="rows" aria-labelledby="questions-heading">
      {#each questions as question (question.id)}
        {@const questionOptions = optionsByQuestion[question.id] ?? []}
        {@const open = editingId === question.id}
        <li class="row" class:row--open={open} data-question={question.id}>
          <div class="row__main"><span class="row__title" id={`question-title-${question.id}`}>{question.prompt}</span><span class="muted"><span class="tag">{questionKind(question)}</span> {specs[question.type as QuestionType]?.options === 'none' ? '' : `${questionOptions.length} options`}{questionLayout({ ...question, options: questionOptions } as never) === 'image-grid' && layoutApplies(question.type) ? ' · picture tiles' : ''}</span></div>
          <button class="btn" type="button" data-edit-question={question.id} aria-expanded={open} aria-controls={open ? editorId(question.id) : undefined} onclick={() => request(question.id)} disabled={busy || editorBusy}>Edit</button>
          <button class="btn btn--danger" type="button" onclick={() => void deleteQuestion(question)} disabled={busy || editorBusy || open}>Delete</button>
          {#if open}{@render editorFor(question)}{/if}
        </li>
      {/each}
      {#if editingId === NEW}
        <li class="row row--open row--new" data-question="new">{@render editorFor(null)}</li>
      {/if}
    </ul>
  {/if}
</div>

{#if asking}
  <ConfirmDialog
    title="Discard your changes to this question?"
    lead="You have changes that are not saved."
    points={['Discarding them closes the editor. Nothing has been changed for participants.']}
    confirmLabel="Discard changes"
    cancelLabel="Keep editing"
    onConfirm={() => { const next = asking?.next ?? null; asking = null; go(next); }}
    onCancel={() => { asking = null; void tick().then(() => editor?.focusField()); }}
  />
{/if}

{#if leaving}
  <ConfirmDialog
    title="Leave without saving this question?"
    lead="You have changes that are not saved."
    points={['Leaving now discards them. Nothing has been changed for participants.']}
    confirmLabel="Leave without saving"
    cancelLabel="Keep editing"
    onConfirm={() => { const done = leaving; leaving = null; go(null); done?.(true); }}
    onCancel={() => { const done = leaving; leaving = null; done?.(false); void tick().then(() => editor?.focusField()); }}
  />
{/if}

<style>
  /* (Phase 16) The row of the question being edited holds its editor under its text: the row wraps, and the editor takes the whole width. */
  .row--open {
    flex-wrap: wrap;
  }

  .row--new {
    display: block;
  }

  .questions__gone {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .questions__gone p {
    margin: 0;
  }
</style>
