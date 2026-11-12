// Prompt 44: scripts/check-unused-exports.js, which npm run docs:check runs. Every exported name of migration/src/lib that nothing else uses is
// listed, with why, in scripts/unused-exports.baseline.json, and a name passed on by a facade (`export { name } from`) is not a use.
// Run: node --test scripts/test-unused-exports.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASELINE, exportsOf, findUnused } from './check-unused-exports.js';

describe('the unused exports of lib/', () => {
  it('are exactly the ones the baseline lists, each with why', () => {
    const { kept } = JSON.parse(readFileSync(BASELINE, 'utf8'));
    assert.deepEqual(findUnused().unused, Object.keys(kept).sort());
    for (const [name, why] of Object.entries(kept)) assert.ok(why.length > 40, `${name}: why it is kept`);
  });

  it('reads a module\'s own exports, not the names it passes on', () => {
    const text = [
      'export const A = 1;', 'export async function b() {}', 'export class C {}', 'const d = 2;', 'export { d, e as f };',
      "export { g } from './g.js';", '// export const notOne = 1;', '/* export function notTwo() {} */',
    ].join('\n');
    assert.deepEqual(exportsOf(text).sort(), ['A', 'C', 'b', 'd', 'f']);
  });
});
