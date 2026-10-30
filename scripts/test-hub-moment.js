import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  BEAT_LENGTH, LOCKED_TAP_GAP, MOMENT, SHAKE_LENGTH, beatEnd, heldLooks, hubCount, hubMoment, lockedTapAllowed, momentAnnouncement,
} from '../migration/src/lib/participant/hub-moment-plan.js';
import { TOKENS } from '../migration/src/lib/motion/motion-plan.js';

// Prompt 24, Part 3: the hub's moment, which needs no browser. Only a real change of state makes a beat; the first drawing, a reload, and a new,
// removed or renamed activity make none; the timings are the brief's. The look and the wiring are read from the source here, and seen in
// scripts/migration-tests/hub-states.spec.ts.

const root = path.join(import.meta.dirname, '..');
const pill = (id, state, more = {}) => ({ id, title: id.toUpperCase(), state, total: 2, ...more });
const kinds = (beats) => beats.map((beat) => `${beat.at} ${beat.kind} ${beat.id}`);

test('finishing an activity: stamp, journey line, unlock, pulse, in that order, at the brief\'s times', () => {
  const beats = hubMoment([pill('a', 'progress'), pill('b', 'locked')], [pill('a', 'done'), pill('b', 'ready')]);
  assert.deepEqual(kinds(beats), ['400 stamp a', '580 journey a', '760 unlock b', '1150 pulse b']);
});

test('the unlock follows its stamp by 360 ms; alone it comes at the stamp\'s time', () => {
  const both = hubMoment([pill('a', 'ready'), pill('b', 'locked')], [pill('a', 'done'), pill('b', 'ready')]);
  assert.equal(both.find((beat) => beat.kind === 'unlock').at - both.find((beat) => beat.kind === 'stamp').at, 360);
  const alone = hubMoment([pill('b', 'locked')], [pill('b', 'ready')]);
  assert.equal(alone.find((beat) => beat.kind === 'unlock').at, MOMENT.stamp);
});

test('the only transitions that make a beat', () => {
  const states = ['done', 'progress', 'ready', 'locked'];
  for (const from of states) for (const to of states) {
    const beats = hubMoment([pill('a', from), pill('z', 'locked')], [pill('a', to), pill('z', 'locked')]);
    const named = beats.map((beat) => beat.kind).filter((kind) => ['stamp', 'unlock'].includes(kind));
    const expected = from === to ? [] : (to === 'done' && (from === 'progress' || from === 'ready')) ? ['stamp'] : (from === 'locked' && to === 'ready') ? ['unlock'] : [];
    assert.deepEqual(named, expected, `${from} to ${to}`);
  }
});

test('none for a first drawing, a reload (no previous), the same hub, a new, a removed or a renamed activity', () => {
  const now = [pill('a', 'done'), pill('b', 'ready')];
  assert.deepEqual(hubMoment(null, now), []);
  assert.deepEqual(hubMoment(undefined, now), []);
  assert.deepEqual(hubMoment(now, now), []);
  assert.deepEqual(hubMoment([pill('a', 'done')], now), [], 'a new activity');
  assert.deepEqual(hubMoment([...now, pill('c', 'locked')], now), [], 'a removed one');
  assert.deepEqual(hubMoment(now, [pill('a', 'done', { title: 'New name' }), pill('b', 'ready', { title: 'Other' })]), [], 'renamed: the same id');
  assert.deepEqual(hubMoment([pill('x', 'ready')], [pill('y', 'done')]), [], 'compared by id, not by place');
});

test('every activity done: the stamp, then all-done and a wave down the pills 60 ms apart', () => {
  const beats = hubMoment([pill('a', 'done'), pill('b', 'progress'), pill('c', 'done')], [pill('a', 'done'), pill('b', 'done'), pill('c', 'done')]);
  assert.deepEqual(kinds(beats.filter((beat) => beat.kind !== 'journey')), ['400 stamp b', '760 allDone null', '760 wave a', '820 wave b', '880 wave c']);
});

test('an empty activity does not keep all-done away, and all-done needs a stamp (an activity taken away is not a finish)', () => {
  const beats = hubMoment([pill('a', 'ready'), pill('e', 'ready', { total: 0 })], [pill('a', 'done'), pill('e', 'ready', { total: 0 })]);
  assert.ok(beats.some((beat) => beat.kind === 'allDone'));
  assert.deepEqual(hubMoment([pill('a', 'done'), pill('b', 'ready')], [pill('a', 'done')]), []);
});

test(`the moment is at most ${MOMENT.cap} ms whatever the list (the pulse's rings start inside it and fade by themselves)`, () => {
  for (const count of [1, 2, 4, 9, 30]) {
    const before = Array.from({ length: count }, (_, index) => pill(`s${index}`, index === count - 1 ? 'progress' : 'done'));
    const after = before.map((entry) => ({ ...entry, state: 'done' }));
    for (const beat of hubMoment(before, after)) assert.ok(beatEnd(beat) <= MOMENT.cap, `${count} pills: ${beat.kind} ends at ${beatEnd(beat)}`);
  }
  const unlock = hubMoment([pill('a', 'progress'), pill('b', 'locked')], [pill('a', 'done'), pill('b', 'ready')]);
  for (const beat of unlock) {
    assert.ok(beat.at <= MOMENT.cap, beat.kind);
    if (beat.kind !== 'pulse') assert.ok(beatEnd(beat) <= MOMENT.cap, `${beat.kind} ends at ${beatEnd(beat)}`);
  }
});

test('reduced and none: no journey, pulse or wave; the stamp, the unlock and all-done keep their times, for their sound', () => {
  for (const level of ['reduced', 'none']) {
    const unlock = hubMoment([pill('a', 'progress'), pill('b', 'locked')], [pill('a', 'done'), pill('b', 'ready')], { level });
    assert.deepEqual(kinds(unlock), ['400 stamp a', '760 unlock b'], level);
    const all = hubMoment([pill('a', 'progress')], [pill('a', 'done')], { level });
    assert.deepEqual(kinds(all), ['400 stamp a', '760 allDone null'], level);
  }
});

test('the same input gives the same beats', () => {
  const run = () => hubMoment([pill('a', 'progress'), pill('b', 'locked')], [pill('a', 'done'), pill('b', 'ready')]);
  assert.deepEqual(run(), run());
});

test('the old look is held until its own beat, for the pills that change and no others', () => {
  const previous = [pill('a', 'progress'), pill('b', 'locked'), pill('c', 'locked')];
  const next = [pill('a', 'done'), pill('b', 'ready'), pill('c', 'locked')];
  const held = heldLooks(previous, hubMoment(previous, next));
  assert.deepEqual([...held], [['a', 'progress'], ['b', 'locked']]);
  assert.equal(heldLooks(null, []).size, 0);
});

test('a screen reader hears one line, once, not the animation', () => {
  const previous = [pill('guess', 'progress', { title: 'Guess the Brand' }), pill('talk', 'locked', { title: 'Straight Talk' })];
  const next = [pill('guess', 'done', { title: 'Guess the Brand' }), pill('talk', 'ready', { title: 'Straight Talk' })];
  assert.equal(momentAnnouncement(previous, next, hubMoment(previous, next)), 'Guess the Brand is done. Straight Talk is now ready.');
  assert.equal(momentAnnouncement(next, next, hubMoment(next, next)), '');
  const reduced = hubMoment(previous, next, { level: 'none' });
  assert.equal(momentAnnouncement(previous, next, reduced), 'Guess the Brand is done. Straight Talk is now ready.', 'whatever the level');
});

test('a second tap on a locked pill within 400 ms does not stack', () => {
  assert.equal(LOCKED_TAP_GAP, 400);
  assert.equal(lockedTapAllowed(null, 5), true);
  assert.equal(lockedTapAllowed(1000, 1399), false);
  assert.equal(lockedTapAllowed(1000, 1400), true);
});

test('the count is of activities that can be finished', () => {
  assert.deepEqual(hubCount([pill('a', 'done'), pill('b', 'progress'), pill('e', 'ready', { total: 0 }), pill('c', 'locked')]), { done: 1, total: 3 });
  assert.deepEqual(hubCount([]), { done: 0, total: 0 });
});

test('the lengths are the motion tokens, and the CSS declares the same', async () => {
  const hub = TOKENS.hub;
  assert.equal(BEAT_LENGTH.journey, hub.journey);
  assert.equal(BEAT_LENGTH.pulse, hub.pulse);
  assert.equal(BEAT_LENGTH.unlock, hub.sweep);
  assert.equal(SHAKE_LENGTH, hub.shake);
  assert.equal(MOMENT.wave, hub.wave);
  assert.deepEqual([hub.shackle, hub.crossfade, hub.fade], [220, 260, 150], 'the brief\'s shackle, cross-fade and reduced fade');
  const css = await readFile(path.join(root, 'migration/src/lib/motion/motion-tokens.css'), 'utf8');
  for (const [name, value] of Object.entries(hub)) assert.match(css, new RegExp(`--motion-hub-${name}:\\s*${value}ms;`), name);
});

test('the driver: nothing waits for the moment, a navigation clears its timers, and no screen names a cue', async () => {
  const agenda = await readFile(path.join(root, 'migration/src/routes/Agenda.svelte'), 'utf8');
  assert.match(agenda, /onDestroy\(/, 'the hub clears the moment when it goes');
  assert.match(agenda, /clearTimeout/);
  assert.match(agenda, /hubMoment\(/);
  assert.doesNotMatch(agenda, /await\s+[^;]*moment/i, 'nothing awaits it');
  assert.doesNotMatch(agenda, /playCue|CUES|sound-cues|cue:/, 'the hub asks the effects module for a moment, never a sound');
  assert.match(agenda, /aria-live="polite"/);
  // The previous hub is kept in memory for the visit, not stored, so a reload plays nothing.
  assert.doesNotMatch(agenda, /(?:local|session)Storage/);
  const plan = await readFile(path.join(root, 'migration/src/lib/participant/hub-moment-plan.js'), 'utf8');
  assert.doesNotMatch(plan.replace(/\/\/.*$/gm, ''), /document\.|window\.|setTimeout|requestAnimationFrame/, 'the plan is pure');
});
