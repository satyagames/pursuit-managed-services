<script lang="ts">
  // The body of Today's status card, inside AdminToday.svelte's section: LIVE or NOT LIVE, the live client, its facts, and a refresh that failed
  // (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its styles). The section, and its edge that says live, stay AdminToday's.
  import { notLiveText, type liveStatus } from '../lib/admin/admin-today.js';

  let { status, participants, since, pollError }: {
    status: ReturnType<typeof liveStatus>;
    participants: number;
    /** "Live since", in words (lib/admin/today-view.js sinceText). */
    since: string;
    pollError: string;
  } = $props();
</script>

<div class="status__head">
  <h3 id="status-heading" class="sr-only">Status</h3>
  <span class="badge" class:badge--live={status.live}><span class="badge__dot" aria-hidden="true"></span>{status.live ? 'LIVE' : 'NOT LIVE'}</span>
  {#if status.live && status.client}<p class="status__client">{status.client.name}</p>{/if}
</div>
{#if status.live && status.session}
  <dl class="facts">
    <div><dt>Date</dt><dd>{status.session.date ?? 'Undated'}</dd></div>
    <div><dt>Session</dt><dd class="mono">{status.session.id}</dd></div>
    <div><dt>Participants</dt><dd data-testid="participants">{participants}</dd></div>
    <div><dt>Live since</dt><dd>{since}</dd></div>
  </dl>
{:else}
  <p class="status__text">{notLiveText(status)}</p>
{/if}
{#if pollError}<p class="muted small" role="status">Could not refresh just now ({pollError}). Trying again in a few seconds.</p>{/if}

<style>
  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: var(--fw-bold);
  }

  .status__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
  }

  .status__client {
    margin: 0;
    font-size: clamp(1.4rem, 3vw, 1.9rem);
    font-weight: var(--fw-bold);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .status__text {
    margin: 0;
    color: var(--adm-muted);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    padding: 0 0.85rem;
    border-radius: var(--radius-full);
    color: var(--adm-idle-ink);
    background: var(--adm-idle-bg);
    font-size: 0.95rem;
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
  }

  .badge__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.55;
  }

  .badge--live {
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
  }

  .badge--live .badge__dot {
    background: var(--focus);
    opacity: 1;
    box-shadow: 0 0 0 0.2rem rgb(134 188 37 / 0.3);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 0.9rem 1.25rem;
    margin: 0;
  }

  .facts div {
    min-width: 0;
  }

  dt {
    color: var(--adm-muted);
    font-size: 0.85rem;
    font-weight: var(--fw-semibold);
  }

  dd {
    margin: 0.1rem 0 0;
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }
</style>
