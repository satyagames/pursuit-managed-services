// Phase 15, part 2: the motion engine (lib/motion/motion.ts) on a stand-in window and document, frame by frame. Run: node --test
// scripts/test-motion-engine.js (also part of npm test).
//
// What it holds: nothing happens when the module loads; an element gets its shape and tokens written ONCE when it arrives with a new screen
// and nothing when it arrives with no direction (the first screen, a refresh); the moment closes two frames later; at most MAX_CONCURRENT move
// at once; an ended, cancelled or removed element is forgotten and its attribute taken away; a hidden tab finishes everything; the client's
// switch and the device's reduced motion (which wins) give no motion and write the level where they are told; a verdict moves once per change;
// the governor watches only a few entrances, steps down on dropped frames, keeps its step for the session and leaves no frame callback at idle;
// ?motion=off holds for the session; no timer is ever set; and a browser without matchMedia or storage still works.
// This drives the real file (made plain JS by Vite's esbuild), as scripts/test-page-watch.js does.

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { transformWithEsbuild } from 'vite';
import { MAX_CONCURRENT, WATCH_WINDOW } from '../migration/src/lib/motion/motion-plan.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let folder;
let file;
let copies = 0;

/** A stand-in window, document and element factory; frames run only when the test says so. */
function stage({ reduced = false, search = '', storage = new Map(), noMatchMedia = false, brokenStorage = false } = {}) {
  const listeners = new Map();
  const frames = [];
  const calls = { timers: 0, frames: 0, matchMedia: 0, reads: 0 };
  let now = 0;
  const on = (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  const sessionStorage = brokenStorage ? new Proxy({}, { get() { throw new Error('blocked'); } }) : {
    getItem: (key) => { calls.reads += 1; return storage.has(key) ? storage.get(key) : null; },
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    innerWidth: 820,
    location: { search },
    setTimeout: () => { calls.timers += 1; return 0; },
    setInterval: () => { calls.timers += 1; return 0; },
    get sessionStorage() { if (brokenStorage) throw new Error('blocked'); return sessionStorage; },
  };
  globalThis.document = { hidden: false, documentElement: element(), addEventListener: on, removeEventListener() {} };
  globalThis.requestAnimationFrame = (fn) => { calls.frames += 1; frames.push(fn); return frames.length; };
  if (noMatchMedia) delete globalThis.matchMedia;
  else globalThis.matchMedia = (query) => { calls.matchMedia += 1; return { matches: reduced && query.includes('reduce') }; };
  return {
    calls,
    storage,
    pending: () => frames.length,
    /** Runs the frame callbacks waiting now, `gap` ms after the last frame. */
    frame(gap = 16.7) { now += gap; const due = frames.splice(0); for (const fn of due) fn(now); },
    fire(name, event = {}) { for (const fn of listeners.get(name) ?? []) fn(event); },
    listenerCount: () => [...listeners.values()].reduce((sum, list) => sum + list.length, 0),
  };
}

function element() {
  const props = new Map();
  return { dataset: {}, style: { setProperty: (name, value) => props.set(name, value), props } };
}

/** A fresh copy of the module, so each test starts from its own state. */
async function load() {
  copies += 1;
  return import(`${pathToFileURL(file).href}?copy=${copies}`);
}

describe('the motion engine', () => {
  before(async () => {
    const source = await readFile(path.join(ROOT, 'migration/src/lib/motion/motion.ts'), 'utf8');
    const { code } = await transformWithEsbuild(source, 'motion.ts', { loader: 'ts', format: 'esm' });
    const plan = pathToFileURL(path.join(ROOT, 'migration/src/lib/motion/motion-plan.js')).href;
    folder = await mkdtemp(path.join(os.tmpdir(), 'pms-motion-'));
    file = path.join(folder, 'motion.mjs');
    await writeFile(file, code.replace(/from ['"]\.\/motion-plan\.js['"]/, `from '${plan}'`));
  });
  after(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

  it('loading the module does nothing: no listener, no frame, no read', async () => {
    const page = stage();
    await load();
    assert.equal(page.listenerCount(), 0);
    assert.equal(page.pending(), 0);
    assert.equal(page.calls.matchMedia + page.calls.reads + page.calls.timers, 0);
  });

  it('the first screen and anything a refresh adds do not move; a screen someone moves to does, written once', async () => {
    const page = stage();
    const { motion, setMotionDirection, movingCount } = await load();
    const first = element();
    motion(first, { role: 'question', type: 'single-select' });
    assert.equal(first.dataset.motion, undefined, 'no direction: the first screen is shown as it is');
    setMotionDirection('forward');
    const question = element();
    const options = [0, 1, 2, 3].map(() => element());
    motion(question, { role: 'question', type: 'single-select' });
    options.forEach((node, index) => motion(node, { role: 'options', type: 'single-select', index, count: 4 }));
    assert.equal(question.dataset.motion, 'from-right');
    assert.deepEqual(options.map((node) => node.dataset.motion), ['from-left', 'from-right', 'from-left', 'from-right']);
    assert.equal(question.style.props.get('--m-duration'), 'var(--motion-duration-base)', 'a token, never a number');
    assert.ok(options[3].style.props.get('--m-delay') > options[1].style.props.get('--m-delay'));
    assert.equal(movingCount(), 5);
    page.frame();
    page.frame();
    const late = element();
    motion(late, { role: 'options', type: 'single-select', index: 4, count: 5 });
    assert.equal(late.dataset.motion, undefined, 'two frames on, the moment is over: a refresh does not replay it');
    assert.equal(page.calls.timers, 0, 'no timer');
  });

  it(`no more than ${MAX_CONCURRENT} move at once; the rest appear without motion`, async () => {
    stage();
    const { motion, setMotionDirection, movingCount } = await load();
    setMotionDirection('jump');
    const nodes = Array.from({ length: MAX_CONCURRENT + 6 }, () => element());
    nodes.forEach((node, index) => motion(node, { role: 'item', index, count: nodes.length }));
    assert.equal(movingCount(), MAX_CONCURRENT);
    assert.equal(nodes.filter((node) => node.dataset.motion).length, MAX_CONCURRENT);
  });

  it('an animation that ends or is cancelled takes its attribute with it; an element that leaves is forgotten; a hidden tab finishes all', async () => {
    const page = stage();
    const { motion, setMotionDirection, movingCount } = await load();
    setMotionDirection('jump');
    const [a, b, c, d] = [0, 1, 2, 3].map(() => element());
    const actions = [a, b, c, d].map((node, index) => motion(node, { role: 'item', index, count: 4 }));
    page.fire('animationend', { target: a, animationName: 'motion-rise' });
    assert.equal(a.dataset.motion, undefined);
    page.fire('animationend', { target: b, animationName: 'some-other' });
    assert.equal(b.dataset.motion, 'rise', 'only its own animation ends it');
    page.fire('animationcancel', { target: b, animationName: 'motion-rise' });
    assert.equal(b.dataset.motion, undefined);
    actions[2].destroy();
    assert.equal(movingCount(), 1);
    document.hidden = true;
    page.fire('visibilitychange');
    assert.equal(movingCount(), 0);
    assert.equal(d.dataset.motion, undefined);
    document.hidden = false;
    const after = element();
    motion(after, { role: 'item' });
    assert.equal(after.dataset.motion, undefined, 'coming back shows the settled screen, it does not start a moment');
    assert.equal(page.listenerCount(), 3, 'three listeners on the document, put there once');
  });

  it('the client\'s switch off: nothing moves and the level "none" is written where it is told; on again, it moves', async () => {
    stage();
    const { motion, setMotionDirection, setMotionEnabled, motionLevel } = await load();
    const frame = element();
    setMotionEnabled(false, frame);
    assert.equal(frame.dataset.motionLevel, 'none');
    assert.equal(motionLevel(), 'none');
    setMotionDirection('forward');
    const node = element();
    motion(node, { role: 'question', type: 'true-false' });
    assert.equal(node.dataset.motion, undefined);
    setMotionEnabled(true, frame);
    assert.equal(frame.dataset.motionLevel, 'full');
    setMotionDirection('forward');
    const again = element();
    motion(again, { role: 'question', type: 'true-false' });
    assert.equal(again.dataset.motion, 'from-right');
    setMotionEnabled('garbage');
    assert.equal(motionLevel(), 'full', 'a strange value means on');
    assert.equal(document.documentElement.dataset.motionLevel, 'full', 'by default the level goes on the page\'s root');
  });

  it('the device asking for reduced motion wins over a switch that is on', async () => {
    stage({ reduced: true });
    const { motion, setMotionDirection, setMotionEnabled, motionLevel } = await load();
    setMotionEnabled(true);
    assert.equal(motionLevel(), 'none');
    assert.equal(document.documentElement.dataset.motionLevel, 'none');
    setMotionDirection('jump');
    const node = element();
    motion(node, { role: 'card' });
    assert.equal(node.dataset.motion, undefined);
  });

  it('a verdict moves the answer once per change, and not at all when motion is off', async () => {
    stage();
    const { motion, setMotionEnabled } = await load();
    const node = element();
    const action = motion(node, { role: 'options', type: 'single-select', index: 0, count: 2 });
    assert.equal(node.dataset.motion, undefined);
    action.update({ role: 'options', verdict: 'incorrect' });
    assert.equal(node.dataset.motion, 'nudge');
    delete node.dataset.motion;
    action.update({ role: 'options', verdict: 'incorrect' });
    assert.equal(node.dataset.motion, undefined, 'the same verdict again (a refresh) does not move it');
    action.update({ role: 'options', verdict: null });
    action.update({ role: 'options', verdict: 'correct' });
    assert.equal(node.dataset.motion, 'pop');
    setMotionEnabled(false);
    const other = element();
    motion(other, { role: 'options' }).update({ role: 'options', verdict: 'correct' });
    assert.equal(other.dataset.motion, undefined);
  });

  it('the governor watches the first entrances only, steps down on dropped frames, keeps it for the session and leaves nothing running', async () => {
    const storage = new Map();
    const page = stage({ storage });
    const engine = await load();
    const entrance = (gaps) => {
      engine.setMotionDirection('forward');
      engine.motion(element(), { role: 'question', type: 'single-select' });
      for (const gap of gaps) page.frame(gap);
      let guard = 0;
      while (page.pending() && guard < 200) { page.frame(16.7); guard += 1; }
    };
    const rough = [16.7, 16.7, 80, 90, 70, 60, ...Array(60).fill(16.7)];
    entrance(rough);
    assert.equal(engine.motionLevel(), 'full', 'one rough entrance is not enough');
    entrance(rough);
    assert.equal(engine.motionLevel(), 'reduced');
    assert.equal(JSON.parse(storage.get('pms.motion')).level, 'reduced', 'kept for the session');
    assert.equal(page.pending(), 0, 'no frame callback left at idle');
    const fresh = await load();
    stage({ storage });
    assert.equal(fresh.motionLevel(), 'reduced', 'a reload in the same session starts where it was');
    const watched = page.calls.frames;
    assert.ok(watched < (WATCH_WINDOW / 16.7) * 3, `the windows are bounded (${watched} frames)`);
  });

  it('three smooth entrances and the governor stops watching: later entrances schedule only the moment\'s two frames', async () => {
    const page = stage();
    const engine = await load();
    const entrance = () => {
      engine.setMotionDirection('forward');
      engine.motion(element(), { role: 'question', type: 'single-select' });
      let guard = 0;
      while (page.pending() && guard < 200) { page.frame(16.7); guard += 1; }
    };
    for (let count = 0; count < 3; count += 1) entrance();
    const before = page.calls.frames;
    entrance();
    assert.equal(page.calls.frames - before, 2, 'just the two frames that close the moment');
    assert.equal(engine.motionLevel(), 'full');
  });

  it('?motion=off: no motion for the session, even after the address changes', async () => {
    const storage = new Map();
    stage({ search: '?motion=off', storage });
    const engine = await load();
    assert.equal(engine.motionLevel(), 'none');
    assert.equal(storage.get('pms.motion.off'), '1');
    stage({ search: '', storage });
    const later = await load();
    assert.equal(later.motionLevel(), 'none');
  });

  it('a browser without matchMedia, or whose storage throws, still works (and moves)', async () => {
    stage({ noMatchMedia: true, brokenStorage: true });
    const engine = await load();
    assert.equal(engine.motionLevel(), 'full');
    engine.setMotionDirection('jump');
    const node = element();
    engine.motion(node, { role: 'title' });
    assert.equal(node.dataset.motion, 'rise');
  });
});
