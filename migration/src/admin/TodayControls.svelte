<script lang="ts">
  // The body of Today's Controls card, inside AdminToday.svelte's section and under its heading: how people are identified, the activity flow,
  // the Animations switch, and End or Reopen, for the live session (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its
  // styles). Every write is AdminToday's: this draws the controls and hands each change back.
  import { STAFF_MODE_WARNING, isStaffMode } from '../lib/admin/admin-today.js';
  import MotionSwitch from './MotionSwitch.svelte';

  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string };
  type Client = { id: string; name: string; theme?: unknown };

  let { controlSession, controlClient, owner, live, controlsBusy, onSetMode, onSetFlow, onEnd, onReopen, onMotionSaved, onToast }: {
    controlSession: Session | null;
    /** The live session's client, for the Animations switch. */
    controlClient: Client | null;
    /** The name of the controlled session's client. */
    owner: string;
    live: boolean;
    controlsBusy: boolean;
    onSetMode: (mode: 'client-visit' | 'staff') => void;
    onSetFlow: (flow: string) => void;
    onEnd: (session: Session) => void;
    onReopen: (session: Session) => void;
    onMotionSaved: (written: { id: string; theme?: unknown }) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  const flowChoices = [
    { id: 'sequential', title: 'Sequential', hint: 'Each activity unlocks when the one before it is finished.' },
    { id: 'open', title: 'Open', hint: 'Every activity is open from the start, in any order.' },
  ];
</script>

{#if !controlSession}
  <p class="muted">Go live first. These apply to the live session.</p>
{:else}
  <p class="muted small">For {owner}, {controlSession.date ?? 'undated'}{live ? '' : ' (not live)'}.</p>
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">How people are identified</legend>
    <label class="choice"><input type="radio" name="identification" checked={controlSession.participationMode === 'client-visit'} onchange={() => onSetMode('client-visit')} /><span>Guests scan a personal QR</span><span class="muted small">Each guest has a single-use code (Guests and QR).</span></label>
    <label class="choice"><input type="radio" name="identification" checked={controlSession.participationMode !== 'client-visit'} onchange={() => onSetMode('staff')} /><span>Staff sign in</span><span class="muted small">Greeted by their signed-in SharePoint name.</span></label>
  </fieldset>
  {#if isStaffMode(controlSession) && controlSession.status !== 'completed'}
    <p class="notice" role="note" data-testid="staff-mode-warning">{STAFF_MODE_WARNING}</p>
  {/if}
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">Activity flow</legend>
    {#each flowChoices as flow (flow.id)}
      <label class="choice"><input type="radio" name="flow" checked={(controlSession.activityFlow ?? 'sequential') === flow.id} onchange={() => onSetFlow(flow.id)} /><span>{flow.title}</span><span class="muted small">{flow.hint}</span></label>
    {/each}
  </fieldset>
  {#if controlClient}
    <MotionSwitch client={controlClient} compact onSaved={onMotionSaved} {onToast} />
  {/if}
  <div class="controls__end">
    {#if controlSession.status === 'completed'}
      <button class="btn" type="button" onclick={() => onReopen(controlSession)} disabled={controlsBusy}>Reopen session</button>
    {:else}
      <button class="btn btn--danger" type="button" onclick={() => onEnd(controlSession)} disabled={controlsBusy}>End session</button>
    {/if}
  </div>
{/if}

<style>
  .controls__end {
    display: flex;
    gap: 0.6rem;
  }

  fieldset.field {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  /* An option and its one-line hint: the radio beside both, the hint under the name. */
  .choice {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr);
    column-gap: 0.75rem;
    row-gap: 0.1rem;
    align-items: start;
  }

  .choice input {
    grid-row: 1 / span 2;
    margin: 0.15rem 0 0;
  }

  .choice span:nth-of-type(2) {
    grid-column: 2;
  }

  fieldset.field:disabled {
    opacity: 0.6;
  }

  .notice {
    display: grid;
    justify-items: start;
    gap: 0.4rem;
    padding: 1rem 1.25rem;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border-radius: 0.9rem;
  }
</style>
