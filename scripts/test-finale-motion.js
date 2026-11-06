// Prompt 36: the grand finale's acts as a plan (lib/motion/finale-motion-plan.js), with no DOM. Run: node --test scripts/test-finale-motion.js (also
// part of npm test). The hush (the veil), the medal (its spring, rays, three rings and the check), the name letter by letter, the three cards and
// their count-up, the sheen, and "Celebrate again" in the afterglow: each at its time, never more than MAX_CONCURRENT moving at once, the name
// in by 3 s and the numbers by 3.6 s; the reduced level only fades, together; none shows the final state at once.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FINALE, countValue, finaleCount, finaleParts, letterGap } from '../migration/src/lib/motion/finale-motion-plan.js';
import { MAX_CONCURRENT, TOKENS } from '../migration/src/lib/motion/motion-plan.js';

const root = path.join(import.meta.dirname, '..');
const end = (part) => part.delay + part.duration;
const propertiesOf = (keyframes) => [...new Set(keyframes.flatMap((frame) => Object.keys(frame)))].filter((key) => !['offset', 'easing'].includes(key));
const NAME = 'Thank you, Jordan Lee!'.length;

describe('the finale\'s acts (Prompt 36)', () => {
  it('has every part at the full level, at the brief\'s times', () => {
    const parts = finaleParts('full', { letters: NAME, cards: 3, width: 600 });
    const of = (name) => parts.filter((part) => part.part === name);
    assert.deepEqual([...new Set(parts.map((part) => part.part))].sort(), ['again', 'card', 'check', 'letter', 'medal', 'ray', 'ring', 'sheen', 'veil']);
    const [veil] = of('veil');
    assert.equal(veil.delay, 0, 'the hush starts at once');
    assert.ok(veil.keyframes.every((frame) => frame.opacity === undefined || frame.opacity <= FINALE.veil), 'a 35 percent veil, no deeper');
    assert.equal(FINALE.veil, 0.35);
    assert.ok(Math.abs(veil.keyframes.find((frame) => frame.opacity === FINALE.veil).offset * veil.duration - 800) <= 1, 'it is in by 0.8 s, evenly (faster would flash by the 10 percent rule)');
    assert.equal(veil.keyframes[0].easing, 'linear');
    const lifted = veil.keyframes.filter((frame) => frame.opacity === FINALE.veil).at(-1).offset * veil.duration;
    assert.ok(Math.abs(lifted - 3600) <= 1 && end(veil) <= 4200, 'and lifts from 3.6 s');
    const [medal] = of('medal');
    assert.equal(medal.delay, 1100);
    assert.ok(end(medal) <= 2500, 'the medal has landed by 2.5 s');
    assert.match(JSON.stringify(medal.keyframes), /scale\(0\)/);
    assert.match(JSON.stringify(medal.keyframes), /scale\(1\.12\)/, 'with a spring past full size');
    assert.equal(of('ring').length, 3, 'three soft rings');
    assert.ok(of('ring').every((ring) => ring.delay >= 1100 && end(ring) <= 2500));
    assert.equal(of('ray').length, 1, 'the rays open and turn once, as one');
    assert.match(JSON.stringify(of('ray')[0].keyframes), /rotate\(360deg\)/);
    const [check] = of('check');
    assert.ok(check.delay >= medal.delay && end(check) <= 2500, 'the check draws itself as the medal lands');
    assert.deepEqual(propertiesOf(check.keyframes), ['strokeDashoffset']);
    const letters = of('letter');
    assert.equal(letters.length, NAME);
    assert.equal(letters[0].delay, 1900);
    assert.ok(Math.abs(letters[1].delay - letters[0].delay - 38) < 1e-9, '38 ms apart');
    assert.ok(Math.max(...letters.map(end)) <= 3000, 'every letter is in by 3 s');
    const cards = of('card');
    assert.equal(cards.length, 3);
    assert.ok(cards.every((card, index) => index === 0 || card.delay > cards[index - 1].delay), 'one after another');
    assert.ok(of('sheen')[0].delay >= 1900, 'the sheen crosses once, after the name starts');
    assert.equal(of('again')[0].delay, 3600, '"Celebrate again" in the afterglow');
  });

  it('a long name comes in faster, still by 3 s, and past 24 letters the rest rise together as the last', () => {
    assert.equal(FINALE.lettersMax, 24);
    assert.equal(letterGap(NAME), 38);
    for (const count of [1, 2, 23, 40, 80]) {
      const letters = finaleParts('full', { letters: count, cards: 3, width: 600 }).filter((part) => part.part === 'letter');
      assert.equal(letters.length, Math.min(count, FINALE.lettersMax));
      assert.ok(Math.max(...letters.map(end)) <= 3000, `${count} letters`);
      assert.ok(letterGap(count) <= 38);
    }
  });

  it('moves transform and opacity only (the check its stroke), with token lengths and curves', () => {
    for (const part of finaleParts('full', { letters: NAME, cards: 3, width: 600 })) {
      const allowed = part.part === 'check' ? ['strokeDashoffset'] : ['transform', 'opacity'];
      assert.deepEqual(propertiesOf(part.keyframes).filter((key) => !allowed.includes(key)), [], part.part);
      assert.match(part.easing, /^cubic-bezier\(/, `${part.part} names a token curve`);
      assert.ok(Object.values(TOKENS.finale).includes(part.duration), `${part.part}: ${part.duration} ms is a token`);
    }
  });

  it('never has more than MAX_CONCURRENT moving at once, for any name and card count', () => {
    for (const letters of [1, NAME, 40, 80]) {
      for (const cards of [1, 2, 3]) {
        const parts = finaleParts('full', { letters, cards, width: 600 });
        for (let t = 0; t <= 4200; t += 10) {
          const moving = parts.filter((part) => t >= part.delay && t < end(part)).length;
          assert.ok(moving <= MAX_CONCURRENT, `${moving} moving at ${t} ms (${letters} letters, ${cards} cards)`);
        }
      }
    }
  });

  it('is over by 4.2 s, before the afterglow: nothing the guest must wait for', () => {
    const parts = finaleParts('full', { letters: 80, cards: 3, width: 600 });
    assert.ok(Math.max(...parts.map(end)) <= 4200);
  });

  it('counts each card up from 0 over 800 ms, easing out, to its value by 3.6 s', () => {
    const counts = [0, 1, 2].map((index) => finaleCount('full', index));
    assert.ok(counts.every((count) => count && count.duration === 800));
    assert.ok(Math.max(...counts.map((count) => count.delay + count.duration)) <= 3600, 'the numbers are final by 3.6 s');
    assert.equal(countValue(12, 0), 0);
    assert.equal(countValue(12, 1), 12);
    assert.equal(countValue(12, 2), 12);
    assert.ok(countValue(100, 0.5) > 50, 'it eases out');
    for (let p = 0; p <= 1; p += 0.05) assert.ok(countValue(7, p) <= countValue(7, Math.min(1, p + 0.05)), 'never counts back');
  });

  it('at the reduced level: the medal, the name and the cards fade in together in 200 ms; no veil, rings, rays, letters or count-up', () => {
    const parts = finaleParts('reduced', { letters: NAME, cards: 3, width: 600 });
    assert.deepEqual([...new Set(parts.map((part) => part.part))].sort(), ['card', 'medal', 'name']);
    for (const part of parts) {
      assert.deepEqual(propertiesOf(part.keyframes), ['opacity'], `${part.part} only fades`);
      assert.equal(part.delay, 0, 'together, at once');
      assert.equal(part.duration, 200);
    }
    assert.equal(finaleCount('reduced', 0), null);
  });

  it('at none: nothing moves, the final state is shown at once', () => {
    assert.deepEqual(finaleParts('none', { letters: NAME, cards: 3, width: 600 }), []);
    assert.equal(finaleCount('none', 0), null);
  });

  it('the CSS declares the tokens the plan uses', async () => {
    const css = await readFile(path.join(root, 'migration/src/lib/motion/motion-tokens.css'), 'utf8');
    const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    for (const [name, value] of Object.entries(TOKENS.finale)) {
      assert.match(css, new RegExp(`--motion-finale-${kebab(name)}:\\s*${value}ms;`), `--motion-finale-${kebab(name)}`);
    }
  });
});
