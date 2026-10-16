// For scripts/mutate-leader-report.js (Phase 11b): run a test with ONE module swapped for a broken copy beside it, never the file itself.
//   node --import ./scripts/mutation-redirect.mjs --test <file>   with MUTATE_FROM and MUTATE_TO set to the two files' URLs
// Every import that resolves to MUTATE_FROM gets MUTATE_TO instead (a resolve hook: lib/ files import each other by relative path, so the copy is
// in the same folder and its own imports resolve as the original's do).

import { register } from 'node:module';

if (process.env.MUTATE_FROM && process.env.MUTATE_TO) {
  register('./mutation-redirect-hooks.mjs', import.meta.url, { data: { from: process.env.MUTATE_FROM, to: process.env.MUTATE_TO } });
}
