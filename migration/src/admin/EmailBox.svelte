<script lang="ts">
  // "Email them about this" (Prompt 28, Part 2): the one box a screen that changes a person's access offers. Unticked every time the screen opens, and
  // nothing remembers or stores it; the addresses are shown, never asked for (the person's from People, the sender's from their sign-in). Quiet: no
  // pop-up, no nag. Hidden for anyone who cannot give a role. Ticked, the screen shows EmailPanel.svelte after its change has saved.
  import { can } from '../lib/access/can.js';

  let { access, email, checked = $bindable(false), disabled = false }: { access: any; email: string; checked?: boolean; disabled?: boolean } = $props();

  const may = $derived(can(access, 'team.assign', {}));
  const id = `email-box-${Math.random().toString(36).slice(2, 8)}`;
  const mine = $derived(access?.person?.email ?? '');
</script>

{#if may}
  <div class="email-box" data-testid="email-box">
    <label class="email-box__check"><input type="checkbox" bind:checked {disabled} aria-describedby={id} /> Email them about this</label>
    <span id={id} class="muted small">{email ? `To: ${email}.${mine ? ' A copy comes to you.' : ''}` : 'To: the person you choose.'}</span>
  </div>
{/if}

<style>
  .email-box {
    display: grid;
    gap: 0.1rem;
  }

  .email-box__check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }

  .email-box__check input {
    width: 1.25rem;
    height: 1.25rem;
  }
</style>
