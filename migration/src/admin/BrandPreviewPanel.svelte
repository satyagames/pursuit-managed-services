<script lang="ts">
  // The preview side of Brand Studio, inside BrandStudio.svelte's aside: which device and which screen, the preview itself and its caption, and
  // the card that checks the saved look on a real iPad (its address, Copy, Open and its QR image) (Phase 17: moved out of BrandStudio.svelte
  // unchanged, its markup and its styles). The device, the screen, the address and the image are BrandStudio's: this draws them and hands each
  // press back.
  import type { Look } from '../lib/brand/brand-look.js';
  import { DEVICES } from '../lib/brand/brand-devices.js';
  import { SCENES } from '../lib/brand/brand-sample.js';
  import { copyText } from '../lib/admin/admin-links.js';
  import BrandPreview from './BrandPreview.svelte';

  let { look, tokens, device, scene, deviceId, sceneId, clientName, deviceUrl, deviceQr, onDevice, onScene, onShowQr, onToast }: {
    look: Look;
    /** The resolved custom properties of the draft. */
    tokens: Record<string, string>;
    device: { id: string; label: string; width: number; height: number };
    scene: { id: string; label: string };
    deviceId: string;
    sceneId: string;
    clientName: string;
    /** The address that shows the SAVED look on a real device (`index.html?preview=<id>`). */
    deviceUrl: string;
    deviceQr: string;
    onDevice: (id: string) => void;
    onScene: (id: Look['scene']) => void;
    onShowQr: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  const FRAME = 'Preview of the';
</script>

<div class="brand__switch" role="group" aria-label="Device">
  {#each DEVICES as entry (entry.id)}
    <button class="btn brand__tab" type="button" aria-pressed={deviceId === entry.id} onclick={() => onDevice(entry.id)}>{entry.label}</button>
  {/each}
</div>
<div class="brand__switch" role="group" aria-label="Screen">
  {#each SCENES as entry (entry.id)}
    <button class="btn brand__tab" type="button" aria-pressed={sceneId === entry.id} onclick={() => onScene(entry.id as Look['scene'])}>{entry.label}</button>
  {/each}
</div>
<BrandPreview {look} {tokens} {device} label="{FRAME} {scene.label} screen on {device.label}, {device.width} by {device.height} pixels" />
<p class="muted small brand__caption">{scene.label} on {device.label}: {device.width} × {device.height} px, the real screen with sample content. Read-only.</p>

<section class="card brand__device" aria-labelledby="brand-device">
  <h3 id="brand-device">Check it on a real iPad</h3>
  <p class="muted small">This address shows {clientName}'s <strong>saved</strong> look (not unsaved changes) on any device, even before the client is live: its Welcome and read-only activities, marked Preview, saving nothing. Save first.</p>
  <div class="brand__colour">
    <input id="brand-device-url" class="input mono" value={deviceUrl} readonly aria-label="Preview address for a device" />
    <button class="btn" type="button" disabled={!deviceUrl} onclick={() => { void copyText(deviceUrl, document.querySelector<HTMLInputElement>('#brand-device-url')).then(() => onToast('Link copied', 'success')); }}>Copy</button>
    <a class="btn" href={deviceUrl || undefined} target="_blank" rel="noopener">Open</a>
    <button class="btn" type="button" disabled={!deviceUrl} onclick={onShowQr}>Show QR code</button>
  </div>
  {#if deviceQr}<img class="brand__qr" src={deviceQr} alt="QR code for the preview address" />{/if}
</section>

<style>
  .brand__colour {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .brand__colour .input {
    flex: 1 1 8rem;
    min-width: 0;
    min-height: var(--target-min);
    padding: 0 0.75rem;
  }

  .brand__switch {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .brand__tab[aria-pressed='true'] {
    color: #fff;
    background: var(--adm-ink);
    border-color: var(--adm-ink);
  }

  .brand__caption {
    margin: 0;
  }

  .brand__device {
    display: grid;
    gap: 0.6rem;
    padding: 1rem;
  }

  .brand__device h3,
  .brand__device p {
    margin: 0;
  }

  .brand__qr {
    width: 9rem;
    height: 9rem;
    background: #fff;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
