// Prompt 44: runs node test files from scripts/tests.manifest.json with `node --test`.
//
//   node scripts/run-tests.js                     every file of every group (npm test)
//   node scripts/run-tests.js --group admin       one group
//   node scripts/run-tests.js --suite test:report one per-area suite (the npm script of that name)
//   node scripts/run-tests.js --list              prints the files instead of running them
//
// Anything else on the line (for example --test-name-pattern=...) is handed to `node --test`. The files run in one `node --test`, as the
// hand-written list in package.json did, with the Node that runs this script.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = path.join(ROOT, 'scripts', 'tests.manifest.json');

/** The manifest. */
export const readManifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** What npm test runs: every group's files, in the manifest's order. */
export const allFiles = (manifest = readManifest()) => Object.values(manifest.groups).flat();

/** The files a command line asks for. */
export function filesFor(args, manifest = readManifest()) {
  const at = (flag) => { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1]; };
  const group = at('--group');
  const suite = at('--suite');
  if (group) {
    if (!manifest.groups[group]) throw new Error(`No group "${group}" in scripts/tests.manifest.json (there are ${Object.keys(manifest.groups).join(', ')}).`);
    return manifest.groups[group];
  }
  if (suite) {
    if (!manifest.suites[suite]) throw new Error(`No suite "${suite}" in scripts/tests.manifest.json.`);
    return manifest.suites[suite];
  }
  return allFiles(manifest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = filesFor(args);
  if (args.includes('--list')) {
    console.log(files.join('\n'));
  } else {
    const ours = new Set(['--group', '--suite', '--list']);
    const passOn = args.filter((arg, index) => !ours.has(arg) && !ours.has(args[index - 1]));
    const run = spawnSync(process.execPath, ['--test', ...passOn, ...files], { cwd: ROOT, stdio: 'inherit' });
    process.exit(run.status ?? 1);
  }
}
