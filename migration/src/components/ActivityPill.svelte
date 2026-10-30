<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { ActivityState } from './types.js';

  let {
    label, state = 'ready', look = undefined, from = null, moment = null, answered = 0, total = 0, next = false,
    lockedCaption = 'Finish the previous activity', onlockedtap, onclick, ...rest
  }: Omit<HTMLButtonAttributes, 'children'> & {
    label: string;
    /** What the activity IS: what a tap does and what a screen reader hears. */
    state?: ActivityState;
    /** What is painted, when a moment on the hub still holds the old look for a few hundred ms (Prompt 24). The state otherwise. */
    look?: ActivityState;
    /** The look being cross-faded away, during a moment. */
    from?: ActivityState | null;
    /** The beat playing now; the CSS below animates it. */
    moment?: 'stamp' | 'unlock' | 'pulse' | 'wave' | 'shake' | 'fade' | null;
    answered?: number;
    total?: number;
    /** The first unfinished activity: "Up next". */
    next?: boolean;
    lockedCaption?: string;
    /** A tap on a locked pill: it does nothing else. */
    onlockedtap?: () => void;
  } = $props();

  const uid = $props.id();
  const captionId = `${uid}-why`;
  const locked = $derived(state === 'locked');
  const painted = $derived(look ?? state);
  const questions = (count: number) => `${count} ${count === 1 ? 'question' : 'questions'}`;
  const progressWords = $derived(`In progress · ${answered} of ${questions(total)}`);
  const readyWords = $derived(next && total > 0 ? `Up next · ${questions(total)}` : '');
  // The state is in the accessible name as well as in the words, the icon and the colour.
  const name = $derived(
    state === 'done' ? `${label}, done`
      : state === 'progress' ? `${label}, in progress, ${answered} of ${questions(total)}`
        : state === 'locked' ? `${label}, locked. ${lockedCaption}`
          : `${label}, ready`,
  );
  const share = $derived(total > 0 ? Math.min(1, answered / total) : 0);
  // A locked pill's title is white, as its caption and lock are (Phase 11a-3); it reads as locked by the client's --action, the closed padlock and the
  // caption. The done fill is the success green mixed into the page's near-black: dark enough for white on every client's colours and never their own
  // hue. The ring sits on its own near-black disc, so it has 3:1 whatever the client's colour (scripts/test-hub-look.js). The halo goes while the focus
  // ring is showing: a light band beside the ring would take it under 3:1 (contrast.spec.ts).
  // The padlock is two parts, so the shackle can open by itself. A change of colour is a layer of the old fill fading out, never an animated gradient.
</script>

<!-- A locked pill stays focusable (aria-disabled, not disabled) so a screen reader can find it
     and read the caption; it just does nothing when activated. -->
<button
  type="button"
  class="activity"
  data-state={painted}
  data-moment={moment ?? undefined}
  aria-label={name}
  aria-disabled={locked ? 'true' : undefined}
  aria-describedby={locked ? captionId : undefined}
  onclick={(event) => { if (locked) onlockedtap?.(); else onclick?.(event); }}
  {...rest}
>
  {#if moment === 'pulse'}<span class="rings"><i></i><i></i></span>{/if}
  {#if from || moment === 'unlock' || moment === 'wave'}
    <span class="layers">
      {#if from}<span class="old" data-from={from}></span>{/if}
      {#if moment === 'unlock'}<span class="sweep"></span>{/if}
      {#if moment === 'wave'}<span class="wave"></span>{/if}
    </span>
  {/if}
  <span class="text">
    <span class="label">{label}</span>
    {#if painted === 'locked'}<span class="caption" id={captionId}>{lockedCaption}</span>
    {:else if painted === 'done'}<span class="caption">Done</span>
    {:else if painted === 'progress'}<span class="caption">{progressWords}</span>
    {:else if painted === 'ready' && readyWords}<span class="caption">{readyWords}</span>{/if}
  </span>
  <span class="mark">
    {#if painted === 'done'}
      <span class="badge" data-hub-anchor><svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true" focusable="false"><path class="tick" pathLength="1" d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
      <span class="word">Done</span>
    {:else if painted === 'progress'}
      <span class="ring"><svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true" focusable="false"><circle class="track" cx="18" cy="18" r="13" fill="none" stroke-width="5" /><circle class="arc" cx="18" cy="18" r="13" fill="none" stroke-width="5" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - share} /></svg></span>
    {:else}
      <svg class="lock" data-hub-anchor viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
        <path class="shackle" d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path class="body" fill="currentColor" d="M7 10h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2m6 7.2a2 2 0 1 0-2 0V19h2z" />
      </svg>
      <span class="word">{painted === 'locked' ? 'Locked' : 'Ready'}</span>
    {/if}
  </span>
</button>

<style>
  /* The words and the icon share a row; with larger text or a narrow window the icon goes under the words rather than squeezing them (Phase 8). */
  .activity {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--pill-h);
    padding: 0.75rem clamp(0.75rem, 4vw, 1.5rem);
    color: var(--text);
    font: var(--fw-regular) var(--fs-option) / 1.3 var(--font-sans);
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--pill-radius);
    cursor: pointer;
    transition: transform var(--motion-duration-quick) var(--motion-ease-standard), background-color var(--motion-duration-quick) var(--motion-ease-standard);
  }

  .activity:active:not([aria-disabled='true']) {
    transform: scale(0.985);
  }

  .text {
    display: grid;
    flex: 1 1 10ch;
    gap: 0.15rem;
    min-width: 0;
  }

  .label {
    overflow-wrap: break-word;
  }

  .caption {
    overflow-wrap: break-word;
    color: var(--text);
    font-size: 1rem;
    font-weight: var(--fw-semibold);
  }

  .mark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
  }

  .word {
    font-size: 1rem;
    font-weight: var(--fw-semibold);
  }

  /* The four looks. */
  .activity[data-state='done'] {
    background: color-mix(in srgb, var(--success) 22%, var(--bg-top));
  }

  .activity[data-state='progress'] {
    box-shadow: inset 0.5rem 0 0 var(--progress);
  }

  .activity[data-state='ready'] {
    box-shadow: 0 0 0 0.3rem color-mix(in srgb, var(--surface-border) 16%, transparent);
  }

  .activity[data-state='ready']:focus-visible {
    box-shadow: none;
  }

  .activity[data-state='locked'] {
    color: var(--text);
    background: var(--action);
    border-color: var(--action-border);
    cursor: not-allowed;
  }

  .activity[data-state='locked'] .label {
    color: var(--text);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    color: var(--on-success);
    background: var(--success);
    border-radius: 50%;
  }

  .ring {
    display: inline-block;
    box-sizing: border-box;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0.1rem;
    background: var(--bg-top);
    border-radius: 50%;
  }

  .ring .track { stroke: rgb(255 255 255 / 0.3); }
  .ring .arc {
    stroke: var(--progress);
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
  }

  .lock {
    color: var(--text);
    overflow: visible;
  }

  .shackle {
    transform-box: view-box;
    transform-origin: 16px 11px;
  }

  .activity[data-state='ready'] .shackle {
    transform: translateY(-3px) rotate(25deg);
  }

  /* The moment. Movement is transform and opacity only, except the check, which draws. Nothing loops. */
  .layers {
    position: absolute;
    inset: -1px;
    z-index: -1;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }

  .old, .sweep, .wave {
    position: absolute;
    inset: 0;
  }

  .old[data-from='locked'] { background: var(--action); }
  .old[data-from='progress'], .old[data-from='ready'] { background: var(--bg-mid); }
  .old[data-from='done'] { background: color-mix(in srgb, var(--success) 22%, var(--bg-top)); }

  [data-moment='stamp'] .old, [data-moment='unlock'] .old {
    opacity: 0;
    animation: pill-old var(--motion-hub-crossfade) var(--motion-ease-standard) backwards;
  }

  [data-moment='fade'] .old {
    opacity: 0;
    animation: pill-old var(--motion-hub-fade) var(--motion-ease-standard) backwards;
  }

  [data-moment='stamp'] .badge {
    animation: pill-badge var(--motion-hub-crossfade) var(--motion-ease-pop) backwards;
  }

  [data-moment='stamp'] .tick {
    animation: pill-tick var(--motion-hub-crossfade) var(--motion-ease-enter) backwards;
    stroke-dasharray: 1;
  }

  [data-moment='unlock'] .shackle {
    animation: pill-shackle var(--motion-hub-shackle) var(--motion-ease-pop) backwards;
  }

  .sweep {
    width: 30%;
    background: rgb(255 255 255 / 0.28);
    opacity: 0;
    animation: pill-sweep var(--motion-hub-sweep) var(--motion-ease-standard) backwards;
  }

  .wave {
    background: var(--success);
    opacity: 0;
    animation: pill-wave var(--motion-duration-base) var(--motion-ease-standard) backwards;
  }

  .rings {
    position: absolute;
    inset: -1px;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
  }

  .rings i {
    position: absolute;
    inset: 0;
    border: 2px solid var(--surface-border);
    border-radius: inherit;
    opacity: 0;
    animation: pill-ring calc(var(--motion-hub-pulse) / 2) var(--motion-ease-standard) backwards;
  }

  .rings i + i { animation-delay: calc(var(--motion-hub-pulse) / 2); }

  [data-moment='shake'] {
    animation: pill-shake var(--motion-hub-shake) var(--motion-ease-standard);
  }

  [data-moment='shake'] .shackle {
    animation: pill-rattle var(--motion-hub-shake) var(--motion-ease-standard);
  }

  [data-moment='shake'] .caption {
    font-weight: var(--fw-bold, 700);
  }

  @keyframes pill-old { from { opacity: 1; } }
  @keyframes pill-badge { from { transform: scale(0.4); } }
  @keyframes pill-tick { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
  @keyframes pill-shackle { from { transform: none; } }
  @keyframes pill-sweep { from { opacity: 1; transform: translateX(-100%); } to { opacity: 1; transform: translateX(340%); } }
  @keyframes pill-wave { from { opacity: 0; } 40% { opacity: 0.32; } to { opacity: 0; } }
  @keyframes pill-ring { from { opacity: 0.7; transform: scale(1); } to { opacity: 0; transform: scale(1.04, 1.18); } }
  @keyframes pill-shake {
    17% { transform: translateX(-4px); }
    33% { transform: translateX(4px); }
    50% { transform: translateX(-4px); }
    67% { transform: translateX(4px); }
    83% { transform: translateX(-4px); }
  }
  @keyframes pill-rattle {
    25% { transform: rotate(-8deg); }
    50% { transform: rotate(8deg); }
    75% { transform: rotate(-8deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .activity { transition: none; }
    .activity:active:not([aria-disabled='true']) { transform: none; }
    .activity, .activity * { animation: none !important; }
  }
</style>
