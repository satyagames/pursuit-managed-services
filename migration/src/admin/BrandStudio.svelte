<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { effectiveSlug } from '../lib/admin/admin-clients.js';
  import { assetFileName, isOwnUpload } from '../lib/brand/asset-names.js';
  import { measureLogo, type Prepared } from '../lib/brand/asset-image.js';
  import { BRAND_SLOTS, slotSpec } from '../lib/brand/asset-specs.js';
  import type { Look } from '../lib/brand/brand-look.js';
  import { deviceById } from '../lib/brand/brand-devices.js';
  import { SCENES } from '../lib/brand/brand-sample.js';
  import {
    OPEN_PAGES_NOTE, brandReport, changesForSave, cloneDraft, copyColoursFrom, draftFromClient, parseColour, resetColours, sameDraft,
    type Draft, type LogoStats,
  } from '../lib/brand/brand-studio.js';
  import { motionEnabled, resolveClientTheme } from '../lib/brand/client-theme.js';
  import { DEFAULT_PRIMARY } from '../lib/brand/theme.js';
  import { participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import { mayLeave, revealer, setLeaveGuard } from '../lib/admin/unsaved.js';
  import { viewById } from '../lib/admin/admin-content-views.js';
  import {
    displayUrl as display, lookOf, pageGradient, previewAddress, savedMessage, slotStatus,
  } from '../lib/admin/brand-studio-view.js';
  import AssetUploader from './AssetUploader.svelte';
  import BrandColours from './BrandColours.svelte';
  import BrandPreviewPanel from './BrandPreviewPanel.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import CopyBrandDialog from './CopyBrandDialog.svelte';
  import MotionSwitch from './MotionSwitch.svelte';

  type Client = {
    id: string; name: string; slug?: string; status?: string; logoUrl?: string | null; primaryColor?: string; secondaryColor?: string;
    theme?: unknown; themeVersion?: number;
  };
  type Slot = (typeof BRAND_SLOTS)[number];

  let { client, clients, embedded = false, onClose = () => {}, onSaved, onToast, onDirty }: {
    client: Client;
    /** Every client, to copy a look from. */
    clients: Client[];
    /**
     * Drawn as a view of Content (Phase 18): its heading is a level 3 under Content's, "Brand · <client>", and it has no Back button (the
     * strip is the way out). Off, it is the screen it was.
     */
    embedded?: boolean;
    onClose?: () => void;
    /** The record as saved, so the list behind can show it. */
    onSaved: (record: Client) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** Whether there are unsaved changes, each time that changes: Content's strip says so while another view is showing. */
    onDirty?: (dirty: boolean) => void;
  } = $props();
  /** Brings this screen into sight before it asks to leave (Content's Brand view may be out of sight then). */
  const reveal = revealer();

  // Read once, when Brand Studio opens for this client (the screen is made afresh for each).
  function open() {
    const base = draftFromClient(client);
    return { record: { ...client } as Client, saved: base, draft: cloneDraft(base) };
  }
  const first = open();
  let record = $state<Client>(first.record);
  let saved = $state<Draft>(first.saved);
  let draft = $state<Draft>(first.draft);
  /** Pictures chosen and not saved yet: nothing is uploaded until Save. */
  let pending = $state<Record<Slot, Prepared | null>>({ hero: null, logo: null, background: null });

  let primaryTyped = $state<string | null>(null);
  let accentTyped = $state<string | null>(null);
  let sceneId = $state<Look['scene']>('welcome');
  let deviceId = $state('phone');
  let busy = $state(false);
  let error = $state('');
  let justSaved = $state(false);
  let conflict = $state(false);
  let copying = $state(false);
  let leaving = $state<((ok: boolean) => void) | null>(null);
  let logoStats = $state<LogoStats | null>(null);
  /** The address that shows the SAVED look on a real device, before the client is live (`index.html?preview=<id>`). */
  let deviceUrl = $state('');
  let deviceQr = $state('');

  const slug = $derived(effectiveSlug(dataService, record));
  const dirty = $derived(!sameDraft(draft, saved) || BRAND_SLOTS.some((slot) => pending[slot] !== null));
  const report = $derived(brandReport(draft, { logo: logoStats }));
  const device = $derived(deviceById(deviceId));
  const scene = $derived(SCENES.find((entry) => entry.id === sceneId) ?? SCENES[0]);
  const gradient = $derived(pageGradient(report.theme.tokens));

  // The words are the client's own, as a participant's page resolves them.
  const words = $derived(resolveClientTheme(record).copy);
  const look = $state<Look>({
    scene: 'welcome', clientName: '', eventTitle: '', eventSubtitle: '', welcomeLine: '', logoText: '', heroUrl: null, logoUrl: null,
    plate: 'light', backgroundUrl: null, backgroundFocus: null, motion: true,
  });
  $effect(() => {
    Object.assign(look, lookOf({ scene: sceneId, clientName: record.name, words, draft, motion: motionEnabled(record.theme) }));
  });

  // How light or dark the logo is, for the plate advice. Measured again when the logo changes.
  $effect(() => {
    const url = display(draft.assets.logo);
    let current = true;
    logoStats = null;
    if (url) void measureLogo(url).then((stats) => { if (current) logoStats = stats; });
    return () => { current = false; };
  });

  // ---- Leaving with unsaved changes -----------------------------------------------------------------

  onMount(() => {
    void participantPageUrl().then((base) => {
      deviceUrl = previewAddress(base, client.id);
    });
    const remove = setLeaveGuard(() => (dirty ? reveal().then(() => new Promise<boolean>((resolve) => { leaving = resolve; })) : true));
    return () => {
      remove();
      for (const slot of BRAND_SLOTS) if (pending[slot]) URL.revokeObjectURL(pending[slot]!.url);
    };
  });
  $effect(() => { onDirty?.(dirty); });
  $effect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });

  async function back() {
    if (await mayLeave()) onClose();
  }

  // ---- Editing ---------------------------------------------------------------------------------------

  const touched = () => { justSaved = false; error = ''; };

  function setPrimary(hex: string) {
    draft.primary = hex;
    primaryTyped = null;
    touched();
  }

  function typePrimary(value: string) {
    primaryTyped = value;
    const hex = parseColour(value);
    if (hex) { draft.primary = hex; touched(); }
  }

  function setAccent(hex: string | null) {
    draft.accent = hex;
    accentTyped = null;
    touched();
  }

  function typeAccent(value: string) {
    accentTyped = value;
    if (value.trim() === '') { draft.accent = null; touched(); return; }
    const hex = parseColour(value);
    if (hex) { draft.accent = hex; touched(); }
  }

  function release(slot: Slot) {
    if (pending[slot]) URL.revokeObjectURL(pending[slot]!.url);
    pending[slot] = null;
  }

  function pick(slot: Slot, prepared: Prepared) {
    release(slot);
    pending[slot] = prepared;
    draft.assets[slot] = prepared.url;
    if (slot === 'background' && !draft.focus) draft.focus = { x: 50, y: 50 };
    touched();
  }

  function remove(slot: Slot) {
    release(slot);
    draft.assets[slot] = null;
    if (slot === 'background') draft.focus = null;
    touched();
  }

  function revert() {
    for (const slot of BRAND_SLOTS) release(slot);
    draft = cloneDraft(saved);
    primaryTyped = null;
    accentTyped = null;
    touched();
    onToast('Back to the saved look', 'info');
  }

  function resetToStandard() {
    draft = { ...resetColours(draft) };
    primaryTyped = null;
    accentTyped = null;
    touched();
  }

  function copyFrom(other: Client) {
    copying = false;
    draft = { ...copyColoursFrom(draft, other) };
    primaryTyped = null;
    accentTyped = null;
    touched();
    onToast(`Colours copied from ${other.name}. Save to keep them.`, 'info');
  }

  // ---- Save --------------------------------------------------------------------------------------------

  /**
   * The order matters. Newly chosen pictures are uploaded first (a picture that fails stops the save before anything
   * changes); then the client is written once (theme, version + 1, the older colours, the logo address); only then are
   * the pictures it replaced removed, so a participant is never pointed at a file that is gone. If the write fails the
   * files just uploaded are removed again.
   */
  async function save(overwrite = false) {
    if (busy || !dirty) return;
    busy = true;
    error = '';
    justSaved = false;
    const uploaded: string[] = [];
    try {
      const fresh = await dataService.getClient(record.id) as Client | null;
      if (!fresh) throw new Error(`${record.name} no longer exists.`);
      if (!overwrite && (fresh.themeVersion ?? 0) !== (record.themeVersion ?? 0)) { conflict = true; return; }
      const next = cloneDraft(draft);
      for (const slot of BRAND_SLOTS) {
        const prepared = pending[slot];
        if (!prepared) continue;
        const name = assetFileName(slug, slot, new Uint8Array(await prepared.blob.arrayBuffer()), prepared.mime);
        const stored = await (dataService.uploadClientAsset as (file: Blob, name: string) => Promise<{ url: string }>)(prepared.blob, name);
        uploaded.push(stored.url);
        next.assets[slot] = stored.url;
      }
      // Written on the client as it is at this moment, not as it was read before the uploads (Phase 15): an Animations switch flipped
      // meanwhile, on Today or here, is kept (changesForSave carries the stored `motion` and `sample` over).
      let changes = changesForSave(fresh, next, saved);
      try {
        await (dataService.updateClientWith as (id: string, change: (latest: Client) => Record<string, unknown>) => Promise<Client>)(record.id, (latest) => {
          changes = changesForSave(latest, next, saved);
          return changes;
        });
      } catch (cause) {
        for (const url of uploaded) await (dataService.removeClientAsset as (url: string) => Promise<boolean>)(url);
        throw cause;
      }
      // The pictures this save replaced, if they were ours.
      let kept = 0;
      for (const slot of BRAND_SLOTS) {
        const old = saved.assets[slot];
        if (old && old !== next.assets[slot] && isOwnUpload(old, slug)) {
          if (!await (dataService.removeClientAsset as (url: string) => Promise<boolean>)(old)) kept += 1;
        }
      }
      for (const slot of BRAND_SLOTS) release(slot);
      record = { ...fresh, ...changes };
      saved = cloneDraft(next);
      draft = cloneDraft(next);
      primaryTyped = null;
      accentTyped = null;
      justSaved = true;
      onSaved(record);
      const said = savedMessage(kept);
      onToast(said.message, said.kind as 'info' | 'success');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save this look.';
    } finally {
      busy = false;
    }
  }

  async function showDeviceQr() {
    try { deviceQr = await qrImage(deviceUrl); } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Could not draw the QR code.', 'error'); }
  }

  const statusFor = (slot: Slot) => slotStatus({ pending: pending[slot], current: draft.assets[slot], saved: saved.assets[slot] });
</script>

<section class="brand" aria-labelledby="brand-title" aria-busy={busy}>
  <header class="brand__head" class:brand__head--embedded={embedded}>
    {#if !embedded}
      <div>
        <button class="btn" type="button" onclick={() => void back()} disabled={busy}>← Clients</button>
      </div>
    {/if}
    <div class="brand__title">
      {#if embedded}
        <h3 id="brand-title">{viewById('brand').label} · {record.name}</h3>
      {:else}
        <h2 id="brand-title">Brand Studio · {record.name}</h2>
      {/if}
      <p class="muted">Colours, logo, hero art and background for what this client's participants see. The preview shows the real screens, from your unsaved changes.</p>
    </div>
    <span class="pill" class:pill--in-progress={dirty} class:pill--completed={!dirty} data-testid="brand-status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
  </header>

  <div class="brand__grid">
    <div class="brand__controls">
      <!-- Colours -->
      <section class="card brand__card" aria-labelledby="brand-colours">
        <h3 id="brand-colours">Colours</h3>
        <BrandColours
          {draft} {primaryTyped} {accentTyped} {report} {gradient}
          onTypePrimary={typePrimary} onPrimaryBlur={() => { primaryTyped = null; }} onSetPrimary={setPrimary}
          onTypeAccent={typeAccent} onAccentBlur={() => { accentTyped = null; }} onSetAccent={setAccent}
          onPlate={(plate) => { draft.plate = plate; touched(); }}
        />
      </section>

      <!-- Pictures -->
      <section class="brand__pictures" aria-labelledby="brand-pictures">
        <h3 id="brand-pictures">Pictures</h3>
        <p class="muted small">Welcome shows the hero badge if there is one; otherwise the logo on the plate; otherwise the name in type. The background sits behind every screen. Pictures are cropped and shrunk to the right size here, in your browser, and uploaded when you save.</p>
        {#each BRAND_SLOTS as slot (slot)}
          <AssetUploader
            spec={slotSpec(slot)}
            url={display(draft.assets[slot])}
            status={statusFor(slot)}
            disabled={busy}
            focus={slot === 'background' ? draft.focus : null}
            onpick={(prepared) => pick(slot, prepared)}
            onremove={() => remove(slot)}
            onfocus={slot === 'background' ? (point) => { draft.focus = point; touched(); } : undefined}
          />
        {/each}
      </section>

      <section class="card brand__card" aria-labelledby="brand-motion">
        <h3 id="brand-motion">Animations</h3>
        <MotionSwitch client={record} help onSaved={(written) => { record = { ...record, theme: written.theme }; onSaved(record); }} {onToast} />
      </section>

      <div class="brand__actions card" role="group" aria-label="Save">
        <div class="brand__buttons">
          <button class="btn btn--primary" type="button" onclick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saving...' : 'Save'}</button>
          <button class="btn" type="button" onclick={revert} disabled={busy || !dirty}>Revert to saved</button>
          <button class="btn" type="button" onclick={resetToStandard} disabled={busy}>Reset to standard blue</button>
          <button class="btn" type="button" onclick={() => { copying = true; }} disabled={busy}>Copy brand from another client...</button>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        {#if justSaved}<p class="notice" role="status" data-testid="saved-note">{OPEN_PAGES_NOTE}</p>{/if}
        <p class="muted small">Standard blue is {DEFAULT_PRIMARY}. Resetting changes the colours and the plate, not the pictures.</p>
      </div>
    </div>

    <aside class="brand__preview" aria-label="Preview">
      <BrandPreviewPanel
        {look} tokens={report.theme.tokens} {device} {scene} {deviceId} {sceneId} clientName={record.name} {deviceUrl} {deviceQr}
        onDevice={(id) => { deviceId = id; }} onScene={(id) => { sceneId = id; }} onShowQr={() => void showDeviceQr()} {onToast}
      />
    </aside>
  </div>
</section>

{#if leaving}
  <ConfirmDialog
    title="Leave Brand Studio?"
    lead="You have changes that are not saved."
    points={['Leaving now discards them. Nothing has been uploaded or changed for participants.']}
    confirmLabel="Leave without saving"
    cancelLabel="Keep editing"
    onConfirm={() => { const done = leaving; leaving = null; done?.(true); }}
    onCancel={() => { const done = leaving; leaving = null; done?.(false); }}
  />
{/if}

{#if conflict}
  <ConfirmDialog
    title="Someone else changed this look"
    lead={`${record.name}'s look was saved by someone else after you opened it.`}
    points={['Saving yours replaces theirs. Cancel to keep editing, then reload this screen from Clients to see theirs.']}
    confirmLabel="Save mine anyway"
    cancelLabel="Cancel"
    onConfirm={() => { conflict = false; void save(true); }}
    onCancel={() => { conflict = false; }}
  />
{/if}

{#if copying}
  <CopyBrandDialog clients={clients.filter((entry) => entry.id !== record.id)} onChoose={copyFrom} onCancel={() => { copying = false; }} />
{/if}

<style>
  .brand {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }

  .brand__head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 0.75rem 1rem;
  }

  .brand__head--embedded {
    grid-template-columns: 1fr auto;
  }

  .brand__title h2,
  .brand__title h3,
  .brand__title p {
    margin: 0;
  }

  .brand__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }

  .brand__controls,
  .brand__pictures {
    display: grid;
    gap: 1rem;
    min-width: 0;
  }

  .brand__pictures > h3,
  .brand__pictures > p {
    margin: 0;
  }

  .brand__card {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    min-width: 0;
  }

  .brand__card h3 {
    margin: 0;
  }

  .brand__actions {
    display: grid;
    gap: 0.6rem;
    padding: 1rem;
  }

  .brand__actions p {
    margin: 0;
  }

  .brand__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .brand__preview {
    position: sticky;
    top: calc(var(--adm-sticky-top, 0px) + 0.5rem);
    display: grid;
    gap: 0.6rem;
    min-width: 0;
  }

  .error {
    color: var(--adm-bad-ink);
  }

  /* The preview moves below the controls on a narrow window. */
  @media (max-width: 820px) {
    .brand__grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .brand__preview {
      position: static;
    }

    .brand__head {
      grid-template-columns: 1fr;
    }
  }
</style>
