<script lang="ts">
  /**
   * "Hi Jane!" in the header of every screen but Welcome (which says it in its own body). It wraps when it must (a long name, a narrow window, larger text) and
   * is never shortened: Phase 8 found it cut to "Hi Casey..." at 320 px, which is a loss of what the page says (WCAG 1.4.10, reflow).
   */
  let { text }: { text: string } = $props();
</script>

<span class="pms-hi">{text}</span>

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
