<script lang="ts" module>
  export type Look = 'dark' | 'light';
</script>

<script lang="ts">
  // Dark or Light (Prompt 34): the look of the wall when it is shown full screen, or of the PDF and PowerPoint packs when they are downloaded.
  // Two buttons in one group, the chosen one pressed, each with its icon and its word. The choice is the page's, in memory for this visit: nothing is stored or read.
  import Icon from './Icon.svelte';

  let { label, value, onChange }: { label: string; value: Look; onChange: (look: Look) => void } = $props();
  const looks = [{ look: 'dark', word: 'Dark', icon: 'moon' }, { look: 'light', word: 'Light', icon: 'sun' }] as const;
</script>

<div class="look" role="group" aria-label={label}>
  <span class="look__label" aria-hidden="true">{label}</span>
  {#each looks as each (each.look)}
    <button type="button" class="look__option" aria-pressed={value === each.look} onclick={() => onChange(each.look)}>
      <Icon name={each.icon} size={18} />{each.word}
    </button>
  {/each}
</div>

<style>
  .look {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .look__label {
    color: var(--adm-muted);
  }

  .look__option {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--target-min, 44px);
    padding: 0 0.9rem;
    color: var(--adm-text);
    font: inherit;
    font-weight: var(--fw-semibold, 600);
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 999px;
    cursor: pointer;
  }

  .look__option[aria-pressed='true'] {
    color: var(--adm-on-deep);
    background: var(--adm-deep);
    border-color: var(--adm-deep);
  }

  @media (forced-colors: active) {
    .look__option[aria-pressed='true'] {
      outline: 2px solid CanvasText;
    }
  }
</style>
