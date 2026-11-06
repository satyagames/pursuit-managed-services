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
 *   filter: { type: 'bandpass' | 'lowpass', freq: number, q: number, to?: number },
 * }} Note
 * @typedef {{ label: string, max: number, gain: number, notes: Note[] }} CueSpec
 * @typedef {'soundOn' | 'pick' | 'correctFirst' | 'correctRetry' | 'incorrect' | 'revealed' | 'activityComplete' | 'finale' | 'stamp' | 'unlock' | 'locked' | 'allDone'
 *   | 'rateLow' | 'rateMedium' | 'rateHigh' | 'rateClear' | 'holdOpen' | 'rowDone' | 'milestoneQuarter' | 'milestoneHalf' | 'milestoneNearly' | 'clearAll' | 'allRated'} CueName
 */

// Equal temperament, A4 = 440 Hz.
const HZ = {
  F3: 174.61, G3: 196.0,
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

/** @param {number} freq @param {number} at @param {number} release @param {Partial<Extract<Note, { kind: 'tone' }>>} [more] @returns {Note} */
const sine = (freq, at, release, more = {}) => ({ kind: 'tone', wave: 'sine', freq, at, attack: 0.005, hold: 0, release, level: 0.3, ...more });
/** @param {number} freq @param {number} at @param {number} release @param {Partial<Extract<Note, { kind: 'tone' }>>} [more] @returns {Note} */
const triangle = (freq, at, release, more = {}) => ({ kind: 'tone', wave: 'triangle', freq, at, attack: 0.006, hold: 0, release, level: 0.3, ...more });

/** The finale's trim, which its bell levels are worked out from (so the bells sit at -24 to -34 dBFS whatever the trim). */
const FINALE_GAIN = 1;
/** The first bell's peak, dBFS; the last is 10 dB under it. */
const BELL_TOP_DB = -14;
/** The finale's bell rain: the note, and when it falls after 1.4 s (one about every 200 ms, a little uneven so it sounds like rain). */
const BELLS = /** @type {[number, number][]} */ ([
  [HZ.E6, 0], [HZ.G6, 0.21], [HZ.D6, 0.39], [HZ.C6, 0.61], [HZ.A5, 0.8], [HZ.G6, 1.01], [HZ.E6, 1.19],
  [HZ.C6, 1.4], [HZ.D6, 1.61], [HZ.A5, 1.79], [HZ.G5, 2.0], [HZ.E6, 2.21], [HZ.C6, 2.39], [HZ.G5, 2.6],
]);

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

  // The grand finale (Prompt 36), the visit's peak, under the petal shower: a swell of noise whose band rises from 500 to 3,600 Hz under the
  // hush (0 to 1.1 s); a chord bloom, C5 E5 G5 C6 60 ms apart, as the medal lands (1.0 s, each 1.6 s long); then a bell rain, 14 soft
  // sines from C major pentatonic (C5 to G6), about one every 200 ms from 1.4 s, each 0.55 s long, fading from -24 to -34 dBFS so the
  // sparkle thins out as the shower ends. Nothing sounds in the afterglow. The finale may sit up to 3 dB above the other cues (effects-audio.spec.ts).
  finale: {
    label: 'Finale', max: 4.6, gain: FINALE_GAIN,
    notes: [
      { kind: 'noise', at: 0, attack: 0.45, hold: 0.15, release: 0.5, level: 0.6, filter: { type: 'bandpass', freq: 500, to: 3600, q: 1.4 } },
      triangle(HZ.C5, 1.0, 1.58, { attack: 0.02, lowpass: 3800, level: 0.16 }),
      triangle(HZ.E5, 1.06, 1.58, { attack: 0.02, lowpass: 3800, level: 0.2 }),
      triangle(HZ.G5, 1.12, 1.58, { attack: 0.02, lowpass: 3800, level: 0.24 }),
      triangle(HZ.C6, 1.18, 1.58, { attack: 0.02, lowpass: 3800, level: 0.28 }),
      ...BELLS.map(([freq, at], index) => sine(freq, 1.4 + at, 0.425, { hold: 0.12, level: 10 ** ((BELL_TOP_DB - (10 * index) / (BELLS.length - 1)) / 20) / FINALE_GAIN })),
    ],
  },

  // The hub (Prompt 24), all in C major so the phrase joins up: finishing an activity (C, E, G), then stamp, then unlock (G, C), which resolves it.
  // The noise ticks have the 40 ms release every note has here (an envelope falling 80 dB), so they are heard as the brief's 6 to 8 ms click.

  // An activity is stamped done: a soft low thud (G3) and a tick. (G3 alone cannot reach the others' loudness under the peak limit, since the ear and the
  // A-weighting barely hear it, so it carries a quiet octave. The same for `locked`.)
  stamp: {
    label: 'Activity stamped done', max: 0.25, gain: 1.0,
    notes: [
      { kind: 'noise', at: 0, attack: 0.002, hold: 0, release: 0.04, level: 0.2, filter: { type: 'lowpass', freq: 1800, q: 0.707 } },
      sine(HZ.G3, 0, 0.12, { attack: 0.008, hold: 0.03, lowpass: 900, level: 0.36 }),
      sine(HZ.G3 * 2, 0, 0.12, { attack: 0.008, hold: 0.03, lowpass: 900, level: 0.2 }),
    ],
  },

  // The next activity opens: a key click, a short G5, then C6 with an E6 shimmer at a quarter of its level, ringing.
  unlock: {
    label: 'Activity unlocked', max: 0.6, gain: 1.26,
    notes: [
      { kind: 'noise', at: 0, attack: 0.002, hold: 0, release: 0.04, level: 0.25, filter: { type: 'bandpass', freq: 3000, q: 1.2 } },
      triangle(HZ.G5, 0.02, 0.09, { lowpass: 4800, level: 0.28 }),
      sine(HZ.C6, 0.1, 0.3, { level: 0.28 }),
      sine(HZ.E6, 0.1, 0.3, { level: 0.07 }),
    ],
  },

  // A tap on a locked activity: a dull knock, "not yet". Soft, short, under 700 Hz, never a buzz and never like `incorrect`.
  locked: {
    label: 'Activity still locked', max: 0.25, gain: 1.05,
    notes: [
      { kind: 'noise', at: 0, attack: 0.002, hold: 0, release: 0.05, level: 0.1, filter: { type: 'lowpass', freq: 700, q: 0.707 } },
      sine(HZ.G3, 0, 0.06, { attack: 0.006, hold: 0.03, lowpass: 700, level: 0.3 }),
      sine(HZ.G3 * 2, 0, 0.06, { attack: 0.006, hold: 0.03, lowpass: 700, level: 0.18 }),
      sine(HZ.F3, 0.07, 0.12, { attack: 0.006, hold: 0.045, lowpass: 700, level: 0.3 }),
      sine(HZ.F3 * 2, 0.07, 0.12, { attack: 0.006, hold: 0.045, lowpass: 700, level: 0.18 }),
    ],
  },

  // Every activity done: a rising shimmer.
  allDone: {
    label: 'Every activity done', max: 0.8, gain: 1.07,
    notes: [
      sine(HZ.C6, 0, 0.5, { level: 0.2 }),
      sine(HZ.E6, 0.07, 0.5, { level: 0.2 }),
      sine(HZ.G6, 0.14, 0.5, { level: 0.2 }),
    ],
  },

  // The Art of Possibility (Prompt 35), all in C major pentatonic (C D E G A) so a fast run of ratings is a tune, not noise. A rating is one short
  // note whose pitch is its level; a finished row, a milestone and the last box rise from there. The gains are trims from effects-audio.spec.ts.

  // A box set to Low: G3, low and soft (with a quiet octave, as `stamp`, so the ear hears it as loud as the others, and a faint D5, its twelfth, so it is not `stamp`).
  rateLow: {
    label: 'Rated Low', max: 0.12, gain: 1.0,
    notes: [
      sine(HZ.G3, 0, 0.085, { attack: 0.004, hold: 0.025, lowpass: 900, level: 0.3 }),
      sine(HZ.G3 * 2, 0, 0.085, { attack: 0.004, hold: 0.025, lowpass: 900, level: 0.26 }),
      sine(HZ.D5, 0, 0.05, { attack: 0.004, level: 0.04 }),
    ],
  },

  // Set to Medium: E4, with a quiet octave.
  rateMedium: {
    label: 'Rated Medium', max: 0.12, gain: 0.933,
    notes: [
      sine(HZ.E4, 0, 0.085, { attack: 0.004, hold: 0.025, level: 0.34 }),
      sine(HZ.E4 * 2, 0, 0.085, { attack: 0.004, hold: 0.025, level: 0.12 }),
    ],
  },

  // Set to High: C5 with a faint octave shimmer.
  rateHigh: {
    label: 'Rated High', max: 0.14, gain: 0.733,
    notes: [
      sine(HZ.C5, 0, 0.1, { attack: 0.004, hold: 0.03, level: 0.32 }),
      sine(HZ.C6, 0, 0.06, { attack: 0.004, hold: 0.02, level: 0.08 }),
    ],
  },

  // One box cleared: a low-passed tick like the pick's, softer, and with no note.
  rateClear: {
    label: 'Rating cleared', max: 0.06, gain: 0.955,
    notes: [{ kind: 'noise', at: 0, attack: 0.002, hold: 0.004, release: 0.05, level: 0.5, filter: { type: 'lowpass', freq: 3000, q: 0.707 } }],
  },

  // The press-and-hold ring has filled and the level menu opens: a short blip up, E5 then G5, with a quiet A5 on top so it is not the finished row.
  holdOpen: {
    label: 'Choices open', max: 0.15, gain: 1.0,
    notes: [
      triangle(HZ.E5, 0, 0.05, { hold: 0.01, lowpass: 4200, level: 0.3 }),
      triangle(HZ.G5, 0.06, 0.07, { hold: 0.01, lowpass: 4200, level: 0.3 }),
      sine(HZ.A5, 0.06, 0.06, { level: 0.05 }),
    ],
  },

  // A row's fifth box: two quick notes up (E5, G5), softer notes than a rating's (the trim keeps it as loud to the ear as every other cue).
  rowDone: {
    label: 'Row finished', max: 0.2, gain: 1.035,
    notes: [
      sine(HZ.E5, 0, 0.06, { hold: 0.01, level: 0.26 }),
      sine(HZ.G5, 0.075, 0.1, { hold: 0.01, level: 0.26 }),
    ],
  },

  // A quarter, half and three quarters rated: one note each, rising (C5, E5, G5), with a soft tail.
  milestoneQuarter: {
    label: 'A quarter rated', max: 0.35, gain: 1.175,
    notes: [triangle(HZ.C5, 0, 0.28, { attack: 0.008, hold: 0.04, lowpass: 4200, level: 0.3 })],
  },
  milestoneHalf: {
    label: 'Half rated', max: 0.35, gain: 1.0,
    notes: [triangle(HZ.E5, 0, 0.28, { attack: 0.008, hold: 0.04, lowpass: 4200, level: 0.3 })],
  },
  milestoneNearly: {
    label: 'Nearly all rated', max: 0.35, gain: 0.912,
    notes: [triangle(HZ.G5, 0, 0.28, { attack: 0.008, hold: 0.04, lowpass: 4200, level: 0.3 })],
  },

  // Clear all: a short descending run (G4, E4, D4, C4), low-passed, so it reads as a sweep down.
  clearAll: {
    label: 'All ratings cleared', max: 0.4, gain: 1.148,
    notes: [
      sine(HZ.G4, 0, 0.06, { hold: 0.015, lowpass: 1800, level: 0.4 }),
      sine(HZ.E4, 0.08, 0.06, { hold: 0.015, lowpass: 1700, level: 0.4 }),
      sine(HZ.D4, 0.16, 0.06, { hold: 0.015, lowpass: 1600, level: 0.4 }),
      sine(HZ.C4, 0.24, 0.12, { hold: 0.02, lowpass: 1500, level: 0.4 }),
    ],
  },

  // Every box rated: C5 E5 G5 C6 E6 rising, then a quiet G6 shimmer on the last note.
  allRated: {
    label: 'Every box rated', max: 1.0, gain: 0.933,
    notes: [
      triangle(HZ.C5, 0, 0.1, { hold: 0.02, lowpass: 4200, level: 0.26 }),
      triangle(HZ.E5, 0.1, 0.1, { hold: 0.02, lowpass: 4200, level: 0.26 }),
      triangle(HZ.G5, 0.2, 0.1, { hold: 0.02, lowpass: 4800, level: 0.26 }),
      triangle(HZ.C6, 0.3, 0.1, { hold: 0.02, lowpass: 5000, level: 0.26 }),
      sine(HZ.E6, 0.4, 0.45, { attack: 0.01, hold: 0.06, level: 0.24 }),
      sine(HZ.G6, 0.42, 0.4, { attack: 0.02, level: 0.06 }),
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
export const RATE_GAP_MS = 60;
/** The cues a tap on a box makes: together they start at most once every RATE_GAP_MS, so a fast run of taps drops the extras rather than piling up. */
export const RATING_CUES = Object.freeze(new Set(['rateLow', 'rateMedium', 'rateHigh', 'rateClear', 'holdOpen', 'clearAll']));

/**
 * Decides whether a cue may start. The same cue within RETRIGGER_MS of its last start is ignored,
 * and when MAX_VOICES cues are already sounding the oldest one is told to stop ("steal"). Pure: the
 * caller passes the clock, so it can be tested without audio. The rating cues (RATING_CUES) are also one group: after one of them starts, any
 * of them within RATE_GAP_MS is ignored (Prompt 35).
 *
 * @param {{ minGapMs?: number, maxVoices?: number, groupGapMs?: number, group?: Set<string> }} [options]
 */
export function createVoiceGate({ minGapMs = RETRIGGER_MS, maxVoices = MAX_VOICES, groupGapMs = RATE_GAP_MS, group = RATING_CUES } = {}) {
  /** @type {Map<string, number>} */
  const lastStart = new Map();
  let groupStart = -Infinity;
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
      const grouped = group.has(name);
      if (grouped && nowMs - groupStart < groupGapMs) return { play: false };
      voices = voices.filter((voice) => voice.endMs > nowMs);
      /** @type {number | null} */
      let steal = null;
      if (voices.length >= maxVoices) steal = /** @type {{ id: number }} */ (voices.shift()).id;
      const id = nextId;
      nextId += 1;
      voices.push({ id, endMs: nowMs + durationMs });
      lastStart.set(name, nowMs);
      if (grouped) groupStart = nowMs;
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
