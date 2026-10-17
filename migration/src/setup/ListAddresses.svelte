<script lang="ts">
  // "Where the lists are" (Phase 10b): one read-only row for each list and for the picture library, with the title this copy asks
  // by and, once asked of SharePoint, the address and the id it reports; and the answer of the one probe that asks for a list by its
  // address as well (lib/setup/setup-deployment.js). Nothing here changes anything. Only Setup loads this.
  type Row = { key: string; title: string; library: boolean; asked: boolean; found: boolean; address: string; id: string; note: string };
  let { rows, probe = '', status = '', busy = false, blocked = false, onread }: {
    rows: Row[];
    /** What the probe found, in words; '' before it has been asked. */
    probe?: string;
    status?: string;
    busy?: boolean;
    /** The page could not be set up, or is busy with something else: nothing may be asked of the site. */
    blocked?: boolean;
    onread: () => void;
  } = $props();
</script>

<p>
  <button class="btn" type="button" onclick={onread} disabled={busy || blocked}>{busy ? 'Reading...' : 'Read where the lists are'}</button>
</p>
{#if status}<p role="status">{status}</p>{/if}
{#if probe}<p data-testid="address-probe">{probe}</p>{/if}
<table class="where">
  <thead><tr><th scope="col">List, and the title asked for</th><th scope="col">Address and id, as SharePoint has them</th><th scope="col">Note</th></tr></thead>
  <tbody>
    {#each rows as row (row.key)}
      <tr data-list={row.key}>
        <th scope="row">
          <span class="where-line">{row.library ? 'picture library' : row.key}</span>
          <span class="where-line where-title">{row.title}</span>
        </th>
        <td>
          {#if !row.asked}
            not read yet
          {:else if !row.found}
            none
          {:else}
            <span class="where-line" data-address>{row.address || 'no address'}</span>
            <span class="where-line" data-id>{row.id}</span>
          {/if}
        </td>
        <td>{row.note}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  /* Three columns of long words, each of which may break where it must, so that a phone shows them without the page moving sideways. */
  .where {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  th,
  td {
    padding: 0.6rem 0.4rem;
    border-bottom: 1px solid var(--line, currentColor);
    overflow-wrap: anywhere;
    text-align: left;
    vertical-align: top;
  }

  thead th:first-child { width: 32%; }
  thead th:nth-child(2) { width: 38%; }
  tbody th { font-weight: 600; }
  .where-line { display: block; }
  .where-title { font-weight: 400; }
</style>
