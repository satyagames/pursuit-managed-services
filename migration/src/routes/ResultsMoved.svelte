<script lang="ts">
  import { router } from 'svelte-spa-router';
  import { adminAddress } from '../lib/admin-address.js';
  import { APP_NAME } from '../lib/app-name.js';

  // `#/master-results/<sessionId>` was the facilitator's live results display. It lives on the admin page now (Results, "Live display"),
  // and so do the CSV, PDF and PowerPoint exports: this page only says so, and carries nothing of them. The link is built from the
  // address this page was opened at, so it finds admin.html in the same folder wherever that is hosted.
  const sessionId = $derived((router.params as Record<string, string> | undefined)?.sessionId ?? '');
  const href = $derived(adminAddress(window.location.href, sessionId));
</script>

<svelte:head><title>{APP_NAME}</title></svelte:head>

<section class="pms-moved">
  <h1>Results have moved to the admin page</h1>
  <p>The live display and the exports are now in the admin page, under Results.</p>
  <a class="pms-moved-link" {href} data-testid="moved-link">Open the live display</a>
</section>

<style>
  .pms-moved {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(1rem, 3dvh, 1.75rem);
    text-align: center;
  }

  h1 {
    margin: 0;
    font: normal var(--fw-bold) var(--fs-greeting) / 1.2 var(--font-sans);
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    font: var(--fw-light) var(--fs-description) / 1.45 var(--font-sans);
  }

  .pms-moved-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--target-min);
    min-height: var(--target-min);
    padding: 0.5rem 1.75rem;
    color: var(--text);
    font: var(--fw-semibold) var(--fs-button) / 1.2 var(--font-sans);
    text-decoration: none;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
  }
</style>
