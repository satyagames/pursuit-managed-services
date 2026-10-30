<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { PictureError, decodeImage, prepareAsset, type Decoded, type Prepared } from '../lib/brand/asset-image.js';
  import { ACCEPT, MAX_INPUT_BYTES, SLOTS, checkDimensions } from '../lib/brand/asset-specs.js';
  import type { View } from '../lib/brand/crop-math.js';
  import { inspectFile } from '../lib/brand/image-sniff.js';
  import { PICTURE_CONSENT } from '../lib/admin/guest-picture.js';
  import GuestAvatar from '../components/GuestAvatar.svelte';
  import CropDialog from './CropDialog.svelte';

  // Adding a guest's picture (Prompt 23, board 16): Take photo or Choose file, a round crop, and a finished picture of 256 by 256 under 60 KB, re-encoded in the browser, which
  // strips what a phone hides in a file. It stores nothing itself: the host decides when (lib/admin/guest-picture.js).
  let { name, current = null, busy = false, onpick, onremove, onclose }: {
    /** Whose picture it is; empty while the guest is still being added. */
    name: string;
    current?: string | null;
    busy?: boolean;
    onpick: (prepared: Prepared) => void;
    onremove?: () => void;
    onclose: () => void;
  } = $props();

  const spec = SLOTS.guest;
  let dialog = $state<HTMLDialogElement>();
  let camera = $state<HTMLInputElement>();
  let chooser = $state<HTMLInputElement>();
  let working = $state('');
  let message = $state('');
  let cropping = $state<{ decoded: Decoded; warning: string } | null>(null);

  onMount(() => { dialog?.showModal(); });

  async function choose(file: File | undefined) {
    if (!file || working) return;
    message = '';
    working = 'Checking the picture...';
    try {
      const bytes = file.size > 0 && file.size <= MAX_INPUT_BYTES ? new Uint8Array(await file.arrayBuffer()) : null;
      const verdict = inspectFile({ size: file.size, bytes });
      if (!verdict.ok) { message = verdict.message; return; }
      const decoded = await decodeImage(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: verdict.mime }));
      const size = checkDimensions(spec, decoded);
      if (size.level === 'reject') { decoded.release(); message = size.message; return; }
      cropping = { decoded, warning: size.message };
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'That picture could not be opened.';
    } finally {
      working = '';
    }
  }

  async function finish(view: View | null) {
    const open = cropping;
    cropping = null;
    if (!open) return;
    if (!view) { open.decoded.release(); await tick(); return; }
    working = 'Preparing the picture...';
    try {
      onpick(await prepareAsset(open.decoded, spec, view));
    } catch (cause) {
      message = cause instanceof Error ? cause.message : 'The picture could not be prepared.';
      if (!(cause instanceof PictureError) && cause instanceof Error && cause.name !== 'CompressError') console.error(cause);
    } finally {
      open.decoded.release();
      working = '';
    }
  }

  function picked(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    void choose(file);
  }
</script>

<dialog bind:this={dialog} class="guest-picture" aria-labelledby="guest-picture-title" onclose={onclose} data-testid="guest-picture">
  <h3 id="guest-picture-title">{name ? `Picture of ${name}` : 'Picture'}</h3>
  <p class="guest-picture__now"><GuestAvatar src={current} size={64} /> <strong>{PICTURE_CONSENT}</strong></p>
  <p class="muted small">The picture is cropped round and made small here, in this browser. It shows where this guest's name may be shown, and goes when you remove it or delete the session.</p>
  <div class="guest-picture__actions">
    <button class="btn btn--primary" type="button" onclick={() => camera?.click()} disabled={busy || !!working}>Take photo</button>
    <button class="btn" type="button" onclick={() => chooser?.click()} disabled={busy || !!working}>Choose file</button>
    {#if current && onremove}<button class="btn btn--danger" type="button" onclick={onremove} disabled={busy || !!working}>Remove picture</button>{/if}
  </div>
  <input bind:this={camera} class="guest-picture__file" type="file" accept="image/*" capture="user" tabindex="-1" aria-hidden="true" onchange={picked} data-testid="guest-picture-camera" />
  <input bind:this={chooser} class="guest-picture__file" type="file" accept={ACCEPT} tabindex="-1" aria-hidden="true" onchange={picked} data-testid="guest-picture-file" />
  {#if working || busy}<p role="status">{working || 'Saving the picture...'}</p>{/if}
  {#if message}<p class="error" role="alert">{message}</p>{/if}
  <div class="dialog__actions"><button class="btn" type="button" onclick={() => dialog?.close()} disabled={busy}>Close</button></div>
</dialog>

{#if cropping}
  <CropDialog decoded={cropping.decoded} {spec} warning={cropping.warning} transparent={false} onconfirm={(view) => void finish(view)} oncancel={() => void finish(null)} />
{/if}

<style>
  .guest-picture {
    width: min(30rem, calc(100vw - 2rem));
    padding: 1.25rem;
    color: var(--adm-ink);
    background: var(--adm-card);
    border: 0;
    border-radius: 1rem;
  }

  .guest-picture::backdrop {
    background: rgb(11 31 58 / 0.55);
  }

  .guest-picture h3 {
    margin: 0 0 0.75rem;
  }

  .guest-picture__now {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin: 0 0 0.5rem;
  }

  .guest-picture__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.75rem 0;
  }

  .guest-picture__file {
    display: none;
  }
</style>
