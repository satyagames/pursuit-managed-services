<script lang="ts">
  // The body of Today's Share card, inside AdminToday.svelte's section and under its heading while something is live (Prompt 38: the participant link,
  // its QR and the wall's link in one place, each with Copy and Open). The participant link and its image are AdminToday's, made while a session is
  // live; the wall is Results' Live display as the wall, in a new tab, or here through Live display.
  import { copyText } from '../lib/admin/admin-links.js';
  import Icon from './Icon.svelte';

  let { shareUrl, shareQr, wallUrl = '', onLive, onToast }: {
    shareUrl: string;
    shareQr: string;
    /** The wall's address (the Live display as the wall), or ''. */
    wallUrl?: string;
    /** Opens the Live display of the live session. */
    onLive: () => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let shareField = $state<HTMLInputElement>();
  let wallField = $state<HTMLInputElement>();
  const wallAddress = $derived(wallUrl ? new URL(wallUrl, window.location.href).href : '');

  async function copyLink() {
    await copyText(shareUrl, shareField);
    onToast('Link copied', 'success');
  }

  async function copyWall() {
    await copyText(wallAddress, wallField);
    onToast('Wall link copied', 'success');
  }
</script>

<div class="share__group">
  <p class="share__label"><Icon name="link" />Participant link</p>
  <div class="share__link">
    <input bind:this={shareField} class="input mono" readonly value={shareUrl} aria-label="Participant link" />
    <button class="btn btn--with-icon" type="button" onclick={() => void copyLink()} disabled={!shareUrl}><Icon name="copy" />Copy</button>
    <a class="btn btn--with-icon" href={shareUrl || './index.html'} target="_blank" rel="noopener"><Icon name="external" />Open<span class="sr-only"> participant view</span></a>
  </div>
  {#if shareQr}<img class="share__qr" src={shareQr} alt={`QR code for the participant link`} />{/if}
</div>

{#if wallAddress}
  <div class="share__group">
    <p class="share__label"><Icon name="screen" />Wall link</p>
    <div class="share__link">
      <input bind:this={wallField} class="input mono" readonly value={wallAddress} aria-label="Wall link" />
      <button class="btn btn--with-icon" type="button" onclick={() => void copyWall()}><Icon name="copy" />Copy<span class="sr-only"> wall link</span></button>
      <a class="btn btn--with-icon" href={wallAddress} target="_blank" rel="noopener"><Icon name="external" />Open<span class="sr-only"> the wall</span></a>
    </div>
  </div>
{/if}
<button class="btn btn--with-icon" type="button" onclick={onLive}><Icon name="bar-chart" />Live display</button>

<style>
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }

  .share__group {
    display: grid;
    gap: var(--adm-s2);
  }

  .share__label {
    display: flex;
    align-items: center;
    gap: var(--adm-s2);
    margin: 0;
    font-weight: var(--fw-semibold);
  }

  .share__label :global(.icon) {
    color: var(--adm-primary);
  }

  /* The link, then Copy and Open; in a narrow column the link takes a row of its own rather than shrinking under a finger's width. */
  .share__link {
    display: flex;
    flex-wrap: wrap;
    gap: var(--adm-s2);
  }

  .share__link .input {
    flex: 1 1 12rem;
    min-width: 0;
  }

  .share__qr {
    justify-self: center;
    width: min(12rem, 60vw);
    aspect-ratio: 1;
    border: 1px solid var(--adm-line);
    border-radius: var(--adm-radius-sm);
    background: var(--adm-surface);
  }
</style>
