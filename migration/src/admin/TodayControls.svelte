<script lang="ts">
  // The body of Today's Controls card, inside AdminToday.svelte's section and under its heading: how people are identified, the activity flow,
  // the Animations switch, and End or Reopen, for the live session (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its
  // styles). Every write is AdminToday's: this draws the controls and hands each change back. Prompt 32: each setting is a segmented control (real
  // radios, styled), with the chosen option's one line under it; End stays here, never in the bar. Prompt 43: the three settings are three chips
  // (icon first, a short word; lib/admin/today-view.js settingsChips) and a Change / Hide disclosure toggle that keeps its place and width while its
  // chevron turns; the panel below has a green edge, the three segmented controls and a footer that says changes save automatically. A chip opens
  // the panel at its group. The staff-mode notice is under Identification in the open panel, and a marker on its chip when folded. A person who
  // may not run the session (events.run) sees the chips only.
  import { tick } from 'svelte';
  import { motionLevel } from '../lib/motion/motion.js';
  import { settingsChips, staffNotice } from '../lib/admin/today-view.js';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import MotionSwitch from './MotionSwitch.svelte';

  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string; confidenceCheck?: boolean | null };
  type Client = { id: string; name: string; theme?: unknown };
  type Group = 'mode' | 'flow' | 'check';

  let {
    controlSession, controlClient, owner, live, controlsBusy, mayChange = true, saveError = '', foldSignal = 0,
    onSetMode, onSetFlow, onSetCheck, onRetry = () => {}, onEnd, onReopen, onMotionSaved, onToast,
  }: {
    controlSession: Session | null;
    /** The live session's client, for the Animations switch. */
    controlClient: Client | null;
    /** The name of the controlled session's client. */
    owner: string;
    live: boolean;
    controlsBusy: boolean;
    /** May this person change the session's settings (events.run)? Without it: the chips, and no toggle. */
    mayChange?: boolean;
    /** The last setting that could not be written, in its own words; '' when the last write went through. */
    saveError?: string;
    /** Changes when Go live or End session folds the panel. */
    foldSignal?: number;
    onSetMode: (mode: 'client-visit' | 'staff') => void;
    onSetFlow: (flow: string) => void;
    /** Phase 20: the session's confidence check, on or off. */
    onSetCheck: (on: boolean) => void;
    /** Writes the setting that failed again. */
    onRetry?: () => void;
    onEnd: (session: Session) => void;
    onReopen: (session: Session) => void;
    onMotionSaved: (written: { id: string; theme?: unknown }) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  /** The panel is open (this visit of the tab only; folded by default, and after Go live and End session). */
  let open = $state(false);
  /** Motion was at its full level when the panel last moved; else it opens, closes and turns at once (calm, off, the device's reduced motion). */
  let moving = $state(false);
  let toggle = $state<HTMLButtonElement | null>(null);
  let panel = $state<HTMLElement | null>(null);

  const chips = $derived(settingsChips(controlSession));
  const notice = $derived(staffNotice(controlSession));
  const ended = $derived(controlSession?.status === 'completed');
  /** The three groups of the panel, in the chips' order: each a segmented control of two, and the chosen option's one line under it. */
  const groups = $derived([
    {
      id: 'mode', label: 'How people are identified', name: 'identification',
      value: controlSession?.participationMode === 'client-visit' ? 'client-visit' : 'staff',
      set: (id: string) => onSetMode(id as 'client-visit' | 'staff'),
      choices: [
        { id: 'client-visit', title: 'Guests scan a personal QR', hint: 'Each guest has a single-use code (Guests and QR).' },
        { id: 'staff', title: 'Staff sign in', hint: 'Greeted by their signed-in SharePoint name.' },
      ],
    },
    {
      id: 'flow', label: 'Activity flow', name: 'flow', value: controlSession?.activityFlow ?? 'sequential', set: onSetFlow,
      choices: [
        { id: 'sequential', title: 'Sequential', hint: 'Each activity unlocks when the one before it is finished.' },
        { id: 'open', title: 'Open', hint: 'Every activity is open from the start, in any order.' },
      ],
    },
    {
      id: 'check', label: 'Confidence check', name: 'confidence', value: controlSession?.confidenceCheck === true ? 'on' : 'off',
      set: (id: string) => onSetCheck(id === 'on'),
      choices: [
        { id: 'off', title: 'Off', hint: 'Not asked in this session.' },
        { id: 'on', title: 'On', hint: 'Ask it before the first activity and after the last. Needs a confidence check in Content.' },
      ],
    },
  ]);

  // Go live and End session fold the panel (the first run is the mount, folded already).
  $effect(() => {
    void foldSignal;
    open = false;
  });

  function setOpen(next: boolean) {
    moving = motionLevel() === 'full';
    open = next;
  }

  /** A chip opens the panel (it never folds it) and puts the focus on its group's first control. */
  async function openAt(group: Group) {
    if (!open) setOpen(true);
    await tick();
    const where = panel?.querySelector<HTMLElement>(`[data-group="${group}"]`);
    where?.querySelector('input')?.focus({ preventScroll: true });
    where?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    toggle?.focus();
  }

  /** Each radio shows what is saved: after a write that failed, or a change the confirm step turned down, the chosen one goes back. */
  function resync() {
    for (const input of panel?.querySelectorAll<HTMLInputElement>('input') ?? []) input.checked = input.dataset.saved === 'true';
  }

  /** A choice: AdminToday writes it (and is busy until it is written); one it did not start (a confirm said no) is put back at once. */
  function choose(write: () => void) {
    write();
    if (!controlsBusy) resync();
  }

  // A write has ended (written or failed): the radios show what is saved.
  $effect(() => {
    if (!controlsBusy) resync();
  });

  /** Inside a segmented control the arrows move the focus and Space or Enter chooses (a native radio would choose, and write, on every arrow). */
  function onSegKey(event: KeyboardEvent) {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (back || event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const all = [...(input.closest('.seg')?.querySelectorAll('input') ?? [])];
      all[(all.indexOf(input) + (back ? -1 : 1) + all.length) % all.length]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!input.checked) input.click();
    }
  }
</script>

{#if !controlSession}
  <p class="muted">Go live first. These apply to the live session.</p>
{:else}
  <div class="controls__body">
  <p class="muted small">For {owner}, {controlSession.date ?? 'undated'}{live ? '' : ' (not live)'}.</p>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div onkeydown={onKey}>
    <div class="settings__row">
      <div class="settings__chips" data-testid="controls-summary">
        {#each chips as chip, index (chip.group)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <svelte:element
            this={mayChange ? 'button' : 'span'} class="chip" class:chip--primary={chip.changed}
            type={mayChange ? 'button' : undefined} data-chip={chip.group} title={chip.warning || undefined}
            aria-label={mayChange ? `${chip.text}${chip.warning ? `. ${chip.warning}` : ''}, ${groups[index].label}` : undefined}
            onclick={mayChange ? () => void openAt(chip.group) : undefined}
          ><Icon name={chip.icon as IconName} size={16} /><span>{chip.text}</span>{#if chip.warning}<span
              class="chip__mark" data-testid="staff-mode-marker" role={mayChange ? undefined : 'img'} aria-label={mayChange ? undefined : chip.warning}
            ><Icon name="alert-triangle" size={16} /></span>{/if}</svelte:element>
        {/each}
      </div>
      {#if mayChange}
        <button
          class="settings__link settings__toggle" class:settings__toggle--moving={moving} type="button" bind:this={toggle} data-testid="settings-toggle"
          aria-expanded={open} aria-controls="today-settings" onclick={() => setOpen(!open)}
        ><span class="toggle__words"><span class:toggle__word--off={open}>Change</span><span class:toggle__word--off={!open}>Hide</span></span><span class="toggle__chevron" class:toggle__chevron--up={open}><Icon name="chevron-down" size={14} /></span></button>
      {/if}
    </div>
    {#if mayChange}
      <div class="settings__fold" class:settings__fold--open={open} class:settings__fold--moving={moving}>
        <div class="settings__clip">
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div id="today-settings" class="settings__panel" role="group" aria-labelledby="controls-heading" bind:this={panel} onkeydown={onSegKey}>
            {#each groups as group (group.id)}
              <fieldset class="field" data-group={group.id} disabled={controlsBusy || ended}>
                <legend class="field__label">{group.label}</legend>
                <div class="seg">
                  {#each group.choices as choice (choice.id)}
                    <label class="seg__option"><input type="radio" name={group.name} checked={group.value === choice.id} data-saved={group.value === choice.id} onchange={() => choose(() => group.set(choice.id))} /><Icon name="check" size={16} />{choice.title}</label>
                  {/each}
                </div>
                <p class="muted small" data-testid="{group.id}-meaning">{group.choices.find((choice) => choice.id === group.value)?.hint}</p>
                {#if group.id === 'mode' && notice && open}<p class="adm-message adm-message--warn" role="note" data-testid="staff-mode-warning"><Icon name="alert-triangle" size={16} /><span>{notice}</span></p>{/if}
              </fieldset>
            {/each}
            <p class="settings__foot small" aria-live="polite" data-testid="settings-foot" data-state={saveError ? 'error' : controlsBusy ? 'saving' : 'saved'}>
              {#if saveError}
                <span class="settings__error"><Icon name="alert-triangle" size={16} />{saveError}</span>
                <button class="settings__link" type="button" onclick={onRetry} disabled={controlsBusy}>Retry</button>
              {:else if controlsBusy}
                Saving…
              {:else}
                <Icon name="check-circle" size={16} />Changes save automatically
              {/if}
            </p>
          </div>
        </div>
      </div>
    {/if}
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

  .controls__body {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  /* Prompt 43: the chips and the toggle on one line. When the chips do not fit beside it they go under it together (wrap-reverse puts the line
     that wrapped, the toggle's, on top), and the toggle keeps its place at the top right. */
  .settings__row {
    display: flex;
    flex-wrap: wrap-reverse;
    align-items: center;
    gap: var(--adm-s2);
  }

  .settings__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  /* A chip (admin-look.css .chip: surface-2 and a 1 px line; .chip--primary, the wash, for a value changed from the default), in ink, small. */
  .chip {
    gap: 3px;
    min-height: 44px;
    padding: 0 5px;
    font-size: 0.75rem;
    color: var(--adm-ink);
    border: 0;
  }

  button.chip {
    font-family: inherit;
    cursor: pointer;
  }

  button.chip:hover {
    box-shadow: inset 0 0 0 1px var(--adm-primary);
  }

  .chip__mark {
    color: var(--adm-warn-ink);
  }

  .chip__mark,
  /* The disclosure toggle (and Retry): words in the primary's shade, no border, a wash on hover. Open or folded the toggle keeps its place and
     width (both words share one cell, and the one not shown keeps its room); only the word changes, and the chevron turns. */
  .settings__link {
    display: inline-flex;
    align-items: center;
    gap: var(--adm-s1);
    min-height: 44px;
    padding: 0 var(--adm-s2);
    font: inherit;
    font-size: 0.875rem;
    font-weight: var(--fw-semibold);
    color: var(--adm-primary-deep);
    background: none;
    border: 0;
    border-radius: var(--adm-radius-bar);
    cursor: pointer;
  }

  .settings__link:hover {
    background: var(--adm-primary-wash);
  }

  .settings__toggle {
    margin-left: auto;
  }

  .toggle__words {
    display: inline-grid;
    text-align: right;
  }

  .toggle__words > span {
    grid-area: 1 / 1;
  }

  .toggle__word--off {
    visibility: hidden;
  }

  .toggle__chevron {
    display: flex;
  }

  .toggle__chevron--up {
    transform: rotate(180deg);
  }

  .settings__toggle--moving .toggle__chevron {
    transition: transform var(--motion-duration-quick) ease;
  }

  /* The panel opens by its height (grid rows 0fr to 1fr), 200 ms at full motion, at once at calm or off (motionLevel). Folded, it is out of the
     tab order and of the accessibility tree (visibility): visible from the first frame of opening, so a chip can put the focus in it at once,
     and hidden only once its height has gone on folding. */
  .settings__fold {
    display: grid;
    grid-template-rows: 0fr;
    visibility: hidden;
  }

  .settings__fold--open {
    grid-template-rows: 1fr;
    visibility: visible;
  }

  .settings__fold--moving {
    transition: grid-template-rows 200ms ease, visibility 0s 200ms;
  }

  .settings__fold--moving.settings__fold--open {
    transition-delay: 0s;
  }

  .settings__clip {
    min-height: 0;
    overflow: hidden;
  }

  .settings__panel {
    display: grid;
    gap: var(--adm-s4);
    margin-top: var(--adm-s3);
    padding: var(--adm-s4);
    background: color-mix(in srgb, var(--adm-primary-wash) 40%, var(--adm-surface));
    border-left: 3px solid var(--adm-primary);
    border-radius: 12px;
  }

  fieldset {
    display: grid;
    gap: var(--adm-s2);
    min-width: 0;
  }

  .field__label {
    padding: 0 0 var(--adm-s2);
    font-size: 0.75rem;
    letter-spacing: 0.02em;
  }

  /* A segmented control: equal segments, 40 px high, each a real radio under its label. The chosen one is filled primary with white words and
     a tick, so it is never told by colour alone. */
  .seg {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    border: 1px solid var(--adm-line-strong);
    border-radius: var(--adm-radius-sm);
    overflow: hidden;
  }

  .seg__option {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--adm-s1);
    min-height: 40px;
    padding: var(--adm-s1) var(--adm-s2);
    background: var(--adm-surface);
    color: var(--adm-ink);
    font-size: 0.875rem;
    font-weight: var(--fw-semibold);
    text-align: center;
    cursor: pointer;
  }

  /* (The tick is drawn on the chosen option only.) */
  .seg__option:not(:has(:checked)) > :global(.icon) {
    display: none;
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

  .seg__option:has(:checked) {
    background: var(--adm-primary);
    color: var(--adm-on-primary);
  }

  .seg__option:has(:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: -4px;
  }

  fieldset .muted,
  .settings__foot {
    margin: 0;
  }

  @media (forced-colors: active) {
    .seg__option:has(:checked) {
      outline: 2px solid Highlight;
      outline-offset: -4px;
    }
  }

  fieldset:disabled {
    opacity: 0.6;
  }

  .settings__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--adm-muted);
  }

  .settings__foot > :global(.icon) {
    color: var(--adm-primary);
  }

  .settings__error {
    display: flex;
    gap: 6px;
    color: var(--adm-danger);
  }
</style>
