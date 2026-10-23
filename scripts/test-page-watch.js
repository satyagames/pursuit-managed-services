// Phase 11a-3, item F: the page watcher and the network coming back. Run: node --test scripts/test-page-watch.js (also part of npm test and
// npm run test:polling)
//
// participant.spec.ts:91 failed now and then in Chromium: the facilitator restarts an activity, the test says the network came back ('online'), and
// "Question A" was not on the screen within 5 seconds. On the local server the page looks every 3 seconds; when one of those looks was already on its
// way (and had read the track before the restart was stamped), lib/common/page-watch.ts dropped the 'online' as "a check already running is not doubled",
// and the page learned of the restart only at the next look. On a real iPad the same: a network that comes back while a look is waiting (likely to
// fail, and then to back off) was ignored. Now a look that the network coming back asks for while another is on its way is made as soon as that one
// ends. Phase 19: a timer that found the page not to be checked (`enabled()` false: a preview, still starting, an error screen, a Live display not
// on show) skipped the look without awaiting anything, so the look ended before `running` was set to it and stayed "on its way" for good: no look
// and no timer after it. This drives the real lib/common/page-watch.ts (made plain JS by Vite's esbuild) with a stand-in window and its own timers.

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { transformWithEsbuild } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
let folder;
let createPageWatcher;


/** A stand-in window and document: events by name, timers that run only when the test says so. */
function stage() {
  const listeners = new Map();
  const timers = new Map();
  let next = 1;
  const on = (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]);
  const off = (name, fn) => listeners.set(name, (listeners.get(name) ?? []).filter((entry) => entry !== fn));
  globalThis.window = {
    setTimeout: (fn, wait) => { const id = next++; timers.set(id, { fn, wait }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: on,
    removeEventListener: off,
  };
  globalThis.document = { hidden: false, addEventListener: on, removeEventListener: off };
  return {
    fire: (name) => { for (const fn of listeners.get(name) ?? []) fn(); },
    timers,
    /** Runs the timers that are due within `wait` ms (the watcher's own timer). */
    runDue: (wait) => { for (const [id, timer] of [...timers]) if (timer.wait <= wait) { timers.delete(id); timer.fn(); } },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('the page watcher and the network coming back', () => {
  // (Inside the describe: with Node 20 a hook at the top of the file does not run before a describe's tests.)
  before(async () => {
    const source = await readFile(path.join(ROOT, 'migration/src/lib/common/page-watch.ts'), 'utf8');
    const { code } = await transformWithEsbuild(source, 'page-watch.ts', { loader: 'ts', format: 'esm' });
    const schedule = pathToFileURL(path.join(ROOT, 'migration/src/lib/common/poll-schedule.js')).href;
    folder = await mkdtemp(path.join(os.tmpdir(), 'pms-page-watch-'));
    const file = path.join(folder, 'page-watch.mjs');
    await writeFile(file, code.replace(/from ['"]\.\/poll-schedule\.js['"]/, `from '${schedule}'`));
    ({ createPageWatcher } = await import(pathToFileURL(file).href));
  });
  after(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

  it('looks at once when the network comes back and nothing is being looked at', async () => {
    const page = stage();
    let checks = 0;
    const watcher = createPageWatcher({ check: async () => { checks += 1; }, wait: () => 60_000 });
    watcher.start();
    page.fire('online');
    await settle();
    assert.equal(checks, 1);
    watcher.stop();
  });

  it('when the network comes back while a look is on its way, looks again as soon as that one ends, without waiting out a whole wait', async () => {
    const page = stage();
    const pending = [];
    const watcher = createPageWatcher({ check: () => new Promise((resolve) => pending.push(resolve)), wait: () => 60_000 });
    watcher.start();
    void watcher.checkNow(); // the timer's look, on its way
    assert.equal(pending.length, 1);
    page.fire('online'); // the facilitator restarted the activity; the network comes back
    await settle();
    assert.equal(pending.length, 1, 'never two looks at once');
    pending[0]();
    await settle();
    page.runDue(0); // a look asked for "as soon as that one ends" is due at once (a wait of 0), never one of 60 s
    await settle();
    assert.equal(pending.length, 2, 'a second look follows the first at once');
    pending[1]();
    await settle();
    page.runDue(0);
    await settle();
    assert.equal(pending.length, 2, 'and only one: after it the usual wait');
    assert.deepEqual([...page.timers.values()].map((timer) => timer.wait), [60_000]);
    watcher.stop();
  });

  it('a look skipped while the page cannot be checked leaves the timer running: the next one looks', async () => {
    const page = stage();
    let checks = 0;
    let enabled = false;
    const watcher = createPageWatcher({ check: async () => { checks += 1; }, enabled: () => enabled, wait: () => 60_000 });
    watcher.start();
    page.runDue(60_000); // still starting: skipped
    await settle();
    assert.equal(checks, 0);
    assert.deepEqual([...page.timers.values()].map((timer) => timer.wait), [60_000], 'the skipped look schedules the next');
    enabled = true;
    page.runDue(60_000);
    await settle();
    assert.equal(checks, 1, 'the next timer looks');
    await watcher.checkNow();
    assert.equal(checks, 2, 'and so does a look asked for');
    watcher.stop();
  });
});
