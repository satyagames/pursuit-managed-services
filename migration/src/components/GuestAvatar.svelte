<script lang="ts">
  // A guest's optional picture, round, beside their name (Prompt 23): where a name may be shown and nowhere else. The name is beside it, so the picture says nothing to a screen
  // reader (alt=""). With no picture, or one that fails to load, a neutral silhouette, drawn here so that it costs no request; never an initial, which would give away a hidden
  // name. The box is 1:1 and of a set size, so nothing moves when the picture arrives.
  let { src = null, size = 40 }: { src?: string | null; size?: number } = $props();

  let failed = $state<string | null>(null);
  const showing = $derived(src && failed !== src ? src : null);
</script>

<span class="pms-avatar" style:--avatar-size="{size}px" data-testid="guest-avatar">
  {#if showing}
    <img src={showing} alt="" loading="eager" width={size} height={size} onerror={() => { failed = src; }} />
  {:else}
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false" data-testid="guest-silhouette"><rect width="40" height="40" fill="#c7ccd3" /><circle cx="20" cy="15" r="7.5" fill="#f2f3f5" /><path d="M6 40c0-9.5 6.3-15 14-15s14 5.5 14 15z" fill="#f2f3f5" /></svg>
  {/if}
</span>

<style>
  .pms-avatar {
    display: inline-block;
    flex: none;
    width: var(--avatar-size);
    height: var(--avatar-size);
    overflow: hidden;
    vertical-align: middle;
    border-radius: 50%;
  }

  .pms-avatar img,
  .pms-avatar svg {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
