<script lang="ts">
  // The welcome strip (Prompt 32, step 2; board 19): the first time a person opens the page after a role is given or changed, a thin line under the
  // bar says who they are signed in as, with "What can I do?" (the access popover) and "Got it". It comes back only when the roles change
  // (identity.rolesKey). The "seen" mark is this browser's convenience, never SharePoint's: localStorage under identity.seenKey (a hash of the
  // person, never their name or email), each read and write in try/catch; where storage is blocked it shows once for this tab and stops.
  type Identity = ReturnType<typeof import('../lib/access/identity-words.js').identityOf>;
  let { identity, onWhat }: { identity: Identity; onWhat: () => void } = $props();

  /** The roles already welcomed in this tab: what stops it where storage is blocked. */
  const seenHere = new Set<string>();
  let shown = $state(false);

  const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
  const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* blocked: this tab remembers it */ } };

  $effect(() => {
    const { chip, rolesKey, seenKey } = identity;
    if (!chip || !rolesKey) { shown = false; return; }
    const mark = `${seenKey}|${rolesKey}`;
    if (seenHere.has(mark)) return;
    seenHere.add(mark);
    shown = read(seenKey) !== rolesKey;
    if (shown) write(seenKey, rolesKey);
  });
</script>

{#if shown}
  <div class="welcome" role="status" data-testid="welcome-strip">
    <p>{identity.welcome}</p>
    <div class="welcome__actions">
      <button class="btn" type="button" onclick={() => onWhat()}>What can I do?</button>
      <button class="btn" type="button" onclick={() => { shown = false; }}>Got it</button>
    </div>
  </div>
{/if}

<style>
  .welcome {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.25rem var(--shell-gutter, 1rem);
    border-bottom: 1px solid var(--adm-card-line);
    background: var(--adm-green-wash);
    color: var(--adm-text);
  }

  .welcome p {
    flex: 1 1 20rem;
    margin: 0;
    font-weight: var(--fw-semibold);
  }

  .welcome__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  @media (forced-colors: active) {
    .welcome {
      border: 1px solid CanvasText;
    }
  }
</style>
