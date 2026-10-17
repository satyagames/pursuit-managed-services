// Phase 11a: the Deloitte palette of the Results charts. Run: node --test scripts/test-results-palette.js (also part of npm test)
//
// Reads migration/src/styles/results-tokens.css itself (not a copy of its values) and holds every pair of the palette to the contrast it is
// stated to have (WCAG 2.1: 4.5:1 for words, 3:1 for a mark that carries meaning, and the 2:1 light end the validator asked of a ramp), the
// blue ramps to one hue, getting darker step by step with a visible gap, and the four categorical colours apart from their neighbours. Change
// a token and the test names the pair that broke. It prints every measured ratio, for the phase report.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { contrastRatio, relativeLuminance } from '../migration/src/lib/brand/theme.js';

const ROOT = path.join(import.meta.dirname, '..');
const CSS = await readFile(path.join(ROOT, 'migration', 'src', 'styles', 'results-tokens.css'), 'utf8');
const TOKENS = Object.fromEntries([...CSS.matchAll(/(--viz-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2].toUpperCase()]));
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const token = (name) => {
  assert.ok(TOKENS[name], `${name} is in results-tokens.css`);
  return TOKENS[name];
};
const colour = (name) => (name.startsWith('#') ? name : token(name));

// [foreground, background, at least, what it is]. A "foreground" of white or black is words on that fill.
const PAIRS = [
  ['--viz-primary', '--viz-surface', 4.5, 'the blue bars on the card (5.05:1)'],
  [WHITE, '--viz-primary', 4.5, 'white words on the blue (5.05:1)'],
  ['--viz-primary-tint', '--viz-surface', 2, 'the tint bars on the card (about 2.4:1; each bar has its value written beside it)'],
  ['--viz-primary-tint', '--viz-primary', 2, 'the tint against the blue (2.1:1)'],
  [BLACK, '--viz-primary-tint', 4.5, 'black words on the tint (8.85:1)'],
  ['--viz-correct', '--viz-surface', 4.5, 'the correct answer on the card (6.72:1)'],
  [WHITE, '--viz-correct', 4.5, 'white words on the correct answer (6.72:1)'],
  ['--viz-marker', '--viz-surface', 3, 'the average marker and thin lines (6.72:1)'],
  [BLACK, '--viz-brand', 4.5, 'black words on Deloitte Green (9.23:1)'],
  [BLACK, '--viz-secondary', 4.5, 'black words on the teal (6.0:1)'],
  ['--viz-text', '--viz-surface', 4.5, 'the main words (21:1)'],
  ['--viz-text-secondary', '--viz-surface', 4.5, 'the secondary words (7.38:1)'],
  ['--viz-text-secondary', '--viz-band-shade', 4.5, 'the secondary words on a scale\'s shaded band'],
  ['--viz-text', '--viz-band-shade', 4.5, 'the main words on a scale\'s shaded band'],
  ['--viz-text-muted', '--viz-surface', 3, 'the muted words, at 18px or bold 14px and more only (4.44:1)'],
  // Phase 11b: on paper (the leader report, the one-page PDF and PowerPoint) the same pairs, and these that only paper draws.
  ['--viz-marker', '--viz-band-shade', 3, 'the scale\'s average line across a shaded band, on paper'],
  ['--viz-correct', '--viz-band-shade', 3, 'a tick in Dark Green beside "Correct", should it sit on a shaded band'],
];

const RAMPS = { 3: [1, 2, 3], 4: [1, 2, 3, 4], 5: [1, 2, 3, 4, 5] };

// OKLab (Björn Ottosson's), for hue and lightness: the ramps are one hue, and get darker step by step.
function oklab(hex) {
  const linear = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = linear;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const hueOf = (hex) => { const [, a, b] = oklab(hex); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };

describe('the Results palette', () => {
  it('is the palette VJR chose, in results-tokens.css', () => {
    assert.deepEqual(
      ['--viz-primary', '--viz-primary-tint', '--viz-correct', '--viz-marker', '--viz-brand', '--viz-secondary', '--viz-text', '--viz-text-secondary', '--viz-text-muted', '--viz-grid', '--viz-surface'].map(token),
      ['#0076A8', '#6CB1D1', '#046A38', '#046A38', '#86BC25', '#0097A9', '#000000', '#53565A', '#75787B', '#D0D0CE', '#FFFFFF'],
    );
  });

  it('holds every pair to the contrast it is stated to have', () => {
    const lines = [];
    const broken = [];
    for (const [front, back, least, what] of PAIRS) {
      const ratio = contrastRatio(colour(front), colour(back));
      lines.push(`  ${ratio.toFixed(2).padStart(5)}:1  (at least ${least}:1)  ${what}`);
      if (ratio < least) broken.push(`${what}: ${ratio.toFixed(2)}:1 is under ${least}:1`);
    }
    console.log(`Results palette, contrast of each pair:\n${lines.join('\n')}`);
    assert.deepEqual(broken, []);
  });

  it('never puts white words on the teal, which would fail', () => {
    assert.ok(contrastRatio(WHITE, token('--viz-secondary')) < 4.5, 'white on the teal is 3.5:1: the table says it fails, and the charts must not use it');
  });

  it('has blue ramps that are one hue, darker at every step, with a light end of at least 2:1 on white', () => {
    const lines = [];
    for (const [steps, numbers] of Object.entries(RAMPS)) {
      const ramp = numbers.map((step) => token(`--viz-ramp-${steps}-${step}`));
      assert.ok(contrastRatio(ramp[0], WHITE) >= 2, `the light end of the ${steps}-step ramp is ${contrastRatio(ramp[0], WHITE).toFixed(2)}:1 on white`);
      for (let at = 1; at < ramp.length; at += 1) {
        const gap = contrastRatio(ramp[at], ramp[at - 1]);
        assert.ok(relativeLuminance(ramp[at]) < relativeLuminance(ramp[at - 1]), `${steps} steps: step ${at + 1} is darker than step ${at}`);
        assert.ok(gap >= 1.3, `${steps} steps: steps ${at} and ${at + 1} are ${gap.toFixed(2)}:1 apart, under 1.3:1`);
      }
      const hues = ramp.map(hueOf);
      const spread = Math.max(...hues) - Math.min(...hues);
      assert.ok(spread <= 12, `${steps} steps: one hue (the hues spread ${spread.toFixed(1)} degrees)`);
      lines.push(`  ${steps} steps: ${ramp.join(' ')}  light end ${contrastRatio(ramp[0], WHITE).toFixed(2)}:1, hue spread ${spread.toFixed(1)} degrees`);
    }
    console.log(`Results palette, the ramps:\n${lines.join('\n')}`);
  });

  it('keeps the four categorical colours apart from their neighbours: Blue, Green, Teal, Dark Green', () => {
    const order = ['--viz-primary', '--viz-brand', '--viz-secondary', '--viz-correct'].map(token);
    for (let at = 1; at < order.length; at += 1) {
      const [a, b] = [oklab(order[at - 1]), oklab(order[at])];
      const distance = 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(distance >= 15, `${order[at - 1]} and ${order[at]} are ${distance.toFixed(1)} apart in OKLab (x100), under 15`);
    }
  });

  it('says why Deloitte Green is an accent only: it and the tint are nearly the same lightness', () => {
    // So nothing may depend on telling them apart in greyscale: green is never a bar (the charts' own test holds that).
    const ratio = contrastRatio(token('--viz-brand'), token('--viz-primary-tint'));
    assert.ok(ratio < 1.1, `Deloitte Green against the tint is ${ratio.toFixed(2)}:1`);
    assert.ok(contrastRatio(token('--viz-brand'), WHITE) < 3, 'and Deloitte Green on white is under 3:1');
  });
});
