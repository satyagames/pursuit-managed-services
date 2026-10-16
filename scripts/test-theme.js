import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  ACCENT_TOKENS, CONTROL_TOKENS, DANGER_HUE_MARGIN, DEFAULT_PRIMARY, MIN_GRAPHIC_CONTRAST, MIN_TEXT_CONTRAST, SURFACE_ALPHA,
  applyTheme, compositeOver, contrastRatio, dangerHueDistance, deriveTheme, hueOf, isNearDangerHue, normalizeHex, relativeLuminance, resetTheme,
} from '../migration/src/lib/theme.js';

const WHITE = '#FFFFFF';
const HEX6 = /^#[0-9A-F]{6}$/;

/** The palette in PMS-IMPLEMENTATION-PLAN.md 2.2 (in git history at 7347c72), with the contrast fixes the plan prescribes. */
const MOCKUP_TOKENS = {
  '--bg-top': '#000102',
  '--bg-mid': '#045BCC',
  '--bg-bottom': '#0444A8',
  '--surface': 'rgb(255 255 255 / 0.14)',
  '--surface-border': '#FFFFFF',
  '--action': '#296CD4',
  '--action-border': 'rgb(255 255 255 / 0.7)',
  '--success': '#09FF53',
  '--on-success': '#000000',
  '--danger': '#E00000',
  '--danger-tint': '#4F3982',
  '--disabled': '#034CB5',
  '--on-disabled': '#4D80D0',
  '--focus': '#86BC25',
  '--progress': '#86BC25',
  '--accent-rule': '#FFFFFF',
  '--accent-ring': 'rgb(255 255 255 / 0)',
};
const NO_RING = MOCKUP_TOKENS['--accent-ring'];

/** White text on the pill/tile overlay at the lightest point of the gradient, and on the CTA. */
function assertReadable(primary, accent) {
  const theme = deriveTheme(primary, accent);
  const { tokens } = theme;
  for (const name of ['--bg-top', '--bg-mid', '--bg-bottom', '--action', '--disabled', '--on-disabled']) {
    assert.match(tokens[name], HEX6, `${name} for ${primary}`);
  }
  for (const background of [tokens['--bg-mid'], tokens['--bg-bottom']]) {
    const surface = contrastRatio(WHITE, compositeOver(WHITE, SURFACE_ALPHA, background));
    assert.ok(surface >= MIN_TEXT_CONTRAST, `white on surface over ${background} is ${surface.toFixed(2)} for primary ${primary}`);
  }
  const action = contrastRatio(WHITE, tokens['--action']);
  assert.ok(action >= MIN_TEXT_CONTRAST, `white on action ${tokens['--action']} is ${action.toFixed(2)} for ${primary}/${accent}`);
  // The reported figures are the real ones, not a stale copy.
  assert.ok(theme.contrast.surface >= MIN_TEXT_CONTRAST && theme.contrast.action >= MIN_TEXT_CONTRAST);
  assert.ok(Math.abs(theme.contrast.action - action) < 1e-9);
  return theme;
}

test('contrastRatio matches the WCAG definition at the extremes and for known pairs', () => {
  assert.equal(contrastRatio('#000000', WHITE), 21);
  assert.equal(contrastRatio(WHITE, '#000000'), 21, 'order does not matter');
  assert.equal(contrastRatio('#336699', '#336699'), 1);
  assert.equal(contrastRatio('#fff', '#000'), 21, 'short hex works');
  // Figures quoted in the implementation plan (2.2).
  const rounded = (a, b) => Number(contrastRatio(a, b).toFixed(1));
  assert.equal(rounded(WHITE, '#296CD4'), 5.0);
  assert.equal(rounded('#000000', '#09FF53'), 15.4);
  assert.equal(rounded(WHITE, '#E00000'), 5.0);
  assert.equal(rounded(WHITE, '#FF0000'), 4.0, 'the mockup red fails AA, which is why --danger is #E00000');
  assert.equal(rounded(WHITE, compositeOver(WHITE, 0.2, DEFAULT_PRIMARY)), 4.2, 'the mockup overlay fails AA');
  assert.equal(rounded(WHITE, compositeOver(WHITE, SURFACE_ALPHA, DEFAULT_PRIMARY)), 4.7);
  assert.ok(relativeLuminance(WHITE) > relativeLuminance('#777777'));
});

test('deriveTheme("#045BCC") reproduces the mockup palette exactly, with nothing adjusted', () => {
  const theme = deriveTheme('#045BCC');
  assert.deepEqual(theme.tokens, MOCKUP_TOKENS);
  assert.deepEqual(theme.adjustments, []);
  assert.equal(DEFAULT_PRIMARY, '#045BCC');
  assert.ok(theme.contrast.surface >= 4.7 && theme.contrast.action >= 5.0);
  assert.deepEqual(deriveTheme('#045bcc').tokens, MOCKUP_TOKENS, 'case does not matter');
});

test("Domino's primary #0B648F keeps white text readable and needs no adjustment", () => {
  const theme = assertReadable('#0B648F');
  assert.equal(theme.tokens['--bg-mid'], '#0B648F');
  assert.deepEqual(theme.adjustments, []);
  assert.ok(relativeLuminance(theme.tokens['--bg-bottom']) < relativeLuminance(theme.tokens['--bg-mid']), 'the gradient still darkens downwards');
  assert.notEqual(theme.tokens['--action'], MOCKUP_TOKENS['--action'], 'the CTA follows the client colour');
});

test('colours with a light primary are darkened until white text passes, and say so', () => {
  for (const primary of ['#FFD100', '#FFFFFF', '#F5F5F5', '#7FDBFF', '#39CCCC']) {
    const theme = assertReadable(primary);
    const change = theme.adjustments.find((item) => item.token === '--bg-mid');
    assert.ok(change, `${primary} should have been darkened`);
    assert.equal(change.from, primary.toUpperCase());
    assert.equal(change.to, theme.tokens['--bg-mid']);
    assert.match(change.reason, /4\.5:1/);
  }
});

test('an accent never drives a control: with any accent, every token but the two decorative ones is the primary\'s own', () => {
  // The guard: if an accent ever reaches --action (or any other control fill) again, this fails.
  assert.deepEqual([...ACCENT_TOKENS], ['--accent-rule', '--accent-ring']);
  assert.deepEqual([...CONTROL_TOKENS], ['--surface', '--surface-border', '--action', '--action-border', '--disabled', '--on-disabled']);
  let seed = 0x51ced;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const colour = () => `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`;
  const accents = ['#E21737', '#C8102E', '#E00000', '#FF0000', '#FFD100', '#FFFFFF', '#000000', ...Array.from({ length: 300 }, colour)];
  let coloured = 0;
  const primaries = ['#045BCC', '#0B648F', '#008044', '#FFD100', '#7A0019', ...Array.from({ length: 20 }, colour)];
  for (const primary of primaries) {
    const alone = deriveTheme(primary).tokens;
    for (const accent of accents) {
      const { tokens } = deriveTheme(primary, accent);
      assert.deepEqual(Object.keys(tokens), Object.keys(alone));
      for (const name of Object.keys(tokens)) {
        if (!ACCENT_TOKENS.includes(name)) assert.equal(tokens[name], alone[name], `${name} for primary ${primary} with accent ${accent}`);
      }
      if (ACCENT_TOKENS.some((name) => tokens[name] !== alone[name])) coloured += 1;
    }
  }
  assert.ok(coloured > 1000, `the accent did colour its two tokens (${coloured} times), so the sweep was not comparing like with like`);
  assert.equal(deriveTheme('#0B648F', '#C8102E').tokens['--action'], deriveTheme('#0B648F').tokens['--action']);
  assert.deepEqual(deriveTheme('#0B648F', '').tokens, deriveTheme('#0B648F').tokens, 'empty accent means none');
  assert.deepEqual(deriveTheme('#0B648F', null).tokens, deriveTheme('#0B648F').tokens);
});

test('the accent shows only where it has 3:1 against what it is drawn on: the rule on the gradient, the ring on the white plate', () => {
  assert.equal(MIN_GRAPHIC_CONTRAST, 3);
  // Domino's red: lost on its blue page (1.4:1), clear on white (4.8:1). A ring, and a white rule.
  const red = deriveTheme('#0B648F', '#E21737');
  assert.deepEqual([red.tokens['--accent-rule'], red.tokens['--accent-ring']], ['#FFFFFF', '#E21737']);
  assert.deepEqual(red.adjustments.map((item) => [item.token, item.from, item.to]), [['--accent-rule', '#E21737', '#FFFFFF']]);
  assert.match(red.adjustments[0].reason, /needs 3:1 against the page; #E21737 is 1\.4:1/);
  // A yellow: clear on the whole gradient, lost on white. A yellow rule, and no ring.
  const yellow = deriveTheme('#0B648F', '#FFD100');
  assert.deepEqual([yellow.tokens['--accent-rule'], yellow.tokens['--accent-ring']], ['#FFD100', NO_RING]);
  assert.deepEqual(yellow.adjustments.map((item) => item.token), ['--accent-ring']);
  // Close to the page colour itself: used nowhere, and both reasons are given.
  const lost = deriveTheme('#0B648F', '#0B648F');
  assert.deepEqual([lost.tokens['--accent-rule'], lost.tokens['--accent-ring']], ['#FFFFFF', '#0B648F']);
  const nowhere = deriveTheme('#0B648F', '#999999');
  assert.deepEqual([nowhere.tokens['--accent-rule'], nowhere.tokens['--accent-ring']], ['#FFFFFF', NO_RING]);
  assert.deepEqual(nowhere.adjustments.map((item) => item.token), ['--accent-rule', '--accent-ring']);
  // Whatever is chosen, what is painted passes where it is painted.
  for (const accent of ['#E21737', '#FFD100', '#FFFFFF', '#000000', '#86BC25', '#999999', '#FF6A00', '#7A0019']) {
    for (const primary of ['#045BCC', '#0B648F', '#008044', '#FFD100']) {
      const { tokens } = deriveTheme(primary, accent);
      for (const ground of [tokens['--bg-top'], tokens['--bg-mid'], tokens['--bg-bottom']]) {
        assert.ok(contrastRatio(tokens['--accent-rule'], ground) >= MIN_GRAPHIC_CONTRAST, `rule ${tokens['--accent-rule']} on ${ground}`);
      }
      if (tokens['--accent-ring'] !== NO_RING) assert.ok(contrastRatio(tokens['--accent-ring'], WHITE) >= MIN_GRAPHIC_CONTRAST, `ring ${tokens['--accent-ring']} on white`);
    }
  }
  // No accent: the rule is the mockup's white and there is no ring, with nothing to report.
  assert.deepEqual(deriveTheme('#0B648F').adjustments, []);
});

test('a colour within 30 degrees of the wrong-answer red is recognised, for Brand Studio to warn about', () => {
  assert.equal(DANGER_HUE_MARGIN, 30);
  assert.equal(dangerHueDistance('#E00000'), 0);
  for (const near of ['#E21737', '#C8102E', '#FF0000', '#E00000', '#FF6A00', '#D4003C', '#7A0019']) assert.equal(isNearDangerHue(near), true, near);
  for (const far of ['#FFD100', '#0B648F', '#045BCC', '#86BC25', '#008044', '#7B2FF7', '#E0007A']) assert.equal(isNearDangerHue(far), false, far);
  for (const grey of ['#FFFFFF', '#000000', '#808080', '#F4F4F4']) {
    assert.equal(hueOf(grey), null, `${grey} has no hue`);
    assert.equal(isNearDangerHue(grey), false);
  }
  assert.ok(Math.abs(dangerHueDistance('#FF8000') - 30.1) < 0.2, 'orange at 30 degrees is the edge');
  // The default action colour, and the one derived for Domino's, are nowhere near it.
  assert.ok(dangerHueDistance(deriveTheme(DEFAULT_PRIMARY).tokens['--action']) > 120);
  assert.ok(dangerHueDistance(deriveTheme('#0B648F', '#E21737').tokens['--action']) > 120);
});

test('correct, wrong and brand-green colours never change with the client', () => {
  const fixed = ['--bg-top', '--surface', '--surface-border', '--success', '--on-success', '--danger', '--danger-tint', '--focus', '--progress'];
  const reference = deriveTheme(DEFAULT_PRIMARY).tokens;
  for (const primary of ['#0B648F', '#C8102E', '#FFD100', '#101010']) {
    const { tokens } = deriveTheme(primary);
    for (const name of fixed) assert.equal(tokens[name], reference[name], `${name} for ${primary}`);
  }
  assert.ok(contrastRatio('#000000', reference['--success']) >= 7, 'black on correct green');
  assert.ok(contrastRatio(WHITE, reference['--danger']) >= MIN_TEXT_CONTRAST, 'white on wrong red');
});

test('white text stays at 4.5:1 or better for any primary and accent', () => {
  // Deterministic pseudo-random sweep (mulberry32), so a failure is reproducible.
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const randomHex = () => `#${Math.floor(random() * 0x1000000).toString(16).padStart(6, '0')}`;
  for (let index = 0; index < 400; index += 1) assertReadable(randomHex(), index % 2 ? randomHex() : undefined);
  for (const edge of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#808080', '#010101', '#FEFEFE']) {
    assertReadable(edge);
    assertReadable(edge, edge);
  }
});

test('colour input is validated and normalised', () => {
  assert.equal(normalizeHex('#0af'), '#00AAFF');
  assert.equal(normalizeHex(' #0b648f '), '#0B648F');
  for (const bad of ['', 'red', '#12', '#12345', '#1234567', 'rgb(1,2,3)', null, undefined, 123]) {
    assert.throws(() => deriveTheme(bad), TypeError, `primary ${String(bad)}`);
  }
  assert.throws(() => deriveTheme('#0B648F', 'blue'), TypeError);
  assert.equal(deriveTheme('#0af').tokens['--bg-mid'], deriveTheme('#00AAFF').tokens['--bg-mid']);
});

function fakeRoot() {
  const written = new Map();
  return { written, style: { setProperty: (name, value) => written.set(name, value) } };
}

test('applyTheme writes every token as a custom property and reports the names', () => {
  const root = fakeRoot();
  const { tokens } = deriveTheme('#0B648F');
  const names = applyTheme(tokens, root);
  assert.deepEqual(names, Object.keys(tokens));
  assert.deepEqual(Object.fromEntries(root.written), tokens);
});

test('applyTheme refuses unknown names and values that are not plain colours, and applies nothing', () => {
  const { tokens } = deriveTheme('#0B648F');
  const attempts = [
    { ...tokens, '--evil': '#FFFFFF' },
    { ...tokens, 'background': '#FFFFFF' },
    { ...tokens, '--action': 'red' },
    { ...tokens, '--action': '#FFF; background: url(//example.com/x)' },
    { ...tokens, '--action': 'url(//example.com/x)' },
    { ...tokens, '--bg-mid': 'rgb(0 0 0 / 1); --x: 1' },
    { ...tokens, '--bg-mid': 42 },
  ];
  for (const attempt of attempts) {
    const root = fakeRoot();
    assert.throws(() => applyTheme(attempt, root), TypeError);
    assert.equal(root.written.size, 0, 'a rejected theme must not be partly applied');
  }
  assert.throws(() => applyTheme(tokens, null), /element/);
});

test('resetTheme removes exactly the tokens applyTheme set', () => {
  const props = new Map();
  const root = {
    style: {
      setProperty: (name, value) => props.set(name, value),
      removeProperty: (name) => props.delete(name),
    },
  };
  props.set('--unrelated', 'kept');
  applyTheme(deriveTheme('#0B648F').tokens, root);
  assert.ok(props.size > 10);
  resetTheme(root);
  assert.deepEqual([...props], [['--unrelated', 'kept']]);
  assert.throws(() => resetTheme(null), /element/);
});

test('the defaults in tokens.css are exactly what deriveTheme gives for the default primary', async () => {
  const css = await readFile(path.join(import.meta.dirname, '..', 'migration', 'src', 'styles', 'tokens.css'), 'utf8');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const declared = Object.fromEntries(
    [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim().toUpperCase()]),
  );
  for (const [name, value] of Object.entries(deriveTheme(DEFAULT_PRIMARY).tokens)) {
    assert.equal(declared[name], value.toUpperCase(), `${name} in tokens.css drifted from deriveTheme(${DEFAULT_PRIMARY})`);
  }
});
