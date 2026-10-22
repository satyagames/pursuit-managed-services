<script lang="ts">
  // The body of Today's Participant link card, inside AdminToday.svelte's section and under its heading while something is live: the link and
  // its Copy button, its QR image, the participant view and the Live display (Phase 17: moved out of AdminToday.svelte unchanged, with its copy
  // action, its markup and its styles). The link and the image are AdminToday's, made while a session is live.
  import { copyText } from '../lib/admin/admin-links.js';

  let { shareUrl, shareQr, onLive, onToast }: {
    shareUrl: string;
    shareQr: string;
    /** Opens the Live display of the live session. */
    onLive: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let shareField = $state<HTMLInputElement>();

  async function copyLink() {
    await copyText(shareUrl, shareField);
    onToast('Link copied', 'success');
  }
</script>

<div class="share__link">
  <input bind:this={shareField} class="input mono" readonly value={shareUrl} aria-label="Participant link" />
  <button class="btn" type="button" onclick={() => void copyLink()} disabled={!shareUrl}>Copy</button>
</div>
{#if shareQr}<img class="share__qr" src={shareQr} alt={`QR code for the participant link`} />{/if}
<div class="share__actions">
  <a class="btn btn--primary" href={shareUrl || './index.html'} target="_blank" rel="noopener">Open participant view</a>
  <button class="btn" type="button" onclick={onLive}>Live display</button>
</div>

<style>
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }

  .share__link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
  }

  .share__qr {
    justify-self: center;
    width: min(14rem, 60vw);
    aspect-ratio: 1;
    background: #fff;
    border: 1px solid var(--adm-line);
    border-radius: 0.75rem;
  }

  .share__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
</style>
