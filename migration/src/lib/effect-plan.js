// What each moment in the participant flow should do, and how the sound choice is remembered.
// Pure (no DOM, no audio), so `node --test` covers it (scripts/test-effects.js) and effects.ts
// only has to carry the plan out.

/**
 * @typedef {import('./sound-cues.js').CueName} CueName
 * @typedef {'small' | 'medium' | 'large'} ConfettiSize
 * @typedef {{ cue: CueName | null, confetti: ConfettiSize | null }} Effect
 */

/** Next, Back, Home and "Click here to begin" make no sound of their own, so they are not here. */
export const EFFECTS = /** @type {const} */ ({
  soundOn: { cue: 'soundOn', confetti: null },
  pick: { cue: 'pick', confetti: null },
  activityComplete: { cue: 'activityComplete', confetti: 'medium' },
  finale: { cue: 'finale', confetti: 'large' },
});

/**
 * The effect of settling a graded answer. Exactly one cue, and confetti only for a right answer
 * on the first try (never on a wrong one, a right one after a Retry, or a reveal).
 *
 * @param {{ correct: boolean, firstTry: boolean, revealed: boolean }} outcome
 * @returns {Effect}
 */
export function answerEffect({ correct, firstTry, revealed }) {
  if (revealed) return { cue: 'revealed', confetti: null };
  if (correct) return firstTry ? { cue: 'correctFirst', confetti: 'small' } : { cue: 'correctRetry', confetti: null };
  return { cue: 'incorrect', confetti: null };
}

// ---- The remembered sound choice -------------------------------------------------------------------

export const SOUND_KEY = 'pms.sound';

/**
 * The saved choice: true (on), false (off) or null (never chosen). Storage that throws (private
 * mode, blocked cookies) reads as "never chosen". @param {Pick<Storage, 'getItem'> | null | undefined} storage
 */
export function readChoice(storage) {
  try {
    const value = storage?.getItem(SOUND_KEY);
    return value === 'on' ? true : value === 'off' ? false : null;
  } catch {
    return null;
  }
}

/** Saves the choice; a failure is ignored, sound is never worth an error. @param {Pick<Storage, 'setItem'> | null | undefined} storage @param {boolean} on */
export function writeChoice(storage, on) {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // The choice just lasts until the page is closed.
  }
}

/** Is sound on right now? A person's saved choice wins over the per-session default. @param {boolean | null} choice @param {boolean} defaultOn @param {boolean} available */
export const soundIsOn = (choice, defaultOn, available) => available && (choice ?? defaultOn);

/** The title of the disabled switch when this browser has no Web Audio. */
export const UNAVAILABLE_TITLE = "Sound isn't available in this browser";
