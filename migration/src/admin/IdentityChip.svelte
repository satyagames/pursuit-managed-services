<script lang="ts">
  import Icon from './Icon.svelte';
  // The person in the bar (Prompt 32, step 2; board 19): their initials, name, role and reach, and "Ends 12 Dec" when a role ends within 14 days,
  // on a button that opens "Your access". The popover is a labelled region under the chip, not a dialog: it does not hold focus, and Esc, a click
  // outside or a second press closes it, focus back on the chip. Every word is lib/access/identity-words.js's, from the access the page already holds.
  import { tick } from 'svelte';
  import { myDetails, OWNER_BANNER } from '../lib/access/access-words.js';
  import { focusHeading } from '../lib/common/focus.js';

  type Identity = ReturnType<typeof import('../lib/access/identity-words.js').identityOf>;
  let { identity, person, open = $bindable(false) }: { identity: Identity; person: { name?: string; email?: string } | null; open?: boolean } = $props();

  let chip = $state<HTMLButtonElement>();
  let wrap = $state<HTMLElement>();
  let panel = $state<HTMLElement>();
  let copied = $state('');
  const panelId = 'your-access';

  async function close({ focus = true } = {}) {
    open = false;
    copied = '';
    if (focus) {
      await tick();
      chip?.focus();
    }
  }

  // Opened from elsewhere (the welcome strip's "What can I do?"): the popover's heading takes focus, so a keyboard is in it.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen && document.activeElement !== chip) void tick().then(() => focusHeading(panel?.querySelector<HTMLElement>('h2') ?? undefined));
    wasOpen = open;
  });

  function onDocumentKey(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      void close();
    }
  }

  function onDocumentPointer(event: PointerEvent) {
    if (open && wrap && !wrap.contains(event.target as Node)) void close({ focus: false });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(myDetails(person));
      copied = 'Copied your name and email.';
    } catch {
      copied = `Copy this by hand: ${myDetails(person)}`;
    }
  }
</script>

<svelte:document onkeydown={onDocumentKey} onpointerdown={onDocumentPointer} />

<div class="who" bind:this={wrap}>
  <!-- (The chip's name is its one line, said from its content rather than aria-label: it is a button, not a field, and is no label of anything.) -->
  <button bind:this={chip} class="who__chip" type="button" aria-expanded={open} aria-controls={panelId}
    data-testid="identity-chip" onclick={() => (open ? void close({ focus: false }) : (open = true))}>
    <span class="sr-only">{identity.ariaLabel}</span>
    <span class="who__badge" aria-hidden="true">{identity.initials}</span>
    <span class="who__text" aria-hidden="true">
      <span class="who__name">{identity.name}</span>
      <span class="who__role" data-testid="identity-role">{identity.roleLine}{#if identity.endsSoon}<span class="who__ends" data-testid="identity-ends">Ends {identity.endsSoon.day}</span>{/if}</span>
    </span>
    <span class="who__arrow" aria-hidden="true"><Icon name="chevron-down" size={16} /></span>
  </button>

  {#if open}
    <section bind:this={panel} id={panelId} class="who__panel" aria-labelledby="your-access-title" data-testid="access-popover">
      <h2 id="your-access-title" tabindex="-1">Your access</h2>
      <p class="who__person"><strong>{identity.name}</strong><br /><span class="who__muted">Signed in with your Deloitte account</span></p>

      {#if identity.roles.length}
        <table class="who__roles">
          <thead><tr><th scope="col">Role</th><th scope="col">Covers</th><th scope="col">Until</th></tr></thead>
          <tbody>
            {#each identity.roles as role, index (index)}
              <tr><td>{role.role}</td><td>{role.covers}</td><td>{role.until}{#if role.endsSoon}<span class="who__ends who__ends--row">{role.endsSoon}</span>{/if}</td></tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p>{OWNER_BANNER}</p>
      {/if}

      <h3>What you can do</h3>
      <ul class="who__can" data-testid="access-can-do">
        {#each identity.canDo as line (line)}<li>{line}</li>{/each}
      </ul>

      <h3>Not available to you</h3>
      <p data-testid="access-not-available">{identity.notAvailable}</p>

      <p class="who__ask">Need a different role? Ask a Super admin.</p>
      <button class="btn" type="button" onclick={() => void copy()}>Copy my details</button>
      {#if copied}<p class="who__muted" role="status">{copied}</p>{/if}
    </section>
  {/if}
</div>

<style>
  .who {
    position: relative;
    min-width: 0;
  }

  .who__chip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: var(--target-min);
    max-width: 100%;
    padding: 0.15rem 0.6rem 0.15rem 0.25rem;
    border: 1px solid var(--adm-lime);
    border-radius: 999px;
    background: var(--adm-bar-black);
    color: var(--adm-on-deep);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .who__chip:hover {
    border-width: 2px;
    padding: calc(0.15rem - 1px) calc(0.6rem - 1px) calc(0.15rem - 1px) calc(0.25rem - 1px);
  }

  .who__chip:focus-visible {
    outline-offset: 2px;
    box-shadow: none;
  }

  .who__badge {
    display: grid;
    flex: none;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: var(--adm-lime);
    color: var(--adm-text);
    font-weight: var(--fw-bold);
  }

  .who__text {
    display: grid;
    min-width: 0;
    line-height: 1.2;
  }

  .who__name {
    overflow: hidden;
    font-weight: var(--fw-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who__role {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    white-space: nowrap;
  }

  /* "Ends 12 Dec": a word on a light fill, readable on the black bar and in the popover; never colour alone. */
  .who__ends {
    padding: 0 0.4rem;
    border-radius: 0.3rem;
    background: var(--adm-green-wash);
    color: var(--adm-text);
    font-weight: var(--fw-semibold);
  }

  .who__ends--row {
    margin-left: 0.4rem;
  }

  .who__arrow {
    display: inline-flex;
    flex: none;
  }

  .who__chip[aria-expanded='true'] .who__arrow {
    transform: rotate(180deg);
  }

  .who__panel {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    z-index: 20;
    width: min(26rem, calc(100vw - 2rem));
    max-height: calc(100vh - 5rem);
    overflow-y: auto;
    box-sizing: border-box;
    padding: 1rem 1.25rem 1.25rem;
    border: 1px solid var(--adm-card-line);
    border-radius: 0.75rem;
    background: var(--adm-card);
    color: var(--adm-text);
    box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--adm-text) 22%, transparent);
  }

  .who__panel h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
  }

  .who__panel h3 {
    margin: 1rem 0 0.25rem;
    font-size: 1rem;
  }

  .who__panel p {
    margin: 0 0 0.5rem;
  }

  .who__muted {
    color: var(--adm-text-muted);
  }

  .who__roles {
    width: 100%;
    border-collapse: collapse;
  }

  .who__roles th,
  .who__roles td {
    padding: 0.35rem 0.5rem 0.35rem 0;
    border-bottom: 1px solid var(--adm-card-line);
    text-align: left;
    vertical-align: top;
  }

  .who__can {
    margin: 0;
    padding-left: 1.25rem;
  }

  .who__ask {
    margin-top: 1rem !important;
  }

  /* Below 900 px: the initials and the role; the name is in the popover. The role never goes. */
  @media (max-width: 899px) {
    .who__name {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .who__chip,
    .who__badge,
    .who__ends {
      border: 1px solid CanvasText;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .who__chip[aria-expanded='true'] .who__arrow {
      transform: none;
    }
  }
</style>
