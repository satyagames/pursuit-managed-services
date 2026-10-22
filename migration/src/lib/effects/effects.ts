/**
 * The one door to sound and confetti. Screens announce what happened (`answerFeedback`, `pick`,
 * `activityComplete`, `finale`) and never name a sound or a burst; the rules for which moment makes
 * which cue and which confetti live in effect-plan.js, the sounds in sound-cues.js, and only this file
 * talks to Web Audio (sound-engine.ts) and canvas-confetti (confetti.ts). scripts/test-effects.js fails
 * if any other file under migration/src does.
 *
 * Sound is OFF until the person turns it on (or Phase 5 sets a per-session default with
 * `setSoundDefault`). Their choice is kept in localStorage under `pms.sound`. The AudioContext is made
 * or resumed only inside a tap: the switch, "Click here to begin", or the next tap while sound is on.
 * Confetti does not depend on sound, and `prefers-reduced-motion` switches it off altogether.
 *
 * Next, Back, Home and "Click here to begin" make no sound.
 */
import { CONFETTI_SIZES, type ConfettiSize } from './confetti-plan.js';
import { celebrate, clearConfetti } from './confetti.js';
import { EFFECTS, UNAVAILABLE_TITLE, answerEffect, readChoice, soundIsOn, writeChoice, type Effect } from './effect-plan.js';
import { CUES, CUE_NAMES, type CueName } from './sound-cues.js';
import * as engine from './sound-engine.js';
import { motionLevel } from '../motion/motion.js';

export { UNAVAILABLE_TITLE };
export type { ConfettiSize, CueName };

// ---- Sound state ------------------------------------------------------------------------------------

interface SoundState {
  /** Sound is on right now. */
  on: boolean;
  /** This browser can make sound. False disables the switch. */
  available: boolean;
}

let defaultOn = false;
let choice: boolean | null = null;
let loaded = false;
let failedAtRuntime = false; // the AudioContext constructor threw
let started = false;
const listeners = new Set<(state: SoundState) => void>();

/** localStorage, or null where even touching it throws (blocked site data). */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  choice = readChoice(storage());
}

const isAvailable = (): boolean => !failedAtRuntime && engine.audioSupported();

/** Is sound on, and can this browser play it? */
export function soundState(): SoundState {
  ensureLoaded();
  const available = isAvailable();
  return { on: soundIsOn(choice, defaultOn, available), available };
}

/** Calls `listener` whenever the switch or its availability changes. Returns the unsubscribe function. */
export function onSoundChange(listener: (state: SoundState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const emit = (): void => { for (const listener of [...listeners]) listener(soundState()); };

/**
 * Whether sound starts on when the person has made no choice of their own. Phase 5 wires this to the
 * session setting; until then it is never called and the default is off. A saved choice always wins.
 */
export function setSoundDefault(on: boolean): void {
  defaultOn = on;
  ensureLoaded();
  if (choice === null) emit();
}

function markUnavailable(): void {
  failedAtRuntime = true;
  engine.stopAll();
  emit();
}

/** Makes sure the shared AudioContext exists and is running. Only ever called from inside a tap. */
function wake(): void {
  engine.setPlaybackSession(true);
  if (!engine.unlock()) markUnavailable();
}

/**
 * The sound switch was tapped. Turning it on starts audio inside this tap and plays the chime at once,
 * so the person hears that it works; turning it off silences whatever is sounding.
 */
export function setSound(on: boolean): void {
  ensureLoaded();
  if (on && !isAvailable()) { emit(); return; }
  choice = on;
  writeChoice(storage(), on);
  if (on) {
    wake();
    if (!isAvailable()) {
      // The browser refused to start audio: do not keep an "on" the person can never hear.
      choice = false;
      writeChoice(storage(), false);
      return;
    }
    emit();
    run(EFFECTS.soundOn);
  } else {
    engine.stopAll();
    engine.setPlaybackSession(false);
    emit();
  }
}

/** The "Click here to begin" tap: the moment audio may start when sound is already on (a saved choice or a session default). */
export function unlockAudio(): void {
  if (soundState().on) wake();
}

// ---- The moments ------------------------------------------------------------------------------------

function run(effect: Effect, anchor?: Element | null): void {
  if (effect.cue && soundState().on) engine.playCue(effect.cue);
  // Confetti is motion: the client's Animations switch, ?motion=off and the governor at its lowest leave it out (Phase 15), as reduced motion does.
  if (effect.confetti && motionLevel() !== 'none') void celebrate(effect.confetti, anchor);
}

/** A choice was made in a question that is not graded: a soft tick. */
export function pick(): void {
  run(EFFECTS.pick);
}

/**
 * A graded answer was settled. Exactly one cue; confetti only for a right answer on the first try,
 * from `anchor` (the pill that was tapped).
 */
export function answerFeedback(outcome: { correct: boolean; firstTry: boolean; revealed: boolean; anchor?: Element | null }): void {
  run(answerEffect(outcome), outcome.anchor);
}

/** The activity's answers are saved and its result screen is showing. */
export function activityComplete(): void {
  run(EFFECTS.activityComplete);
}

/** A new activity opens: whatever confetti is still falling goes. */
export function clearEffects(): void {
  clearConfetti();
}

/** Every activity is finished. */
export function finale(): void {
  run(EFFECTS.finale);
}

// ---- Setup ------------------------------------------------------------------------------------------

/**
 * One-time setup from App.svelte: restores the saved choice and, while sound is on, resumes a
 * suspended or interrupted context on the next tap and when the page comes back into view.
 */
export function initEffects(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  ensureLoaded();
  const onTap = () => { if (soundState().on) wake(); };
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, onTap, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && soundState().on) engine.resumeIfNeeded(); });
  window.addEventListener('pageshow', () => { if (soundState().on) engine.resumeIfNeeded(); });
}

// ---- Dev only ---------------------------------------------------------------------------------------
// The "Sound and confetti" section of #/styleguide plays any cue or burst on demand, so it can be
// auditioned on a real iPad. Only that dev-only page imports these, so a release build drops them
// (scripts/migration-tests/foundation.spec.ts checks that).

export const CUE_LIST = CUE_NAMES.map((name) => ({ name, label: CUES[name].label, max: CUES[name].max }));
export const CONFETTI_LIST = CONFETTI_SIZES;

/** Plays one cue whatever the switch says. Call it from a tap. */
export function auditionCue(name: CueName): void {
  wake();
  if (isAvailable()) engine.playCue(name);
}

/** Throws one burst, from the middle of the screen. Reduced motion still applies. */
export function auditionConfetti(size: ConfettiSize): void {
  void celebrate(size, null);
}
