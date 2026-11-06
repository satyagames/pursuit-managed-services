<script lang="ts">
  // The body of Today's Controls card, inside AdminToday.svelte's section and under its heading: how people are identified, the activity flow,
  // the Animations switch, and End or Reopen, for the live session (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its
  // styles). Every write is AdminToday's: this draws the controls and hands each change back. Prompt 32: each setting is a segmented control (real
  // radios, styled), with the chosen option's one line under it; what AdminToday passes in (the participant link) comes before End session, which
  // stays in view while the rest scrolls inside the card on a laptop.
  import type { Snippet } from 'svelte';
  import { STAFF_MODE_WARNING, isStaffMode } from '../lib/admin/admin-today.js';
  import MotionSwitch from './MotionSwitch.svelte';

  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string; confidenceCheck?: boolean | null };
  type Client = { id: string; name: string; theme?: unknown };

  let { controlSession, controlClient, owner, live, controlsBusy, onSetMode, onSetFlow, onSetCheck, onEnd, onReopen, onMotionSaved, onToast, children }: {
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
    /** What goes under the controls, before End session (the participant link). */
    children?: Snippet;
  } = $props();

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
  <fieldset class="field" disabled={controlsBusy || controlSession.status === 'completed'}>
    <legend class="field__label">How people are identified</legend>
    <div class="seg">
      {#each modeChoices as choice (choice.id)}
        <label class="seg__option"><input type="radio" name="identification" checked={mode === choice.id} onchange={() => onSetMode(choice.id)} /><span>{choice.title}</span></label>
      {/each}
    </div>
    <p class="muted small seg__meaning" data-testid="mode-meaning">{hintOf(modeChoices, mode)}</p>
  </fieldset>
  {#if isStaffMode(controlSession) && controlSession.status !== 'completed'}
    <p class="notice" role="note" data-testid="staff-mode-warning">{STAFF_MODE_WARNING}</p>
  {/if}
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
  {#if controlClient}
    <MotionSwitch client={controlClient} compact onSaved={onMotionSaved} {onToast} />
  {/if}
  {@render children?.()}
  </div>
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

  .controls__body {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  /* A segmented control: the options side by side, each a real radio under its label (the label is the 44 px target), the chosen one filled. */
  .seg {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--adm-green);
    border-radius: 0.6rem;
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
    border-left: 1px solid var(--adm-green);
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
    background: var(--adm-deep);
    color: var(--adm-on-deep);
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

  /* On a laptop the card's body scrolls inside the sticky column; End session stays under it, in view. */
  @media (min-width: 1100px) {
    .controls__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      margin: -0.25rem;
      padding: 0.25rem;
    }

    .controls__end {
      flex: none;
      padding-top: 0.75rem;
      border-top: 1px solid var(--adm-line);
    }
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
