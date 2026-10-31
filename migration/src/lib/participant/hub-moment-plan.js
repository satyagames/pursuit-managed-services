// The moment on the Activities hub (Prompt 24): what plays when the hub the guest last saw and the hub drawn now differ. Pure (no page, no
// timers, no sound), so `node --test` covers it (scripts/test-hub-moment.js); routes/Agenda.svelte carries the beats out and
// lib/effects/effects.ts makes their sound and sparks. It decides nothing about which activity opens: activityStates does.
//
// ASSUMED: board 18 has the unlock at 900 ms, 500 ms after the stamp, and the brief says 360 ms after it in three places, one of them a
// test. The brief's 360 ms is built: stamp 400, journey line 580 (so it arrives as the lock opens), unlock 760, ready pulse 1,150.
// ASSUMED: the 1,400 ms cap holds for every beat's end except the pulse's rings, which start inside it and fade out by themselves
// (1,150 + 1,200 ms by the brief's own numbers); nothing waits for them and they are behind the same level rule.

/** @typedef {'done' | 'progress' | 'ready' | 'locked'} HubState */
/** @typedef {{ id: string, title?: string, state: HubState, total?: number }} HubPill */
/** @typedef {'stamp' | 'journey' | 'unlock' | 'pulse' | 'allDone' | 'wave'} BeatKind */
/** @typedef {{ at: number, kind: BeatKind, id: string | null }} Beat */

/** When each beat starts, ms from the hub being drawn. */
export const MOMENT = Object.freeze({
  stamp: 400,
  /** The journey line grows from the done pill to the next one. */
  journey: 580,
  /** After its stamp when both happen. */
  afterStamp: 360,
  pulse: 1150,
  /** The longest the moment lasts, ms (see the note above on the pulse). */
  cap: 1400,
  /** The gap between two pills of the all-done wave, ms; a long list gets less, so the wave ends inside the cap. */
  wave: 60,
});

/** How long each beat's own movement lasts, ms. TOKENS.hub (lib/motion/motion-plan.js) and the CSS tokens are the same numbers (a test holds them). */
export const BEAT_LENGTH = Object.freeze({ stamp: 400, journey: 180, unlock: 500, pulse: 1200, allDone: 320, wave: 320 });

/** What a screen reader hears for a tap on a locked pill. */
export const LOCKED_LINE = 'Locked. Finish the previous activity first.';
/** When the governor's frame watcher is asked to count this moment, ms: just after the entrance's own watch (ENTRANCE_BUDGET, lib/motion/motion-plan.js) has ended. */
export const WATCH_AT = 720;
/** A second tap on a locked pill within this many ms does not stack. */
export const LOCKED_TAP_GAP = 400;
/** How long the shake lasts, ms. */
export const SHAKE_LENGTH = 280;

const FINISHABLE = (/** @type {HubPill} */ pill) => (pill.total ?? 1) > 0;

/**
 * The beats between two drawings of the hub, in order of time. `previous` null is the first drawing (or a reload: it is held in memory only):
 * nothing plays. Only a change of state of an activity that was there before makes a beat: to done (a stamp), from locked to ready (an unlock),
 * and every activity done once one has just been stamped.
 *
 * The levels (lib/motion/motion-plan.js resolveLevel): below 'full' there is no journey, pulse or wave; the stamp, the unlock and all-done still
 * come, at the same times, for their sound and what a screen shows (a fade at 'reduced', at once at 'none').
 * @param {HubPill[] | null | undefined} previous @param {HubPill[]} next @param {{ level?: 'full' | 'reduced' | 'none' }} [options]
 * @returns {Beat[]}
 */
export function hubMoment(previous, next, { level = 'full' } = {}) {
  if (!previous) return [];
  const before = new Map(previous.map((pill) => [pill.id, pill.state]));
  const changed = (/** @type {HubPill} */ pill) => before.has(pill.id) && before.get(pill.id) !== pill.state;
  const stamped = next.filter((pill) => changed(pill) && pill.state === 'done' && (before.get(pill.id) === 'progress' || before.get(pill.id) === 'ready'));
  const unlocked = next.filter((pill) => changed(pill) && pill.state === 'ready' && before.get(pill.id) === 'locked');
  const full = level === 'full';
  const after = stamped.length ? MOMENT.stamp + MOMENT.afterStamp : MOMENT.stamp;
  /** @type {Beat[]} */
  const beats = [];
  for (const pill of stamped) {
    beats.push({ at: MOMENT.stamp, kind: 'stamp', id: pill.id });
    if (full) beats.push({ at: MOMENT.journey, kind: 'journey', id: pill.id });
  }
  for (const pill of unlocked) {
    beats.push({ at: after, kind: 'unlock', id: pill.id });
    if (full) beats.push({ at: MOMENT.pulse, kind: 'pulse', id: pill.id });
  }
  const finishable = next.filter(FINISHABLE);
  if (stamped.length && finishable.length && finishable.every((pill) => pill.state === 'done')) {
    beats.push({ at: after, kind: 'allDone', id: null });
    if (full) {
      const room = MOMENT.cap - after - BEAT_LENGTH.wave;
      const step = Math.min(MOMENT.wave, room / Math.max(1, finishable.length - 1));
      finishable.forEach((pill, index) => beats.push({ at: Math.round(after + index * step), kind: 'wave', id: pill.id }));
    }
  }
  return beats.sort((left, right) => left.at - right.at);
}

/** When a beat has ended, ms. @param {Beat} beat */
export const beatEnd = (beat) => beat.at + BEAT_LENGTH[beat.kind];

/**
 * The look each changing pill keeps until its own beat, so that the finished activity still shows its old state as the hub comes in (board 18).
 * It is only how it is painted: what the pill does when tapped, and what a screen reader hears, is its real state from the first frame.
 * @param {HubPill[] | null | undefined} previous @param {Beat[]} beats @returns {Map<string, HubState>}
 */
export function heldLooks(previous, beats) {
  const before = new Map((previous ?? []).map((pill) => [pill.id, pill.state]));
  /** @type {Map<string, HubState>} */
  const held = new Map();
  for (const beat of beats) {
    if ((beat.kind === 'stamp' || beat.kind === 'unlock') && beat.id !== null && before.has(beat.id)) held.set(beat.id, /** @type {HubState} */ (before.get(beat.id)));
  }
  return held;
}

/**
 * The one polite line a screen reader hears for a change, or '' when nothing was said to have changed: "Guess the Brand is done. Straight Talk is now ready."
 * @param {HubPill[] | null | undefined} previous @param {HubPill[]} next @param {Beat[]} beats
 */
export function momentAnnouncement(previous, next, beats) {
  const title = (/** @type {string | null} */ id) => next.find((pill) => pill.id === id)?.title ?? '';
  const of = (/** @type {BeatKind} */ kind) => beats.filter((beat) => beat.kind === kind);
  const done = of('stamp').map((beat) => `${title(beat.id)} is done.`);
  const ready = of('unlock').map((beat) => `${title(beat.id)} is now ready.`);
  const all = of('allDone').length ? ['Every activity is done.'] : [];
  return [...done, ...ready, ...all].join(' ');
}

/** May this tap on a locked pill play? The caller passes the clock. @param {number | null} lastAt @param {number} now */
export const lockedTapAllowed = (lastAt, now) => lastAt === null || now - lastAt >= LOCKED_TAP_GAP;

/** "1 of 4 complete": activities with questions only, since one with none can never be finished. @param {HubPill[]} pills */
export function hubCount(pills) {
  const finishable = pills.filter(FINISHABLE);
  return { done: finishable.filter((pill) => pill.state === 'done').length, total: finishable.length };
}
