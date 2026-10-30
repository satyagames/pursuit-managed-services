import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DIRECTIONS, ENTRANCE_BUDGET, LEVELS, LONG_LABEL, MAX_CONCURRENT, QUESTION_TYPES, ROLES, SHAPES, TOKENS,
  asLevel, capSteps, diagnosticOff, entranceLength, governorStep, lowerLevel, motionRecipe, readGovernor, recipeEnd, resolveLevel,
  staggerSteps, startGovernor, stepFor,
} from '../migration/src/lib/motion/motion-plan.js';
import { META } from '../migration/src/lib/schema/pms-schema-meta.js';

// Phase 15, part 2: the motion plan, which needs no browser. The table is whole (every moment, kind of question and part of a screen has a
// recipe that names a real shape and real tokens), the answers of each kind come from the sides the brief asks, Back mirrors forward, the
// stagger is capped and the whole entrance of any question (1 to 12 options) stays within the budget, 'none' and the device's reduced
// motion give nothing at all and win over the client's switch, the governor only ever steps down, and the tokens in the CSS are the plan's.
// Where the motion is carried out (lib/motion/motion.ts) is scripts/test-motion-engine.js; in a browser, motion-types.spec.ts.

const root = path.join(import.meta.dirname, '..');
const tokensCss = () => readFile(path.join(root, 'migration/src/lib/motion/motion-tokens.css'), 'utf8');
const OPTION_COUNTS = Array.from({ length: 12 }, (_, index) => index + 1);
const DIRECTED = DIRECTIONS.filter((direction) => direction !== 'none');

describe('the plan is whole', () => {
  it('names every kind of question the schema allows, no more and no fewer', () => {
    assert.deepEqual([...QUESTION_TYPES].sort(), [...META.questions.columns.QuestionType.values].sort());
    assert.equal(QUESTION_TYPES.length, 7); // (6 until Prompt 23)
  });

  it('every moment x kind x part x direction at the full level resolves to a real shape and real tokens, or to nothing', () => {
    let moving = 0;
    for (const type of QUESTION_TYPES) for (const role of ROLES) for (const direction of DIRECTED) for (const count of [1, 2, 5, 12]) for (let index = 0; index < count; index += 1) {
      const recipe = motionRecipe({ type, role, index, count, direction, level: 'full' });
      if (!recipe) continue;
      moving += 1;
      assert.ok(SHAPES.includes(recipe.shape) && recipe.shape !== 'none', `${type}/${role}: shape ${recipe.shape}`);
      assert.ok(recipe.duration in TOKENS.duration, `${type}/${role}: duration ${recipe.duration}`);
      assert.ok(recipe.ease in TOKENS.ease, `${type}/${role}: ease ${recipe.ease}`);
      assert.ok(recipe.distance in TOKENS.distance, `${type}/${role}: distance ${recipe.distance}`);
      assert.ok(Number.isFinite(recipe.delay) && recipe.delay >= 0, `${type}/${role}: delay ${recipe.delay}`);
    }
    assert.ok(moving > 500, `${moving} recipes move`);
    for (const verdict of ['correct', 'incorrect', 'revealed']) {
      const recipe = motionRecipe({ moment: 'verdict', role: 'options', verdict, level: 'full' });
      assert.ok(recipe && SHAPES.includes(recipe.shape), verdict);
      assert.ok(TOKENS.duration[recipe.duration] >= 120 && TOKENS.duration[recipe.duration] <= 220, `feedback is 120 to 220 ms (${verdict})`);
    }
  });

  it('entrances are 180 to 450 ms each; only a pop overshoots', () => {
    for (const type of QUESTION_TYPES) for (const role of ROLES) {
      const recipe = motionRecipe({ type, role, direction: 'jump' });
      if (!recipe) continue;
      const ms = TOKENS.duration[recipe.duration];
      assert.ok(ms >= 180 && ms <= 450, `${type}/${role}: ${ms} ms`);
      assert.notEqual(recipe.ease, 'pop', `${type}/${role} arrives without overshoot`);
    }
    const overshoots = Object.entries(TOKENS.ease).filter(([, curve]) => curve[1] > 1 || curve[3] > 1).map(([name]) => name);
    assert.deepEqual(overshoots, ['pop']);
  });
});

describe('by kind of question', () => {
  const sides = (type, count, direction = 'forward') => Array.from({ length: count }, (_, index) => motionRecipe({ role: 'options', type, index, count, direction })?.shape);

  it('single-select, multi-select and ranked-voting: the answers alternate in from the left and the right, staggered', () => {
    for (const type of ['single-select', 'multi-select', 'ranked-voting']) {
      assert.deepEqual(sides(type, 4), ['from-left', 'from-right', 'from-left', 'from-right'], type);
      const delays = Array.from({ length: 4 }, (_, index) => motionRecipe({ role: 'options', type, index, count: 4, direction: 'forward' }).delay);
      assert.ok(delays.every((delay, index) => index === 0 || delay > delays[index - 1]), `${type}: one after another (${delays})`);
    }
  });

  it('true-false: the two choices converge from opposite sides at once', () => {
    assert.deepEqual(sides('true-false', 2), ['converge-left', 'converge-right']);
    const [a, b] = [0, 1].map((index) => motionRecipe({ role: 'options', type: 'true-false', index, count: 2, direction: 'forward' }));
    assert.equal(a.delay, b.delay, 'no stagger');
  });

  it('confidence-continuum: the steps come in from the left, low to high, in order', () => {
    assert.deepEqual(sides('confidence-continuum', 5), Array(5).fill('from-left'));
    const delays = Array.from({ length: 5 }, (_, index) => motionRecipe({ role: 'options', type: 'confidence-continuum', index, count: 5, direction: 'forward' }).delay);
    assert.deepEqual([...delays].sort((x, y) => x - y), delays);
  });

  it('open-text-feedback: the box rises into place', () => {
    assert.equal(motionRecipe({ role: 'options', type: 'open-text-feedback', direction: 'forward' }).shape, 'rise');
  });

  it('the question comes from the side the person is going to; from the hub it rises', () => {
    assert.equal(motionRecipe({ role: 'question', type: 'single-select', direction: 'forward' }).shape, 'from-right');
    assert.equal(motionRecipe({ role: 'question', type: 'single-select', direction: 'back' }).shape, 'from-left');
    assert.equal(motionRecipe({ role: 'question', type: 'single-select', direction: 'jump' }).shape, 'rise');
  });

  it('Back is forward mirrored, part for part', () => {
    const flip = { 'from-left': 'from-right', 'from-right': 'from-left', 'converge-left': 'converge-right', 'converge-right': 'converge-left' };
    for (const type of QUESTION_TYPES) for (const role of ROLES) for (const count of [1, 3, 8]) for (let index = 0; index < count; index += 1) {
      const forward = motionRecipe({ type, role, index, count, direction: 'forward' });
      const back = motionRecipe({ type, role, index, count, direction: 'back' });
      assert.equal(Boolean(forward), Boolean(back), `${type}/${role}`);
      if (!forward) continue;
      assert.equal(back.shape, flip[forward.shape] ?? forward.shape, `${type}/${role}/${index}`);
      assert.equal(back.delay, forward.delay);
      assert.equal(back.duration, forward.duration);
    }
  });

  it('a verdict: right pops, wrong is nudged sideways, a revealed answer pops once', () => {
    assert.equal(motionRecipe({ moment: 'verdict', role: 'options', verdict: 'correct' }).shape, 'pop');
    assert.equal(motionRecipe({ moment: 'verdict', role: 'options', verdict: 'incorrect' }).shape, 'nudge');
    assert.equal(motionRecipe({ moment: 'verdict', role: 'options', verdict: 'revealed' }).shape, 'pop');
    assert.equal(motionRecipe({ moment: 'verdict', role: 'options' }), null, 'no verdict, no motion');
  });

  it('a long answer travels less', () => {
    assert.equal(motionRecipe({ role: 'options', type: 'single-select', direction: 'forward' }).distance, 'far');
    assert.equal(motionRecipe({ role: 'options', type: 'single-select', direction: 'forward', long: true }).distance, 'near');
    assert.ok(LONG_LABEL >= 40 && LONG_LABEL <= 120);
  });
});

describe('stagger and the budget', () => {
  it('two answers and nine get different steps, both inside the cap; a narrow screen gets a shorter step', () => {
    assert.ok(stepFor(2) > stepFor(9), `${stepFor(2)} vs ${stepFor(9)}`);
    assert.equal(stepFor(1), 1);
    assert.ok(stepFor(12) >= TOKENS.staggerMin);
    assert.ok(stepFor(5, { narrow: true }) < stepFor(5));
    for (const count of OPTION_COUNTS) for (let index = 0; index < count; index += 1) assert.ok(staggerSteps(index, count) <= capSteps() + 1e-9, `${index}/${count}`);
    assert.equal(staggerSteps(50, 60), capSteps(), 'past the cap the rest come in together');
  });

  it(`the whole entrance of every kind of question, 1 to 12 answers, every direction, ends within ${ENTRANCE_BUDGET} ms`, () => {
    let worst = 0;
    for (const type of QUESTION_TYPES) for (const count of OPTION_COUNTS) for (const direction of DIRECTED) for (const narrow of [false, true]) {
      const length = entranceLength(type, count, { direction, narrow });
      worst = Math.max(worst, length);
      assert.ok(length <= ENTRANCE_BUDGET, `${type}, ${count} options, ${direction}${narrow ? ', narrow' : ''}: ${length} ms`);
      assert.ok(length >= 180, `${type} ${count} ${direction}: it does move (${length} ms)`);
    }
    console.log(`  the longest entrance: ${worst} ms (budget ${ENTRANCE_BUDGET} ms)`);
  });

  it('every part of a screen settles on the same frame (each separate end of a transform animation costs Chromium a layout)', () => {
    for (const type of QUESTION_TYPES) for (const count of OPTION_COUNTS) for (const direction of DIRECTED) {
      const parts = [motionRecipe({ role: 'question', type, count, direction }), ...(direction === 'jump' ? [motionRecipe({ role: 'title', type, count, direction }), motionRecipe({ role: 'rule', type, count, direction })] : [])];
      for (let index = 0; index < count; index += 1) parts.push(motionRecipe({ role: 'options', type, index, count, direction }));
      const ends = new Set(parts.filter(Boolean).map((recipe) => Math.round(recipeEnd(recipe))));
      assert.equal(ends.size, 1, `${type}, ${count}, ${direction}: ends at ${[...ends]}`);
      assert.equal([...ends][0], Math.round(entranceLength(type, count, { direction })), 'at the end of the entrance, not later');
    }
    for (const count of [1, 4, 9]) {
      const parts = [motionRecipe({ role: 'title', count }), motionRecipe({ role: 'rule', count }), ...Array.from({ length: count }, (_, index) => motionRecipe({ role: 'item', index, count }))];
      assert.equal(new Set(parts.map((recipe) => Math.round(recipeEnd(recipe)))).size, 1, `the hub with ${count} activities`);
    }
    assert.equal(motionRecipe({ role: 'card' }).stretch, undefined, 'a card is alone on its screen');
  });

  it('no more than the cap of things move at once, and the cap leaves room for a full question', () => {
    assert.ok(MAX_CONCURRENT >= 12 + 4 && MAX_CONCURRENT <= 24, `cap ${MAX_CONCURRENT}`);
  });

  it('recipeEnd is the delay in steps plus the duration', () => {
    assert.equal(recipeEnd(null), 0);
    assert.equal(recipeEnd({ shape: 'rise', duration: 'base', ease: 'enter', delay: 2, distance: 'near' }), 2 * TOKENS.stagger + TOKENS.duration.base);
  });
});

describe('levels', () => {
  it('none, the device asking for reduced motion and a client switch that is off give no motion at all, for everything', () => {
    for (const level of [resolveLevel({ enabled: false }), resolveLevel({ reduced: true }), resolveLevel({ diagnostic: true }), 'none']) {
      assert.equal(level, 'none');
      for (const type of QUESTION_TYPES) for (const role of ROLES) for (const direction of DIRECTIONS) {
        assert.equal(motionRecipe({ type, role, direction, level }), null, `${type}/${role}/${direction}`);
        assert.equal(motionRecipe({ moment: 'verdict', role, verdict: 'correct', level }), null);
      }
    }
  });

  it('the device always wins: a client switch that is on cannot bring motion back under reduced motion', () => {
    assert.equal(resolveLevel({ enabled: true, reduced: true }), 'none');
    assert.equal(resolveLevel({ enabled: true, reduced: false }), 'full');
    assert.equal(resolveLevel({ enabled: true, governor: 'reduced' }), 'reduced');
    assert.equal(resolveLevel({ enabled: false, governor: 'full' }), 'none');
  });

  it('a missing or strange switch value means on (fail safe); only false turns it off', () => {
    for (const value of [undefined, null, true, 'false', 0, 'off', {}, []]) assert.equal(resolveLevel({ enabled: value }), 'full', String(value));
    assert.equal(resolveLevel({ enabled: false }), 'none');
  });

  it('reduced only fades: opacity, quickly, no stagger; a verdict does not move at all', () => {
    for (const type of QUESTION_TYPES) for (const role of ROLES) {
      const recipe = motionRecipe({ type, role, index: 3, count: 6, direction: 'forward', level: 'reduced' });
      if (recipe) assert.deepEqual(recipe, { shape: 'fade', duration: 'quick', ease: 'standard', delay: 0, distance: 'near' });
    }
    assert.equal(motionRecipe({ moment: 'verdict', role: 'options', verdict: 'correct', level: 'reduced' }), null);
  });

  it('a first paint or a refresh (direction none) moves nothing', () => {
    for (const type of QUESTION_TYPES) for (const role of ROLES) assert.equal(motionRecipe({ type, role, direction: 'none' }), null);
  });

  it('levels order and parse', () => {
    assert.deepEqual([...LEVELS], ['none', 'reduced', 'full']);
    assert.equal(lowerLevel('full', 'reduced'), 'reduced');
    assert.equal(lowerLevel('none', 'full'), 'none');
    assert.equal(asLevel('reduced'), 'reduced');
    assert.equal(asLevel('fast'), 'full');
  });

  it('?motion=off is read from the address, and nothing else is', () => {
    assert.equal(diagnosticOff('?motion=off'), true);
    assert.equal(diagnosticOff('?t=abc&motion=off'), true);
    assert.equal(diagnosticOff('?motion=offline'), false);
    assert.equal(diagnosticOff('?motion=on'), false);
    assert.equal(diagnosticOff(''), false);
  });
});

describe('the governor', () => {
  const smooth = Array(40).fill(16.7);
  const rough = [80, 70, ...Array(10).fill(16.7), 60, 70, 90, 16.7];

  it('two rough entrances step the level down one; it never steps up; at none it stops watching', () => {
    let state = startGovernor();
    state = governorStep(state, rough);
    assert.equal(state.level, 'full', 'one rough entrance is not enough');
    state = governorStep(state, rough);
    assert.equal(state.level, 'reduced');
    state = governorStep(governorStep(state, rough), rough);
    assert.equal(state.level, 'none');
    assert.equal(state.watching, false);
    assert.deepEqual(governorStep(state, smooth), state, 'nothing changes once it has stopped');
  });

  it('the first two frames of an entrance (the new screen being drawn) are not held against it', () => {
    const state = governorStep(governorStep(startGovernor(), [300, 120, ...Array(30).fill(16.7)]), [300, 120, ...Array(30).fill(16.7)]);
    assert.equal(state.level, 'full');
  });

  it('three smooth entrances and it stops watching for the session', () => {
    let state = startGovernor();
    for (let entrance = 0; entrance < 3; entrance += 1) state = governorStep(state, smooth);
    assert.equal(state.watching, false);
    assert.equal(state.level, 'full');
    assert.deepEqual(governorStep(state, rough), state);
  });

  it('what sessionStorage holds is read back, and anything else is a fresh start', () => {
    assert.deepEqual(readGovernor(JSON.stringify({ level: 'reduced', bad: 1, clean: 2, watching: true })), { level: 'reduced', bad: 1, clean: 2, watching: true });
    for (const text of [null, '', '{', 'null', '42', '{"level":"warp"}']) assert.equal(readGovernor(text).level, 'full', String(text));
    assert.equal(readGovernor(JSON.stringify({ level: 'none' })).watching, false);
  });
});

describe('the tokens', () => {
  const ms = (text) => (text.endsWith('ms') ? Number(text.slice(0, -2)) : Number(text.slice(0, -1)) * 1000);

  it('the CSS declares exactly the plan\'s durations, curves, stagger and distances', async () => {
    const css = await tokensCss();
    const declared = Object.fromEntries([...css.matchAll(/(--motion-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
    for (const [name, value] of Object.entries(TOKENS.duration)) assert.equal(ms(declared[`--motion-duration-${name}`]), value, `duration ${name}`);
    for (const [name, curve] of Object.entries(TOKENS.ease)) assert.equal(declared[`--motion-ease-${name}`], `cubic-bezier(${curve.join(', ')})`, `ease ${name}`);
    assert.equal(ms(declared['--motion-stagger']), TOKENS.stagger);
    assert.equal(ms(declared['--motion-stagger-cap']), TOKENS.staggerCap);
    for (const [name, value] of Object.entries(TOKENS.distance)) assert.equal(declared[`--motion-distance-${name}`], value, `distance ${name}`);
    assert.equal(declared['--motion-nudge'], TOKENS.nudge);
  });

  it('every shape the plan names has its keyframes and its rule in the CSS, and the CSS has no shape the plan does not know', async () => {
    const css = await tokensCss();
    for (const shape of SHAPES.filter((name) => name !== 'none')) {
      assert.match(css, new RegExp(`@keyframes motion-${shape}\\s*\\{`), `keyframes of ${shape}`);
      assert.match(css, new RegExp(`\\[data-motion='${shape}'\\]`), `rule for ${shape}`);
    }
    const named = [...css.matchAll(/@keyframes motion-([\w-]+)/g)].map((match) => match[1]);
    assert.deepEqual(named.filter((name) => !SHAPES.includes(name)), []);
  });

  it('the shapes animate transform and opacity only (the compositor\'s), never a box\'s size, place, filter or shadow', async () => {
    const css = await tokensCss();
    for (const match of css.matchAll(/@keyframes ([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
      const properties = [...match[2].matchAll(/([a-z-]+)\s*:/g)].map((entry) => entry[1]);
      assert.deepEqual([...new Set(properties)].filter((property) => !['transform', 'opacity'].includes(property)), [], match[1]);
    }
  });

  it('the shapes fill backwards only, so an element\'s own style is its end state and nothing is left behind', async () => {
    const css = await tokensCss();
    assert.match(css, /animation-fill-mode:\s*backwards/);
    assert.doesNotMatch(css, /animation-fill-mode:\s*(forwards|both)/);
    assert.doesNotMatch(css, /will-change/, 'no will-change: the compositor promotes a running transform or opacity animation by itself, and an idle one costs memory');
  });
});

// ---- The guard: no duration, delay or easing outside the plan and the tokens ------------------------------------------------------

/**
 * Files of the participant page and its shared components that still declare a time or a curve, each with its reason. Nothing new may join
 * this list without one; motion goes through the tokens.
 */
const ALLOWED = new Map([
  ['migration/src/lib/motion/motion-tokens.css', 'the tokens themselves'],
  ['migration/src/lib/motion/motion-plan.js', 'the plan (its numbers are the tokens, held equal to the CSS above)'],
  ['migration/src/styles/legacy/admin.css', "the legacy admin sheet (only the admin and Setup pages load it; restyled by overriding, never edited)"],
]);
/** Folders of pages and tools that are not the participant's: their own motion is not this plan's. */
const OUTSIDE = ['migration/src/admin/', 'migration/src/setup/', 'migration/src/dev/', 'migration/src/unsupported/', 'migration/src/lib/admin/', 'migration/src/lib/setup/', 'migration/src/lib/results/', 'migration/src/lib/exports/', 'migration/src/admin.css', 'migration/src/setup.css', 'migration/src/AdminApp.svelte', 'migration/src/SetupApp.svelte'];

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await sources(rel));
    else if (/\.(svelte|css|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

/** The CSS of a file: a .css file whole, a .svelte file's <style> blocks, and a .ts file's template strings that hold CSS (a style attribute). */
function cssOf(file, text) {
  if (file.endsWith('.css')) return text;
  if (file.endsWith('.svelte')) return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
  return '';
}

/** Times and curves declared in CSS: `160ms`, `0.2s`, `cubic-bezier(`, and the keyword easings inside a transition or an animation. */
function motionValues(css) {
  const found = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)(?![\w-])/g)) found.push(match[0]);
  if (/cubic-bezier\(/.test(clean)) found.push('cubic-bezier');
  for (const match of clean.matchAll(/(?:transition|animation)(?:-timing-function)?\s*:[^;]*?(?<![\w-])(ease-in-out|ease-in|ease-out|ease|linear|steps\()(?![\w-])/g)) found.push(match[1]);
  return found;
}

describe('the guard', () => {
  it('no participant file declares a duration, a delay or a curve: they name the tokens (lib/motion/motion-tokens.css)', async () => {
    const files = (await sources('migration/src')).filter((file) => !OUTSIDE.some((prefix) => file.startsWith(prefix)));
    assert.ok(files.length > 30, `${files.length} files read`);
    const offenders = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const text = await readFile(path.join(root, file), 'utf8');
      const values = motionValues(cssOf(file, text));
      if (values.length) offenders.push(`${file}: ${[...new Set(values)].join(', ')}`);
      if (/\.animate\(\s*[[{]/.test(text) && !file.endsWith('lib/motion/motion.ts')) offenders.push(`${file}: element.animate()`);
    }
    assert.deepEqual(offenders, []);
    for (const [file, reason] of ALLOWED) assert.ok(reason.length > 10, file);
  });

  it('the guard can fail: a time, a curve and a keyword easing are each found', () => {
    assert.deepEqual(motionValues('.x { transition: transform 160ms ease; }'), ['160ms', 'ease']);
    assert.deepEqual(motionValues('.x { animation: spin 0.4s cubic-bezier(0, 0, 1, 1); }'), ['0.4s', 'cubic-bezier']);
    assert.deepEqual(motionValues('.x { transition: opacity var(--motion-duration-quick) var(--motion-ease-standard); }'), []);
    assert.deepEqual(motionValues('/* 300ms */ .x { margin: 2rem; }'), []);
    assert.deepEqual(cssOf('a.svelte', '<script>const t = 300;</script><style>.a { transition: width 300ms ease; }</style>').includes('300ms'), true);
  });
});
