<script lang="ts">
  /**
   * "Hi Jane!" in the header of every screen but Welcome (which says it in its own body). It wraps when it must (a long name, a narrow window, larger text) and
   * is never shortened: Phase 8 found it cut to "Hi Casey..." at 320 px, which is a loss of what the page says (WCAG 1.4.10, reflow).
   */
  import GuestAvatar from './GuestAvatar.svelte';

  // (Prompt 23: a guest's own header shows their picture, or the silhouette, beside the words; a member of staff has neither.)
  let { text, guest = false, picture = null }: { text: string; guest?: boolean; picture?: string | null } = $props();
</script>

{#if guest}<GuestAvatar src={picture} size={32} />{/if}<span class="pms-hi">{text}</span>

<style>
  .pms-hi {
    min-width: 0;
    max-width: 100%;
    font-size: clamp(1rem, 2.6vw, 1.25rem);
    line-height: 1.2;
    overflow-wrap: break-word;
    text-align: right;
  }
</style>
