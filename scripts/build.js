// `npm run build`: the three pages of THIS folder, as they are now (committed or not), ready to upload to SharePoint.
//
//   npm run build              builds the pages and puts the four files to upload into build-svelte/upload/
//   npm run build -- --zip     also makes build-svelte/upload.zip of that folder
//
// build-svelte/upload/ holds index.html, admin.html, setup.html and pms-config.txt, nothing else: upload all four to the PMS folder
// (replace the old ones). It is the quick path for trying a change on SharePoint. The official, checksummed package (with RUNBOOK.md,
// notices and SHA256SUMS.txt, made from a clean commit) is still `npm run package:release`. Settings baked into the pages come from the
// PMS_* environment values exactly as for the release build (scripts/site-override.js); with none set the pages ask pms-config.txt.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureInstalled, ensureNode, ROOT } from './node-guard.js';
import { SETTINGS_TEXT } from './release-docs.js';

ensureNode(import.meta.filename);
ensureInstalled();

const upload = path.join(ROOT, 'build-svelte', 'upload');
const release = path.join(ROOT, 'build-svelte', 'release');
const PAGES = ['index.html', 'admin.html', 'setup.html'];

const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-svelte-release.js')], { cwd: ROOT, stdio: 'inherit', env: process.env });
if (built.status !== 0) {
  console.error('\n  The build failed. Scroll up for the first error. `npm run doctor` checks this computer.\n');
  process.exit(built.status ?? 1);
}

rmSync(upload, { recursive: true, force: true });
mkdirSync(upload, { recursive: true });
for (const page of PAGES) copyFileSync(path.join(release, page), path.join(upload, page));
writeFileSync(path.join(upload, 'pms-config.txt'), SETTINGS_TEXT);

const git = (...gitArgs) => {
  try { return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
const commit = git('rev-parse', '--short=7', 'HEAD');
const changed = git('status', '--porcelain', '--untracked-files=no');

console.log('\n  Ready to upload: build-svelte/upload/\n');
for (const file of [...PAGES, 'pms-config.txt']) {
  const bytes = readFileSync(path.join(upload, file));
  console.log(`    ${file.padEnd(16)}${String(statSync(path.join(upload, file)).size).padStart(10)} bytes   sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}…`);
}
console.log(`\n  Built from ${commit ? `commit ${commit}${changed ? ' with uncommitted changes' : ''}` : 'a copy with no git history'}.`);

if (process.argv.includes('--zip')) {
  const zip = path.join(ROOT, 'build-svelte', 'upload.zip');
  rmSync(zip, { force: true });
  try {
    if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', upload, ...PAGES, 'pms-config.txt']);
    else execFileSync('zip', ['-X', '-q', '-j', zip, ...[...PAGES, 'pms-config.txt'].map((file) => path.join(upload, file))]);
    console.log(`  Zip: build-svelte/upload.zip`);
  } catch {
    console.log('  (Could not make the zip on this computer; upload the four files from the folder instead.)');
  }
}
console.log('\n  On SharePoint: upload the four files into the PMS folder (replace the old ones; keep an existing pms-config.txt if the site uses a prefix),');
console.log('  open setup.html and run the self-test. Official package with checksums: commit, then npm run package:release.\n');
