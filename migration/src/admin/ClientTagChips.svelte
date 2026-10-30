<script lang="ts">
  import { TAGS, cleanTag } from '../lib/admin/client-tags.js';

  // A client's Industry and Region as two small labels (Prompt 22): on the client's page, its row in Clients, its row on the dashboard and beside the
  // client in Content (where a Designer sees it). Read only; nothing shows for a tag that is empty. The words say which tag each is, so no colour carries a
  // meaning.
  let { client }: { client: { industry?: unknown; region?: unknown; [field: string]: unknown } } = $props();
  const shown = $derived(TAGS.map((tag) => ({ ...tag, value: cleanTag(client[tag.key as 'industry' | 'region']) })).filter((tag) => tag.value));
</script>

{#if shown.length}
  <span class="client-tags">
    {#each shown as tag (tag.key)}<span class="client-tags__tag" data-testid="client-tag-{tag.key}">{tag.label}: {tag.value}</span>{/each}
  </span>
{/if}

<style>
  .client-tags {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .client-tags__tag {
    padding: 0.1rem 0.6rem;
    border: 1px solid var(--line, #d0d0ce);
    border-radius: 999px;
    color: var(--ink);
    font-size: 1rem;
    font-weight: 600;
  }
</style>
