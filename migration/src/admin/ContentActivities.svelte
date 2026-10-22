<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { answersToQuestions, confirmSampleClient, orphanNote } from '../lib/admin/adminData.js';
  import { activitiesOfClient, nextOrder, reorderActivities } from '../lib/admin/admin-content.js';
  import { viewById } from '../lib/admin/admin-content-views.js';
  import ActivityFormDialog from './ActivityFormDialog.svelte';
  import ActivityPreview from './ActivityPreview.svelte';
  import { effectiveSlug } from '../lib/admin/admin-clients.js';
  import ContentQuestions from './ContentQuestions.svelte';
  import SampleNotice from './SampleNotice.svelte';
  import CopyActivitiesDialog from './CopyActivitiesDialog.svelte';

  type Client = { id: string; name: string; status?: string; theme?: unknown; themeVersion?: number | null; logoUrl?: string | null };
  type Section = { id: string; title: string; enabled: boolean; order?: number; questionIds?: string[]; clientId?: string | null; description?: string | null };

  // Content's Activities view (Phase 18: moved out of AdminContent.svelte, which keeps the client header and the strip). One client's activities
  // are on the left, with their live switch and the rest; the selected activity's questions are on the right. Every activity belongs to a
  // client: one is added here, or copied from another client. Everything on the left is Sections.ClientId and Sections.Order; no column is added.
  // Content makes this view afresh for each client and keeps it while another view shows (`shown` false).
  let { clients = $bindable(), sections = $bindable(), client, busy = $bindable(false), shown, look, onEditBrand, onToast, adminName = '' }: {
    /** Every client, read by Content (the copy dialog lists them; a confirmed sample is written back). */
    clients: Client[];
    /** Every activity, read by Content. */
    sections: Section[];
    client: Client;
    /** Something is being changed here: Content holds its client picker while it is. */
    busy?: boolean;
    /** This view is the one showing. */
    shown: boolean;
    /** The client's look in a word ("Standard", "Custom"), for the line that leads to the Brand view. */
    look: string;
    onEditBrand: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    adminName?: string;
  } = $props();

  const clientId = untrack(() => client.id);
  let selectedId = $state(untrack(() => activitiesOfClient(sections, clientId)[0]?.id ?? ''));
  let working = $state('');
  let pendingIds = $state<string[]>([]);
  let preview = $state<{ section: Section; client: Client | null } | null>(null);
  let form = $state<{ mode: 'add' } | { mode: 'edit'; section: Section } | null>(null);
  let copyOpen = $state(false);

  /** The client's activities, in order: what the view shows. */
  const owned = $derived(activitiesOfClient(sections, clientId));
  const selected = $derived(owned.find((section) => section.id === selectedId) ?? null);
  const archived = $derived(client.status === 'archived');

  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  onMount(() => {
    let active = true;
    let polling = false;
    // The live switches follow what another admin does: one read of the activities every 15 s while
    // this view is on show, and not while something is being changed here.
    const timer = window.setInterval(() => {
      if (document.hidden || !shown || polling || busy || pendingIds.length > 0 || form || copyOpen || preview) return;
      polling = true;
      void readSections().then((next) => { if (active && !busy && pendingIds.length === 0) adopt(next); }).catch(() => {}).finally(() => { polling = false; });
    }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  });

  async function readSections(): Promise<Section[]> {
    const [rows] = await dataService.readLists([{ list: 'sections' }]) as unknown as [Section[]];
    return rows;
  }

  /** Takes a fresh list of activities; the selection stays unless that activity is gone. */
  function adopt(next: Section[]) {
    sections = next;
    if (!next.some((section) => section.id === selectedId)) selectedId = owned[0]?.id ?? '';
  }

  /** "Mark as confirmed" on a sample client (Phase 9b, SAM-2): who and when are stored in its ThemeJson; the client is read again to show it. */
  async function confirmSample() {
    if (busy) return;
    const target = client;
    busy = true;
    try {
      await confirmSampleClient(target.id, adminName);
      const [fresh] = await dataService.readLists([{ list: 'clients', where: { id: target.id } }]) as unknown as [Client[]];
      if (fresh[0]) clients = clients.map((entry) => (entry.id === target.id ? fresh[0] : entry));
      onToast(`${target.name}: sample content confirmed`, 'success');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not record the confirmation.', 'error');
    } finally {
      busy = false;
    }
  }

  const questionCount = (section: Section) => section.questionIds?.length ?? 0;

  async function setEnabled(section: Section, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const enabled = input.checked;
    if (enabled && !questionCount(section)) {
      if (!window.confirm(`"${section.title}" has no questions. Enable it anyway?`)) {
        input.checked = false;
        return;
      }
    }
    pendingIds = [...pendingIds, section.id];
    sections = sections.map((item) => item.id === section.id ? { ...item, enabled } : item);
    try {
      await dataService.updateSection(section.id, { enabled });
      onToast(`${section.title} is ${enabled ? 'live' : 'off'}`, 'success');
    } catch (cause) {
      sections = sections.map((item) => item.id === section.id ? { ...item, enabled: !enabled } : item);
      onToast(cause instanceof Error ? cause.message : 'Could not update this activity.', 'error');
    } finally {
      pendingIds = pendingIds.filter((id) => id !== section.id);
    }
  }

  // ---- Add, rename, describe -------------------------------------------------------------------------

  async function saveForm(title: string, description: string) {
    if (!form || busy) return;
    busy = true;
    try {
      if (form.mode === 'add') {
        const created = await dataService.createSection({
          title, order: nextOrder(owned), enabled: false, industryTags: [], questionIds: [], clientId, ...(description ? { description } : {}),
        }) as Section;
        sections = [...sections, created];
        selectedId = created.id;
        // Results count a session's activities from its own list, which Go live fills: join the live session now.
        await dataService.addSectionsToLiveSession(clientId, [created.id]).catch(() => {});
        onToast(`Added "${created.title}". It is not live yet.`, 'success');
      } else {
        const target = form.section;
        const changes: Record<string, string> = {};
        if (title !== target.title) changes.title = title;
        if (description !== (target.description ?? '')) changes.description = description;
        if (Object.keys(changes).length) {
          await dataService.updateSection(target.id, changes);
          sections = sections.map((item) => item.id === target.id ? { ...item, ...changes } : item);
        }
        onToast('Saved', 'success');
      }
      form = null;
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not save this activity.', 'error');
    } finally {
      busy = false;
    }
  }

  // ---- Duplicate, delete, reorder ---------------------------------------------------------------------

  async function duplicate(section: Section) {
    if (busy) return;
    busy = true;
    working = `Duplicating "${section.title}"...`;
    try {
      const result = await dataService.duplicateActivity(section.id) as unknown as { copied: { section: Section }[]; failed: { error: Error }[] };
      adopt(await readSections());
      if (result.copied[0]) {
        selectedId = result.copied[0].section.id;
        onToast(`Duplicated as "${result.copied[0].section.title}". It is not live yet.`, 'success');
      } else {
        onToast(result.failed[0]?.error.message ?? 'Could not duplicate this activity.', 'error');
      }
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not duplicate this activity.', 'error');
    } finally {
      working = '';
      busy = false;
    }
  }

  async function remove(section: Section) {
    if (busy) return;
    busy = true;
    working = `Checking "${section.title}"...`;
    try {
      const content = await dataService.readActivityContent([section]);
      const questions = content.questions.filter((question) => (section.questionIds ?? []).includes(question.id));
      const options = content.options.filter((option) => questions.some((question) => question.id === option.questionId));
      const answers = await answersToQuestions(section, questions.map((question) => question.id));
      const warning = orphanNote(answers);
      const live = section.enabled ? '\n\nIt is live: participants stop seeing it at once.' : '';
      if (!window.confirm(`Delete "${section.title}", its ${plural(questions.length, 'question', 'questions')} and ${plural(options.length, 'option', 'options')}?${warning}${live}`)) return;
      working = `Deleting "${section.title}"...`;
      const result = await dataService.deleteActivity(section.id, { content: { questions, options } }) as { leftovers: unknown[] };
      sections = sections.filter((item) => item.id !== section.id);
      if (selectedId === section.id) selectedId = owned[0]?.id ?? '';
      onToast(result.leftovers.length ? `"${section.title}" is deleted; ${plural(result.leftovers.length, 'record', 'records')} could not be removed and are harmless.` : `"${section.title}" is deleted`, 'success');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : 'Could not delete this activity.', 'error');
    } finally {
      working = '';
      busy = false;
    }
  }

  async function move(section: Section, direction: -1 | 1) {
    if (busy) return;
    const plan = reorderActivities(owned, section.id, direction);
    if (!plan) return;
    busy = true;
    const before = sections;
    sections = sections.map((item) => { const change = plan.changes.find((entry) => entry.id === item.id); return change ? { ...item, order: change.order } : item; });
    try {
      for (const change of plan.changes) await dataService.updateSection(change.id, { order: change.order });
    } catch (cause) {
      sections = before;
      onToast(cause instanceof Error ? cause.message : 'Could not change the order.', 'error');
    } finally {
      busy = false;
    }
    await tick();
    const stillMovable = reorderActivities(owned, section.id, direction) !== null;
    document.getElementById(`move-${stillMovable ? direction : -direction}-${section.id}`)?.focus();
  }

  /** A copy finished (or part of one did): read the activities again and open the first one it made. */
  function copied(ids: string[]) {
    void readSections().then((next) => {
      adopt(next);
      const first = owned.find((section) => ids.includes(section.id));
      if (first) selectedId = first.id;
    }).catch(() => {});
  }
</script>

{#snippet activityRow(section: Section)}
  {@const ownedIndex = owned.findIndex((entry) => entry.id === section.id)}
  <li class="row activity" class:activity--selected={section.id === selectedId} data-activity={section.id}>
    <button class="activity__select" type="button" aria-current={section.id === selectedId ? 'true' : undefined} onclick={() => { selectedId = section.id; }}>
      <span class="row__title">{section.title}</span>
      <span class="muted small">{plural(questionCount(section), 'question', 'questions')}{section.description ? ` · ${section.description}` : ''}</span>
    </button>
    <label class="switch">
      <input type="checkbox" aria-label={`Set ${section.title} live`} checked={section.enabled === true} disabled={pendingIds.includes(section.id)} onchange={(event) => void setEnabled(section, event)} />
      <span class="switch__track" aria-hidden="true"></span>
      <span class="switch__text">{section.enabled ? 'Live' : 'Off'}</span>
    </label>
    <div class="row__actions activity__actions">
      <button class="btn" type="button" aria-label={`Preview ${section.title}`} onclick={() => { preview = { section, client: clients.find((entry) => entry.id === section.clientId) ?? null }; }}>Preview</button>
      <button class="btn" type="button" aria-label={`Rename or describe ${section.title}`} onclick={() => { form = { mode: 'edit', section }; }} disabled={busy}>Rename</button>
      <button class="btn" type="button" aria-label={`Duplicate ${section.title}`} onclick={() => void duplicate(section)} disabled={busy}>Duplicate</button>
      <button class="btn btn--icon" id={`move--1-${section.id}`} type="button" aria-label={`Move ${section.title} up`} onclick={() => void move(section, -1)} disabled={busy || ownedIndex <= 0}>▲</button>
      <button class="btn btn--icon" id={`move-1-${section.id}`} type="button" aria-label={`Move ${section.title} down`} onclick={() => void move(section, 1)} disabled={busy || ownedIndex < 0 || ownedIndex >= owned.length - 1}>▼</button>
      <button class="btn btn--danger" type="button" aria-label={`Delete ${section.title}`} onclick={() => void remove(section)} disabled={busy}>Delete</button>
    </div>
  </li>
{/snippet}

<div class="content-bar">
  <p class="content-look" data-testid="content-look">Look: {look} <button class="btn content-look__edit" type="button" onclick={onEditBrand}>Open {viewById('brand').label}</button></p>
  <div class="panel__actions">
    <button class="btn btn--primary" type="button" onclick={() => { form = { mode: 'add' }; }} disabled={archived || busy} title={archived ? 'Restore this client on Clients to add activities' : undefined}>Add activity</button>
    <button class="btn" type="button" onclick={() => { copyOpen = true; }} disabled={archived || busy} title={archived ? 'Restore this client on Clients to add activities' : undefined}>Copy from another client...</button>
  </div>
</div>

<SampleNotice client={client as never} {busy} onConfirm={() => void confirmSample()} />

{#if working}<p role="status" class="content-working">{working}</p>{/if}

<div class="content-layout">
  <section class="content-activities" aria-labelledby="activities-heading">
    <h3 id="activities-heading">{client.name} activities</h3>
    {#if owned.length === 0}
      <p class="muted">{client.name} has no activities yet. Add one, or copy some from another client.</p>
    {:else}
      <ul class="rows" aria-labelledby="activities-heading">
        {#each owned as section (section.id)}{@render activityRow(section)}{/each}
      </ul>
    {/if}
  </section>

  <section class="content-detail" aria-label="Questions of the selected activity">
    {#if selected}
      {#key selected.id}
        <ContentQuestions
          section={selected}
          clientSlug={effectiveSlug(dataService, client)}
          {onToast}
          onChanged={(sectionId, questionIds) => { sections = sections.map((item) => item.id === sectionId ? { ...item, questionIds } : item); }}
        />
      {/key}
    {:else}
      <p class="muted">Choose an activity to see and edit its questions.</p>
    {/if}
  </section>
</div>

{#if preview}
  <ActivityPreview section={preview.section} client={preview.client} onClose={() => { preview = null; }} onToast={onToast}
    onChange={() => { void readSections().then(adopt).catch(() => {}); }} />
{/if}
{#if form}
  <ActivityFormDialog
    mode={form.mode}
    title={form.mode === 'edit' ? form.section.title : ''}
    description={form.mode === 'edit' ? form.section.description ?? '' : ''}
    siblings={owned}
    ignoreId={form.mode === 'edit' ? form.section.id : null}
    clientName={client.name}
    {busy}
    onSave={(title, description) => void saveForm(title, description)}
    onCancel={() => { form = null; }}
  />
{/if}
{#if copyOpen}
  <CopyActivitiesDialog target={client} {clients} {sections} onDone={copied} onClose={() => { copyOpen = false; }} />
{/if}
