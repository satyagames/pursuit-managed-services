<script lang="ts">
  // Where you are (Prompt 33, rule 3): "Clients › Kroger › New session". Every part but the last is a button back to that place; the last is
  // the page you are on (aria-current). The words are the screen's own; this only draws them.
  let { parts }: { parts: { label: string; onclick?: () => void }[] } = $props();
</script>

<nav class="crumbs" aria-label="Breadcrumb" data-testid="breadcrumb">
  <ol class="crumbs__list">
    {#each parts as part, index (index)}
      <li class="crumbs__part">
        {#if index < parts.length - 1 && part.onclick}
          <button class="crumbs__link" type="button" onclick={part.onclick}>{part.label}</button><span class="crumbs__sep" aria-hidden="true">›</span>
        {:else}
          <span class="crumbs__here" aria-current={index === parts.length - 1 ? 'page' : undefined}>{part.label}</span>{#if index < parts.length - 1}<span class="crumbs__sep" aria-hidden="true">›</span>{/if}
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .crumbs__list {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 0.25rem;
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
  }

  .crumbs__part {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .crumbs__link {
    min-height: var(--target-min);
    padding: 0 0.25rem;
    border: 0;
    background: transparent;
    color: var(--adm-link);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }

  .crumbs__here {
    color: var(--adm-muted);
    overflow-wrap: anywhere;
  }

  .crumbs__sep {
    color: var(--adm-muted);
  }

  @media (forced-colors: active) {
    .crumbs__link {
      color: LinkText;
    }
  }
</style>
