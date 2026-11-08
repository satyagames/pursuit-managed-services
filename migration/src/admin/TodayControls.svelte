<script lang="ts">
  // The body of Today's Controls card, inside AdminToday.svelte's section and under its heading: how people are identified, the activity flow,
  // the Animations switch, and End or Reopen, for the live session (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its
  // styles). Every write is AdminToday's: this draws the controls and hands each change back. Prompt 32: each setting is a segmented control (real
  // radios, styled), with the chosen option's one line under it; what AdminToday passes in (the participant link) comes before End session, which
  // stays in view while the rest scrolls inside the card on a laptop. Prompt 38: the three settings are one line of what they are now ("Guests scan a
  // personal QR · Sequential · Confidence check off") with Change, which opens the controls; Share is its own card; End stays here, never in the bar.
  import { STAFF_MODE_WARNING, isStaffMode } from '../lib/admin/admin-today.js';
  import { controlsSummary } from '../lib/admin/today-view.js';
  import Icon from './Icon.svelte';
  import MotionSwitch from './MotionSwitch.svelte';

  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string; confidenceCheck?: boolean | null };
  type Client = { id: string; name: string; theme?: unknown };

  let { controlSession, controlClient, owner, live, controlsBusy, onSetMode, onSetFlow, onSetCheck, onEnd, onReopen, onMotionSaved, onToast }: {
    controlSession: Session | null;
    /** The live session's client, for the Animations switch. */
    controlClient: Client | null;
    /** The name of the controlled session's client. */
    owner: string;
    live: boolean;
    controlsBusy: boolean;
    onSetMode: (mode: 'client-visit' | 'staff') => void;
    onSetFlow: (flow: string) => void;
    /** Phase 20: the session's confidence check, on or off. */
    onSetCheck: (on: boolean) => void;
    onEnd: (session: Session) => void;
    onReopen: (session: Session) => void;
    onMotionSaved: (written: { id: string; theme?: unknown }) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let changing = $state(false);

  const flowChoices = [
    { id: 'sequential', title: 'Sequential', hint: 'Each activity unlocks when the one before it is finished.' },
    { id: 'open', title: 'Open', hint: 'Every activity is open from the start, in any order.' },
  ];
  const modeChoices = [
    { id: 'client-visit', title: 'Guests scan a personal QR', hint: 'Each guest has a single-use code (Guests and QR).' },
    { id: 'staff', title: 'Staff sign in', hint: 'Greeted by their signed-in SharePoint name.' },
  ] as const;
  const checkChoices = [
    { id: 'off', title: 'Off', hint: 'Not asked in this session.' },
    { id: 'on', title: 'On', hint: 'Ask it before the first activity and after the last. Needs a confidence check in Content.' },
  ] as const;
  const mode = $derived(controlSession?.participationMode === 'client-visit' ? 'client-visit' : 'staff');
  const flow = $derived(controlSession?.activityFlow ?? 'sequential');
  const check = $derived(controlSession?.confidenceCheck === true ? 'on' : 'off');
  const hintOf = (choices: readonly { id: string; hint: string }[], id: string) => choices.find((choice) => choice.id === id)?.hint ?? '';
</script>

{#if !controlSession}
  <p class="muted">Go live first. These apply to the live session.</p>
{:else}
  <div class="controls__body">
  <p class="muted small">For {owner}, {controlSession.date ?? 'undated'}{live ? '' : ' (not live)'}.</p>
  <div class="controls__summary">
    <p data-testid="controls-summary">{controlsSummary(controlSession)}</p>
    <button class="btn btn--small btn--with-icon" type="button" aria-expanded={changing} aria-controls="today-settings" onclick={() => { changing = !changing; }}>
      <Icon name={changing ? 'chevron-down' : 'sliders'} />{changing ? 'Done' : 'Change'}
    </button>
  </div>
  {#if isStaffMode(controlSession) && controlSession.status !== 'completed'}
    <p class="notice" role="note" data-testid="staff-mode-warning">{STAFF_MODE_WARNING}</p>
  {/if}
  <div id="today-settings" class="controls__change" class:controls__change--folded={!changing}>
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">How people are identified</legend>
    <div class="seg">
      {#each modeChoices as choice (choice.id)}
        <label class="seg__option"><input type="radio" name="identification" checked={mode === choice.id} onchange={() => onSetMode(choice.id)} /><span>{choice.title}</span></label>
      {/each}
    </div>
    <p class="muted small seg__meaning" data-testid="mode-meaning">{hintOf(modeChoices, mode)}</p>
  </fieldset>
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">Activity flow</legend>
    <div class="seg">
      {#each flowChoices as choice (choice.id)}
        <label class="seg__option"><input type="radio" name="flow" checked={flow === choice.id} onchange={() => onSetFlow(choice.id)} /><span>{choice.title}</span></label>
      {/each}
    </div>
    <p class="muted small seg__meaning" data-testid="flow-meaning">{hintOf(flowChoices, flow)}</p>
  </fieldset>
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">Confidence check</legend>
    <div class="seg">
      {#each checkChoices as choice (choice.id)}
        <label class="seg__option"><input type="radio" name="confidence" checked={check === choice.id} onchange={() => onSetCheck(choice.id === 'on')} /><span>{choice.title}</span></label>
      {/each}
    </div>
    <p class="muted small seg__meaning" data-testid="check-meaning">{hintOf(checkChoices, check)}</p>
  </fieldset>
  </div>
  {#if controlClient}
    <MotionSwitch client={controlClient} compact onSaved={onMotionSaved} {onToast} />
  {/if}
  </div>
  <div class="controls__end">
    {#if controlSession.status === 'completed'}
      <button class="btn btn--with-icon" type="button" onclick={() => onReopen(controlSession)} disabled={controlsBusy}><Icon name="refresh" />Reopen session</button>
    {:else}
      <button class="btn btn--danger btn--with-icon" type="button" onclick={() => onEnd(controlSession)} disabled={controlsBusy}><Icon name="stop" />End session</button>
    {/if}
  </div>
{/if}

<style>
  .controls__end {
    display: flex;
    gap: var(--adm-s2);
    padding-top: var(--adm-s4);
    border-top: 1px solid var(--adm-line);
  }

  .controls__summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--adm-s3);
    padding: var(--adm-s3) var(--adm-s4);
    border-radius: var(--adm-radius-sm);
    background: var(--adm-surface-2);
  }

  .controls__summary p {
    flex: 1 1 12rem;
    margin: 0;
    font-weight: var(--fw-semibold);
  }

  .controls__change {
    display: grid;
    gap: var(--adm-s4);
  }

  .controls__change--folded {
    display: none;
  }

  fieldset.field {
    display: grid;
    gap: 0.5rem;
    min-width: 0;
  }

  .controls__body {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  /* A segmented control: the options side by side, each a real radio under its label (the label is the 44 px target), the chosen one filled. */
  .seg {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--adm-line-strong);
    border-radius: var(--adm-radius-sm);
    overflow: hidden;
  }

  .seg__option {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    min-height: var(--target-min);
    padding: 0.25rem 0.75rem;
    background: var(--adm-card);
    color: var(--adm-text);
    font-weight: var(--fw-semibold);
    text-align: center;
    cursor: pointer;
  }

  .seg__option + .seg__option {
    border-left: 1px solid var(--adm-line-strong);
  }

  .seg__option input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .seg__option:has(input:checked) {
    background: var(--adm-primary-wash);
    color: var(--adm-primary-deep);
    box-shadow: inset 0 0 0 1px var(--adm-primary);
  }

  /* The chosen option is also marked by a tick, so it is never told by colour alone. */
  .seg__option:has(input:checked) span::before {
    content: '\2713\00a0';
  }

  .seg__option:has(input:focus-visible) {
    outline: 3px solid var(--focus);
    outline-offset: -3px;
  }

  .seg__meaning {
    margin: 0;
  }

  @media (forced-colors: active) {
    .seg__option:has(input:checked) {
      outline: 2px solid Highlight;
      outline-offset: -4px;
    }
  }

  fieldset.field:disabled {
    opacity: 0.6;
  }

  .notice {
    display: grid;
    justify-items: start;
    gap: 0.4rem;
    margin: 0;
    padding: var(--adm-s3) var(--adm-s4);
    color: var(--adm-ink);
    background: var(--adm-warn-wash);
    border-radius: var(--adm-radius-sm);
  }
</style>
