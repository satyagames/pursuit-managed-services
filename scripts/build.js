// `npm run build`: the three pages of THIS folder, as they are now (committed or not), ready to upload to SharePoint.
//
//   npm run build              builds the pages and puts the four files to upload into build-svelte/upload/
//   npm run build -- --zip     also makes build-svelte/upload.zip of that folder
//
// build-svelte/upload/ holds index.html, admin.html, setup.html and pms-config.txt, nothing else: upload all four to the PMS folder
// (replace the old ones). It is the quick path for trying a change on SharePoint. The official, checksummed package (with RUNBOOK.md,
// notices and SHA256SUMS.txt, made from a clean commit) is still `npm run package:release`. Settings baked into the pages come from the
// PMS_* environment values exactly as for the release build (scripts/site-override.js); with none set the pages ask pms-config.txt.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitInfo, zipFlat } from './local-env.js';
import { ensureInstalled, ensureNode, ROOT } from './node-guard.js';
import { SETTINGS_TEXT } from './release-docs.js';

ensureNode(import.meta.filename);
ensureInstalled();

const PAGES = ['index.html', 'admin.html', 'setup.html'];
const FILES = [...PAGES, 'pms-config.txt'];
const releaseDir = path.join(ROOT, 'build-svelte', 'release');
const uploadDir = path.join(ROOT, 'build-svelte', 'upload');

/** Builds the three pages (scripts/build-svelte-release.js); stops with advice when that fails. */
function buildPages() {
  const built = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-svelte-release.js')], { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (built.status === 0) return;
  console.error('\n  The build failed. Scroll up for the first error. `npm run doctor` checks this computer.\n');
  process.exit(built.status ?? 1);
}

/** Puts the four files in build-svelte/upload/ and returns each one's size and hash for the report. */
function gatherUpload() {
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });
  return FILES.map((file) => {
    const bytes = file === 'pms-config.txt' ? Buffer.from(SETTINGS_TEXT) : readFileSync(path.join(releaseDir, file));
    writeFileSync(path.join(uploadDir, file), bytes);
    return { file, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
  });
}

buildPages();
const copied = gatherUpload();
const { commit, changed } = await gitInfo();

console.log('\n  Ready to upload: build-svelte/upload/\n');
for (const { file, size, hash } of copied) console.log(`    ${file.padEnd(16)}${String(size).padStart(10)} bytes   sha256 ${hash}…`);
console.log(`\n  Built from ${commit ? `commit ${commit}${changed ? ' with uncommitted changes' : ''}` : 'a copy with no git history'}.`);

if (process.argv.includes('--zip')) {
  console.log(zipFlat(path.join(ROOT, 'build-svelte', 'upload.zip'), uploadDir, FILES) ? '  Zip: build-svelte/upload.zip' : '  (Could not make the zip on this computer; upload the four files from the folder instead.)');
}
console.log('\n  On SharePoint: upload the four files into the PMS folder (replace the old ones; keep an existing pms-config.txt if the site uses a prefix),');
console.log('  open setup.html and run the self-test. Official package with checksums: commit, then npm run package:release.\n');
