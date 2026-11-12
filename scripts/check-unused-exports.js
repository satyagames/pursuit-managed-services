// Prompt 44: the exported names of migration/src/lib that nothing uses. A name is used when another file of migration/src or scripts/ names it,
// other than by passing it on (`export { name } from`, which a facade does for every name of its parts). No dependency: a word search over
// the sources, comments left out.
//
//   node scripts/check-unused-exports.js            prints the names nothing uses, and those only scripts/ uses
//   node scripts/check-unused-exports.js --check    fails on a name nothing uses that scripts/unused-exports.baseline.json does not list
//                                                   (npm run docs:check runs this), and on a listed name that is used now
//
// The baseline lists, with why, the names kept although nothing uses them: the data layer's public surface (scripts/data-surface.json, a
// decision of its own), and the few kept on purpose.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'migration', 'src', 'lib');
export const BASELINE = path.join(ROOT, 'scripts', 'unused-exports.baseline.json');

const walk = (dir) => readdirSync(dir).filter((name) => !name.startsWith('.') && name !== 'node_modules').flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const posix = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');

/** The names a module exports itself (not those it passes on from another). */
export function exportsOf(text) {
  const code = withoutComments(text);
  const names = new Set();
  for (const [, name] of code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(name);
  for (const [, list] of code.matchAll(/^export\s*\{([^}]*)\}\s*;/gm)) {
    for (const part of list.split(',').map((each) => each.trim()).filter(Boolean)) names.add(part.split(/\s+as\s+/).pop().trim());
  }
  return [...names];
}

/** The exported names of lib/ nothing uses: { unused: [file name], scriptsOnly: [file name -> test] }. */
export function findUnused() {
  const libFiles = walk(LIB).filter((file) => /\.(js|ts)$/.test(file));
  const sources = [...walk(path.join(ROOT, 'migration', 'src')), ...walk(path.join(ROOT, 'scripts'))].filter((file) => /\.(svelte|js|ts|mjs)$/.test(file));
  const texts = new Map(sources.map((file) => [file, withoutComments(readFileSync(file, 'utf8')).replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/gm, ' ')]));
  const unused = [];
  const scriptsOnly = [];
  for (const file of libFiles) {
    for (const name of exportsOf(readFileSync(file, 'utf8'))) {
      const word = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
      const users = sources.filter((other) => other !== file && word.test(texts.get(other)));
      if (!users.length) unused.push(`${posix(file)} ${name}`);
      else if (users.every((other) => posix(other).startsWith('scripts/'))) scriptsOnly.push(`${posix(file)} ${name} (${users.map(posix).slice(0, 2).join(', ')})`);
    }
  }
  return { unused: unused.sort(), scriptsOnly: scriptsOnly.sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { unused, scriptsOnly } = findUnused();
  if (process.argv.includes('--check')) {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).kept;
    const listed = new Set(Object.keys(baseline));
    const added = unused.filter((entry) => !listed.has(entry));
    const stale = [...listed].filter((entry) => !unused.includes(entry));
    if (added.length || stale.length) {
      for (const entry of added) console.error(`An exported name nothing uses: ${entry}. Use it, stop exporting it, or list it in scripts/unused-exports.baseline.json with why.`);
      for (const entry of stale) console.error(`Listed as unused, but used now: ${entry}. Take it out of scripts/unused-exports.baseline.json.`);
      process.exit(1);
    }
    console.log(`Unused exports: ${unused.length}, each listed with why in scripts/unused-exports.baseline.json.`);
  } else {
    console.log(`Exported by lib/ and used nowhere (${unused.length}):\n  ${unused.join('\n  ')}`);
    console.log(`\nUsed only by scripts/ (${scriptsOnly.length}):\n  ${scriptsOnly.join('\n  ')}`);
  }
}
