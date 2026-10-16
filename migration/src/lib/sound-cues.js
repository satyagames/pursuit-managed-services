// The participant sounds, as DATA. Nothing here touches Web Audio, so `node --test`
// (scripts/test-effects.js) can check the table, and sound-engine.ts is the only file that turns it
// into sound. To change how a cue sounds, edit its notes here; to add one, add a row and a name.
//
// A cue is a short list of notes. Every note has the same envelope: a linear attack, a hold at
// `level`, then an exponential release that ends 80 dB down (so it never ends in a click). Times
// are in seconds from the start of the cue; `level` is linear gain (0.3 is about -10 dBFS). Tones
// are sines or triangles only (no square or saw, which is what makes a UI sound harsh) and can be
// softened further with a low-pass. The tick uses a short burst of low-passed noise.
//
// Loudness: each cue's `gain` is a trim worked out from scripts/migration-tests/effects-audio.spec.ts
// (it renders every cue and prints peak, A-weighted level and duration). The gains below aim every cue
// at -22 dB A-weighted while it sounds, which keeps the loudest peak (the finale) near -7 dBFS. That
// spec fails if a cue peaks above -5 dBFS, is quieter than -40 dBFS, runs over `max`, or sits more than
// 2 dB (A-weighted) from the others. Re-run it after changing a note and adjust `gain` from its report.

/**
 * @typedef {{
 *   kind: 'tone', wave: 'sine' | 'triangle', freq: number, at: number,
 *   attack: number, hold: number, release: number, level: number,
 *   lowpass?: number,
 * } | {
 *   kind: 'noise', at: number, attack: number, hold: number, release: number, level: number,
 *   filter: { type: 'bandpass' | 'lowpass', freq: number, q: number },
 * }} Note
 * @typedef {{ label: string, max: number, gain: number, notes: Note[] }} CueSpec
 * @typedef {'soundOn' | 'pick' | 'correctFirst' | 'correctRetry' | 'incorrect' | 'revealed' | 'activityComplete' | 'finale'} CueName
 */

// Equal temperament, A4 = 440 Hz.
const HZ = {
  C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, B5: 987.77,
  C6: 1046.5, G6: 1567.98,
};

/** @param {number} freq @param {number} at @param {number} release @param {Partial<Extract<Note, { kind: 'tone' }>>} [more] @returns {Note} */
const sine = (freq, at, release, more = {}) => ({ kind: 'tone', wave: 'sine', freq, at, attack: 0.005, hold: 0, release, level: 0.3, ...more });
/** @param {number} freq @param {number} at @param {number} release @param {Partial<Extract<Note, { kind: 'tone' }>>} [more] @returns {Note} */
const triangle = (freq, at, release, more = {}) => ({ kind: 'tone', wave: 'triangle', freq, at, attack: 0.006, hold: 0, release, level: 0.3, ...more });

/** @type {Record<CueName, CueSpec>} */
export const CUES = {
  // Sound switched on: a short two-note chime (G5, C6) with a faint octave shimmer.
  soundOn: {
    label: 'Sound on', max: 0.3, gain: 0.977,
    notes: [
      sine(HZ.G5, 0, 0.13, { level: 0.34 }),
      sine(HZ.G5 * 2, 0, 0.07, { level: 0.07 }),
      sine(HZ.C6, 0.085, 0.17, { level: 0.34 }),
      sine(HZ.C6 * 2, 0.085, 0.08, { level: 0.07 }),
    ],
  },

  // Option picked: a soft tick. Low-passed noise for the click, a short low blip for the body.
  pick: {
    label: 'Option picked', max: 0.06, gain: 1.035,
    notes: [
      { kind: 'noise', at: 0, attack: 0.002, hold: 0, release: 0.05, level: 0.55, filter: { type: 'lowpass', freq: 1800, q: 0.707 } },
      sine(1250, 0, 0.045, { attack: 0.002, level: 0.22 }),
    ],
  },

  // Correct first time: a bright rising two-note (E5 up to B5).
  correctFirst: {
    label: 'Correct, first try', max: 0.5, gain: 0.785,
    notes: [
      triangle(HZ.E5, 0, 0.11, { hold: 0.04, lowpass: 4200, level: 0.3 }),
      triangle(HZ.B5, 0.11, 0.3, { hold: 0.06, lowpass: 5000, level: 0.3 }),
    ],
  },

  // Correct after a Retry: one gentler note.
  correctRetry: {
    label: 'Correct, after a retry', max: 0.3, gain: 0.832,
    notes: [sine(HZ.D5, 0, 0.24, { attack: 0.01, hold: 0.03, level: 0.34 })],
  },

  // Incorrect: soft, low and falling (G4 down to E4), low-passed so it is never sharp.
  incorrect: {
    label: 'Incorrect', max: 0.4, gain: 1.072,
    notes: [
      sine(HZ.G4, 0, 0.14, { attack: 0.01, hold: 0.03, lowpass: 1500, level: 0.34 }),
      sine(HZ.E4, 0.15, 0.17, { attack: 0.012, hold: 0.04, lowpass: 1300, level: 0.34 }),
    ],
  },

  // Answer revealed after two wrong tries: one neutral note, neither happy nor sad.
  revealed: {
    label: 'Answer revealed', max: 0.3, gain: 0.881,
    notes: [sine(HZ.A4, 0, 0.22, { attack: 0.01, hold: 0.05, level: 0.34 })],
  },

  // Activity complete: a rising three-note (C5, E5, G5) that rings on the last note.
  activityComplete: {
    label: 'Activity complete', max: 1.0, gain: 0.871,
    notes: [
      triangle(HZ.C5, 0, 0.22, { hold: 0.05, lowpass: 4200, level: 0.28 }),
      triangle(HZ.E5, 0.15, 0.22, { hold: 0.05, lowpass: 4200, level: 0.28 }),
      triangle(HZ.G5, 0.3, 0.55, { attack: 0.008, hold: 0.12, lowpass: 4800, level: 0.3 }),
    ],
  },

  // Finale: a quick C major arpeggio, then the full chord (C4 C5 E5 G5 C6) held and let ring.
  finale: {
    label: 'Finale', max: 2.2, gain: 0.891,
    notes: [
      triangle(HZ.C5, 0, 0.55, { attack: 0.01, hold: 0.08, lowpass: 4200, level: 0.2 }),
      triangle(HZ.E5, 0.09, 0.55, { attack: 0.01, hold: 0.08, lowpass: 4200, level: 0.2 }),
      triangle(HZ.G5, 0.18, 0.55, { attack: 0.01, hold: 0.08, lowpass: 4200, level: 0.2 }),
      sine(HZ.C4, 0.42, 1.12, { attack: 0.02, hold: 0.5, level: 0.18 }),
      triangle(HZ.C5, 0.42, 1.12, { attack: 0.02, hold: 0.5, lowpass: 4200, level: 0.12 }),
      triangle(HZ.E5, 0.432, 1.12, { attack: 0.02, hold: 0.5, lowpass: 4200, level: 0.12 }),
      triangle(HZ.G5, 0.444, 1.12, { attack: 0.02, hold: 0.5, lowpass: 4200, level: 0.12 }),
      sine(HZ.C6, 0.456, 1.12, { attack: 0.02, hold: 0.5, level: 0.1 }),
    ],
  },
};

/** @type {CueName[]} */
export const CUE_NAMES = /** @type {CueName[]} */ (Object.keys(CUES));

/** Where a note stops being audible (its envelope has fallen 80 dB), in seconds from the cue start. @param {Note} note */
export const noteEnd = (note) => note.at + note.attack + note.hold + note.release;

/** When the whole cue has ended, in seconds. @param {CueSpec} cue */
export const cueEnd = (cue) => Math.max(...cue.notes.map(noteEnd));

/** The tone frequencies of a cue in the order they start: its fingerprint, used by the wiring tests. @param {CueSpec} cue */
export const toneSignature = (cue) => cue.notes
  .filter((note) => note.kind === 'tone')
  .map((note) => /** @type {number} */ (note.freq));

/** How many cues may sound at once, and how soon the same cue may repeat. */
export const MAX_VOICES = 3;
export const RETRIGGER_MS = 80;

/**
 * Decides whether a cue may start. The same cue within RETRIGGER_MS of its last start is ignored,
 * and when MAX_VOICES cues are already sounding the oldest one is told to stop ("steal"). Pure: the
 * caller passes the clock, so it can be tested without audio.
 *
 * @param {{ minGapMs?: number, maxVoices?: number }} [options]
 */
export function createVoiceGate({ minGapMs = RETRIGGER_MS, maxVoices = MAX_VOICES } = {}) {
  /** @type {Map<string, number>} */
  const lastStart = new Map();
  /** @type {{ id: number, endMs: number }[]} */
  let voices = [];
  let nextId = 1;

  return {
    /**
     * @param {string} name
     * @param {number} nowMs
     * @param {number} durationMs how long the cue sounds
     * @returns {{ play: false } | { play: true, id: number, steal: number | null }}
     */
    request(name, nowMs, durationMs) {
      const last = lastStart.get(name);
      if (last !== undefined && nowMs - last < minGapMs) return { play: false };
      voices = voices.filter((voice) => voice.endMs > nowMs);
      /** @type {number | null} */
      let steal = null;
      if (voices.length >= maxVoices) steal = /** @type {{ id: number }} */ (voices.shift()).id;
      const id = nextId;
      nextId += 1;
      voices.push({ id, endMs: nowMs + durationMs });
      lastStart.set(name, nowMs);
      return { play: true, id, steal };
    },
    /** A cue that never got to sound (the context would not start) gives its slot back. @param {number} id */
    release(id) {
      voices = voices.filter((voice) => voice.id !== id);
    },
    /** How many cues are sounding at `nowMs`. @param {number} nowMs */
    active(nowMs) {
      return voices.filter((voice) => voice.endMs > nowMs).length;
    },
  };
}
