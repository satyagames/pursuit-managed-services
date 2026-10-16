<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import { answersToQuestions, orphanNote } from '../lib/adminData.js';
  import { LAYOUTS, MAX_OPTION_TEXT, imageUrlProblem, layoutApplies, optionTextProblem, optionValueFrom, orderedContent, picturesStillShown } from '../lib/admin-content.js';
  import { assetFileName, isOwnUpload } from '../lib/asset-names.js';
  import type { Prepared } from '../lib/asset-image.js';
  import { SLOTS } from '../lib/asset-specs.js';
  import { questionLayout } from '../lib/pager-logic.js';
  import AssetUploader from './AssetUploader.svelte';

  type Section = { id: string; title: string; clientId?: string | null; questionIds?: string[] };
  type Question = { id: string; sectionId: string; type: string; prompt: string; optionIds?: string[]; order?: number; layout?: string | null };
  type Option = { id: string; questionId: string; label: string; value: string | number | boolean; correct?: boolean | null; imageUrl?: string | null };
  type OptionDraft = { key: string; id?: string; label: string; correct: boolean; imageUrl: string; storedImage: string | null };
  type QuestionType = 'single-select' | 'multi-select' | 'true-false' | 'confidence-continuum' | 'ranked-voting' | 'open-text-feedback';
  type Layout = 'text-list' | 'image-grid';

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

  const specs: Record<QuestionType, { label: string; options: 'free' | 'fixed' | 'none'; correct: boolean; min: number; hint: string }> = {
    'single-select': { label: 'Single choice (poll or MCQ)', options: 'free', correct: true, min: 2, hint: 'Leave Correct off for a poll; mark one option for a multiple-choice question.' },
    'multi-select': { label: 'Multiple choice (select all)', options: 'free', correct: false, min: 2, hint: 'Participants can choose more than one option.' },
    'true-false': { label: 'True / False', options: 'fixed', correct: true, min: 2, hint: 'Optionally mark the correct answer.' },
    'confidence-continuum': { label: 'Confidence continuum (scale)', options: 'free', correct: false, min: 2, hint: 'Scale points from lowest to highest.' },
    'ranked-voting': { label: 'Ranked voting', options: 'free', correct: false, min: 2, hint: 'Participants rank options from most to least important.' },
    'open-text-feedback': { label: 'Open text feedback', options: 'none', correct: false, min: 0, hint: '' },
  };
  const types = Object.keys(specs) as QuestionType[];

  let questions = $state<Question[]>([]);
  let optionsByQuestion = $state<Record<string, Option[]>>({});
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');
  let editorOpen = $state(false);
  let editing = $state<Question | null>(null);
  let prompt = $state('');
  let type = $state<QuestionType>('single-select');
  let layout = $state<Layout>('text-list');
  let optionDrafts = $state<OptionDraft[]>([]);
  let editorHeading = $state<HTMLElement>();
  /** Pictures uploaded while this question is being edited, and the ones it began with. A picture is uploaded the moment it is chosen. */
  let uploadedNow = $state<string[]>([]);
  let storedAtOpen = $state<string[]>([]);
  let uploadNotice = $state<Record<string, string>>({});

  const currentSpec = $derived(specs[type]);
  const showsLayout = $derived(layoutApplies(type));
  const tiles = $derived(showsLayout && layout === 'image-grid');
  const pictured = $derived(optionDrafts.filter((option) => option.imageUrl.trim()).length);

  const newOption = (label = ''): OptionDraft => ({ key: crypto.randomUUID(), label, correct: false, imageUrl: '', storedImage: null });
  const draftOf = (option: Option): OptionDraft => ({ key: option.id, id: option.id, label: option.label, correct: option.correct === true, imageUrl: option.imageUrl ?? '', storedImage: option.imageUrl ?? null });

  onMount(() => {
    void refresh().catch((cause) => { if (alive) error = cause instanceof Error ? cause.message : 'Could not load the questions.'; })
      .finally(() => { if (alive) loading = false; });
    return () => { alive = false; };
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
  }

  function questionKind(question: Question): string {
    const questionOptions = optionsByQuestion[question.id] ?? [];
    if (question.type === 'single-select') return questionOptions.some((option) => option.correct === true) ? 'MCQ' : 'Poll';
    return specs[question.type as QuestionType]?.label ?? question.type;
  }

  async function openEditor(question: Question | null) {
    editing = question;
    prompt = question?.prompt ?? '';
    type = (question?.type as QuestionType) ?? 'single-select';
    const held = question ? optionsByQuestion[question.id] ?? [] : [];
    layout = question ? questionLayout({ ...question, options: held } as never) : 'text-list';
    optionDrafts = held.map(draftOf);
    storedAtOpen = held.map((option) => option.imageUrl ?? '').filter(Boolean);
    uploadedNow = [];
    uploadNotice = {};
    if (!question) applyTypeDefaults(true);
    else normalizeOptions();
    error = '';
    editorOpen = true;
    await Promise.resolve();
    editorHeading?.scrollIntoView({ block: 'nearest' });
  }

  function applyTypeDefaults(seed = false) {
    if (specs[type].options === 'none') {
      optionDrafts = [];
    } else if (specs[type].options === 'fixed') {
      optionDrafts = ['True', 'False'].map((label, index) => ({ key: optionDrafts[index]?.key ?? crypto.randomUUID(), id: optionDrafts[index]?.id, label, correct: optionDrafts[index]?.correct ?? false, imageUrl: optionDrafts[index]?.imageUrl ?? '', storedImage: optionDrafts[index]?.storedImage ?? null }));
    } else if (!specs[type].correct) {
      optionDrafts = optionDrafts.map((option) => ({ ...option, correct: false }));
    }
    if (specs[type].options === 'free' && (!optionDrafts.length || seed)) {
      const labels = type === 'confidence-continuum' ? ['Not confident', 'Moderately confident', 'Very confident'] : ['', ''];
      optionDrafts = labels.map((label, index) => optionDrafts[index] ?? newOption(label));
    }
  }

  function normalizeOptions() {
    if (specs[type].options === 'none') optionDrafts = [];
    else if (specs[type].options === 'fixed') {
      optionDrafts = ['True', 'False'].map((label, index) => ({ key: optionDrafts[index]?.key ?? crypto.randomUUID(), id: optionDrafts[index]?.id, label, correct: optionDrafts[index]?.correct ?? false, imageUrl: optionDrafts[index]?.imageUrl ?? '', storedImage: optionDrafts[index]?.storedImage ?? null }));
    } else if (!specs[type].correct) optionDrafts = optionDrafts.map((option) => ({ ...option, correct: false }));
  }

  function changeType(event: Event) {
    type = (event.currentTarget as HTMLSelectElement).value as QuestionType;
    applyTypeDefaults();
  }

  function markCorrect(key: string) {
    const next = !optionDrafts.find((option) => option.key === key)?.correct;
    optionDrafts = optionDrafts.map((option) => ({ ...option, correct: option.key === key && next }));
  }

  function moveOption(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= optionDrafts.length) return;
    const next = [...optionDrafts];
    [next[index], next[target]] = [next[target], next[index]];
    optionDrafts = next;
  }

  /**
   * Removes pictures this client uploaded that no option uses any more: the ones just replaced, and (on Cancel) the ones
   * just uploaded and never saved. Best effort, and only ever this client's own uploads (a pasted link or a seeded picture is never touched).
   */
  async function tidy(keep: Set<string>) {
    const candidates = [...new Set([...storedAtOpen, ...uploadedNow])].filter((url) => !keep.has(url) && isOwnUpload(url, clientSlug));
    // Forgotten before the first wait: an editor opened again while the reads below are on their way keeps its own lists.
    storedAtOpen = [];
    uploadedNow = [];
    // A duplicate of this activity, or a copy made for another client, shows the same file: ask which of these an answer still
    // shows, and leave every file when that cannot be told. (Removing one used to leave their tiles with no picture.)
    const shown = await picturesStillShown(dataService, candidates);
    if (shown) for (const url of candidates) {
      if (shown.has(url)) continue;
      await (dataService.removeClientAsset as (url: string) => Promise<boolean>)(url);
    }
  }

  function closeEditor() {
    editorOpen = false;
    error = '';
    void tidy(new Set(storedAtOpen));
  }

  /** A picture chosen for an answer tile: stored at once under its flat name, and its address put in the field. */
  async function uploadTile(option: OptionDraft, prepared: Prepared) {
    try {
      const bytes = new Uint8Array(await prepared.blob.arrayBuffer());
      const stored = await (dataService.uploadClientAsset as (file: Blob, name: string) => Promise<{ url: string }>)(prepared.blob, assetFileName(clientSlug, 'tile', bytes, prepared.mime));
      const previous = option.imageUrl.trim();
      option.imageUrl = stored.url;
      uploadedNow = [...uploadedNow, stored.url];
      uploadNotice = { ...uploadNotice, [option.key]: '' };
      // The picture it replaces, if it was an upload of this editing session, is no longer wanted.
      if (previous && previous !== stored.url && uploadedNow.includes(previous) && !storedAtOpen.includes(previous)) {
        void (dataService.removeClientAsset as (url: string) => Promise<boolean>)(previous);
        uploadedNow = uploadedNow.filter((url) => url !== previous);
      }
    } catch (cause) {
      uploadNotice = { ...uploadNotice, [option.key]: cause instanceof Error ? cause.message : 'The picture could not be uploaded.' };
    } finally {
      URL.revokeObjectURL(prepared.url);
    }
  }

  function readDraft() {
    const questionPrompt = prompt.trim();
    if (!questionPrompt) throw new Error('Enter the question text.');
    const draftOptions = optionDrafts.map((option) => ({ ...option, label: option.label.trim() })).filter((option) => option.label);
    if (draftOptions.length < specs[type].min) throw new Error(`Add at least ${specs[type].min} options.`);
    if (new Set(draftOptions.map((option) => option.label.toLowerCase())).size !== draftOptions.length) throw new Error('Option texts must be different from each other.');
    for (const [index, option] of draftOptions.entries()) {
      const problem = optionTextProblem(option.label);
      if (problem) throw new Error(`Option ${index + 1}: ${problem}`);
    }
    if (showsLayout && layout === 'image-grid') {
      for (const [index, option] of draftOptions.entries()) {
        const problem = imageUrlProblem(option.imageUrl);
        if (problem) throw new Error(`Option ${index + 1} (${option.label}): ${problem}`);
      }
    }
    return { prompt: questionPrompt, type, layout, options: draftOptions };
  }

  function makeOptionFields(draft: ReturnType<typeof readDraft>) {
    const taken = new Set<string>();
    const hasCorrect = specs[draft.type].correct && draft.options.some((option) => option.correct);
    return draft.options.map((option, index) => {
      let value: string | number | boolean;
      if (draft.type === 'confidence-continuum') value = index + 1;
      else if (draft.type === 'true-false') value = index === 0;
      else {
        value = optionValueFrom(option.label, taken);
        taken.add(value);
      }
      const picture = option.imageUrl.trim();
      return {
        label: option.label, value, correct: specs[draft.type].correct ? (hasCorrect ? option.correct : null) : null,
        // A picture is written when there is one, or to clear one that was stored; never otherwise,
        // so a list without the ImageUrl column is not asked to hold something it never had.
        ...(picture ? { imageUrl: picture } : option.storedImage ? { imageUrl: null } : {}),
      };
    });
  }

  /** Layout is written when it is a choice that is set to tiles, or already had a stored layout. */
  function layoutFields(draft: ReturnType<typeof readDraft>, question: Question | null) {
    if (!layoutApplies(draft.type)) return {};
    return draft.layout !== 'text-list' || question?.layout ? { layout: draft.layout } : {};
  }

  async function saveQuestion(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const draft = readDraft();
      if (editing) await updateQuestion(editing, draft);
      else await createQuestion(draft);
      editorOpen = false;
      void tidy(new Set(draft.options.map((option) => option.imageUrl.trim()).filter(Boolean)));
      onToast('Saved', 'success');
      await refresh();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save this question.';
    } finally {
      busy = false;
    }
  }

  async function createQuestion(draft: ReturnType<typeof readDraft>) {
    const created: { kind: 'question' | 'option'; id: string }[] = [];
    try {
      const existing = await dataService.listQuestions(sectionId) as Question[];
      const question = await dataService.createQuestion({
        sectionId, type: draft.type, prompt: draft.prompt, optionIds: [], order: Math.max(0, ...existing.map((item) => item.order ?? 0)) + 1, ...layoutFields(draft, null),
      }) as Question;
      created.push({ kind: 'question', id: question.id });
      const savedOptions: Option[] = [];
      for (const fields of makeOptionFields(draft)) {
        const option = await dataService.createOption({ questionId: question.id, ...fields }) as Option;
        created.push({ kind: 'option', id: option.id });
        savedOptions.push(option);
      }
      await dataService.updateQuestion(question.id, { optionIds: savedOptions.map((option) => option.id) });
      const current = await dataService.getSection(sectionId) as Section | null;
      const questionIds = [...(current?.questionIds ?? []), question.id];
      await dataService.updateSection(sectionId, { questionIds });
      onChanged(sectionId, questionIds);
    } catch (cause) {
      for (const item of created.reverse()) {
        await (item.kind === 'option' ? dataService.deleteOption(item.id) : dataService.deleteQuestion(item.id)).catch(() => {});
      }
      throw cause;
    }
  }

  async function updateQuestion(question: Question, draft: ReturnType<typeof readDraft>) {
    const fields = makeOptionFields(draft);
    const keptIds = new Set(draft.options.map((option) => option.id).filter(Boolean));
    const optionIds: string[] = [];
    for (const [index, option] of draft.options.entries()) {
      if (option.id) {
        await dataService.updateOption(option.id, fields[index]);
        optionIds.push(option.id);
      } else {
        const created = await dataService.createOption({ questionId: question.id, ...fields[index] }) as Option;
        optionIds.push(created.id);
      }
    }
    await dataService.updateQuestion(question.id, { type: draft.type, prompt: draft.prompt, optionIds, ...layoutFields(draft, question) });
    for (const id of question.optionIds ?? []) if (!keptIds.has(id)) await dataService.deleteOption(id);
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

<div class="questions" aria-busy={loading || busy}>
  <div class="panel__head questions__head">
    <div>
      <h3 id="questions-heading">Questions</h3>
      <p class="muted small">{section.title}. Changes to a live activity are live for participants.</p>
    </div>
    <button class="btn btn--primary" type="button" onclick={() => void openEditor(null)} disabled={busy || loading}>Add question</button>
  </div>

  {#if loading}<p role="status">Loading content...</p>
  {:else if error && !editorOpen}<p class="error" role="alert">{error}</p>
  {:else if questions.length === 0}<p class="muted">This activity has no questions yet.</p>
  {:else}
    <ul class="rows" aria-labelledby="questions-heading">
      {#each questions as question (question.id)}
        {@const questionOptions = optionsByQuestion[question.id] ?? []}
        <li class="row">
          <div class="row__main"><span class="row__title">{question.prompt}</span><span class="muted"><span class="tag">{questionKind(question)}</span> {specs[question.type as QuestionType]?.options === 'none' ? '' : `${questionOptions.length} options`}{questionLayout({ ...question, options: questionOptions } as never) === 'image-grid' && layoutApplies(question.type) ? ' · picture tiles' : ''}</span></div>
          <button class="btn" type="button" onclick={() => void openEditor(question)} disabled={busy}>Edit</button>
          <button class="btn btn--danger" type="button" onclick={() => void deleteQuestion(question)} disabled={busy}>Delete</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if editorOpen}
    <section class="content-editor" aria-labelledby="editor-heading">
      <h3 id="editor-heading" bind:this={editorHeading}>{editing ? 'Edit question' : 'Add question'}</h3>
      <form class="editor-form" onsubmit={saveQuestion}>
        <label class="field"><span class="field__label">Type</span><select class="select" value={type} onchange={changeType} disabled={busy}>{#each types as questionType}<option value={questionType}>{specs[questionType].label}</option>{/each}</select></label>
        <label class="field"><span class="field__label">Question</span><textarea class="input" rows="2" bind:value={prompt} disabled={busy}></textarea></label>
        {#if showsLayout}
          <label class="field">
            <span class="field__label">Layout</span>
            <select class="select" bind:value={layout} disabled={busy} aria-describedby="layout-help">
              {#each LAYOUTS as entry}<option value={entry.value}>{entry.label}</option>{/each}
            </select>
            <span id="layout-help" class="muted small">{tiles ? 'Each option is a tile with its picture. An option with no picture is shown as a text tile.' : 'Each option is a row of text.'}</span>
          </label>
        {/if}
        {#if currentSpec.options !== 'none'}
          <fieldset class="field">
            <legend class="field__label">Options</legend>
            <p class="muted small">{currentSpec.hint}</p>
            <ul class="opts">
              {#each optionDrafts as option, index (option.key)}
                <li class="opt" class:opt--tile={tiles}>
                  <div class="opt__line">
                    <input class="input" aria-label={`Option ${index + 1} text`} placeholder="Option text" bind:value={option.label} maxlength={MAX_OPTION_TEXT} readonly={currentSpec.options === 'fixed'} disabled={busy} />
                    {#if currentSpec.correct}<button class:btn--on={option.correct} class="btn btn--small" type="button" aria-pressed={option.correct} onclick={() => markCorrect(option.key)} disabled={busy}>✓ Correct</button>{/if}
                    {#if currentSpec.options === 'free'}
                      <button class="btn btn--small" type="button" aria-label="Move up" onclick={() => moveOption(index, -1)} disabled={busy || index === 0}>▲</button>
                      <button class="btn btn--small" type="button" aria-label="Move down" onclick={() => moveOption(index, 1)} disabled={busy || index === optionDrafts.length - 1}>▼</button>
                      <button class="btn btn--small btn--danger" type="button" aria-label="Remove option" onclick={() => { optionDrafts = optionDrafts.filter((item) => item.key !== option.key); }} disabled={busy}>✕</button>
                    {/if}
                  </div>
                  {#if option.label.length >= MAX_OPTION_TEXT}<p class="muted small" data-testid="option-limit">{MAX_OPTION_TEXT} characters: the most an answer's text can hold.</p>{/if}
                  {#if tiles}
                    <div class="opt__picture">
                      <input class="input" aria-label={`Option ${index + 1} picture address`} placeholder="https://... or /assets/..." bind:value={option.imageUrl} disabled={busy} inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" />
                      <div class="opt__preview" data-empty={!option.imageUrl.trim() || undefined}>
                        {#if option.imageUrl.trim() && !imageUrlProblem(option.imageUrl)}
                          <img src={option.imageUrl.trim()} alt={`Preview of the picture for ${option.label || `option ${index + 1}`}`} onerror={(event) => { (event.currentTarget as HTMLImageElement).hidden = true; }} onload={(event) => { (event.currentTarget as HTMLImageElement).hidden = false; }} />
                        {:else}
                          <span class="muted small">{imageUrlProblem(option.imageUrl) || 'A text tile will be used'}</span>
                        {/if}
                      </div>
                      <div class="opt__upload" data-option={index + 1}>
                        <AssetUploader compact spec={SLOTS.tile} url={option.imageUrl.trim() || null} disabled={busy} onpick={(prepared) => void uploadTile(option, prepared)} />
                        {#if uploadNotice[option.key]}<p class="error small" role="alert">{uploadNotice[option.key]}</p>{/if}
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if currentSpec.options === 'free'}<button class="btn btn--small" type="button" onclick={() => { optionDrafts = [...optionDrafts, newOption()]; }} disabled={busy}>+ Add option</button>{/if}
            {#if tiles}<p class="muted small" data-testid="tile-hint">A text tile will be used for any option with no picture{pictured === 0 ? ' (none has one yet, so every tile shows text)' : ''}. Upload a picture (it is cropped to 480 × 320 px here) or paste a link.</p>{/if}
          </fieldset>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="dialog__actions"><button class="btn" type="button" onclick={closeEditor} disabled={busy}>Cancel</button><button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
    </section>
  {/if}
</div>
