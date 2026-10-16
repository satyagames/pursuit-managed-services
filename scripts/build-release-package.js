// The release package for the new site (Phase 10f): `npm run package:release`.
//
// It is made from a COMMIT, never from a working tree: the tracked tree must be clean, and the pages are built in a fresh checkout of HEAD (a
// temporary git worktree, node_modules linked), so they are what a fresh clone builds. (This Mac's working copy has Windows line ends in the three
// HTML shells, which a build carries as a few carriage-return bytes: AGENTS.md, "Line endings".) No PMS_ value may be set: the package has no
// site, folder or prefix built in; pms-config.txt beside the pages says what they need.
//
// It writes build-svelte/package/pms-<7-character commit>/ (git-ignored, never committed) and pms-<commit>.zip beside it:
//   index.html, admin.html, setup.html   the release build (scripts/build-svelte-release.js), byte for byte
//   pms-config.txt                       exactly {"configVersion": 1, "listPrefix": "", "label": "PMS"}
//   THIRD-PARTY-NOTICES.txt               scripts/build-third-party-notices.js
//   RELEASE-NOTES.md, RUNBOOK.md          scripts/release-docs.js
//   SHA256SUMS.txt                        of the seven files above, as `shasum -a 256` writes it
// and it proves, or stops: no page holds a site address, a folder name, a PIN hash, the demo PIN, `p_cec_` or `CreativeExpCOE`
// (scripts/release-proofs.js), and no file of the package is a .json (Phase 10g: the settings file is pms-config.txt); `shasum -a 256 -c SHA256SUMS.txt` passes in the folder and again in a fresh unzip of the zip, which holds exactly the
// folder's files. What it found is printed and written to test-results/release/package.json.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { checksumFile, listingProblems, pageProblems, sha256, verifyChecksums } from './release-proofs.js';
import { SETTINGS, SETTINGS_TEXT, releaseNotes, runbook } from './release-docs.js';
import { builtSettings } from './site-override.js';

const run = promisify(execFile);
// (Phase 11a-3) On Windows: node_modules is linked as a junction (a directory symlink needs rights a user may not have), the zip is made by Windows'
// own tar.exe (bsdtar; there is no zip there), and the checksums are checked with sha256sum, which reads the same SHA256SUMS.txt and says the same
// "OK" lines (shasum is a Perl script there, which execFile cannot start). Elsewhere, exactly as before.
const WINDOWS = process.platform === 'win32';
const ROOT = path.join(import.meta.dirname, '..');
const PACKAGES = path.join(ROOT, 'build-svelte', 'package');
const PAGES = ['index.html', 'admin.html', 'setup.html'];
const fail = (message) => { console.error(`Release package: ${message}`); process.exit(1); };
const git = async (...args) => (await run('git', args, { cwd: ROOT, maxBuffer: 1 << 24 })).stdout.trim();

if ((await git('status', '--porcelain', '--untracked-files=no'))) fail('the tracked tree has changes. Commit them first: a package is made from a commit.');
let built;
try { built = builtSettings(); } catch (error) { fail(error.message); }
if (Object.keys(built).length) fail(`PMS_ values are set (${Object.keys(built).join(', ')}): this package has nothing built in. Unset them.`);
if (JSON.stringify(JSON.parse(SETTINGS_TEXT)) !== JSON.stringify(SETTINGS)) fail('the settings text and the settings disagree.');

const commit = await git('rev-parse', '--short=7', 'HEAD');
const name = `pms-${commit}`;
const folder = path.join(PACKAGES, name);
const zip = path.join(PACKAGES, `${name}.zip`);

// 1. A fresh checkout of the commit, and the build in it.
const scratch = await mkdtemp(path.join(os.tmpdir(), 'pms-package-'));
const checkout = path.join(scratch, 'checkout');
await git('worktree', 'add', '--detach', checkout, 'HEAD');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PMS_')));
try {
  await symlink(path.join(ROOT, 'node_modules'), path.join(checkout, 'node_modules'), WINDOWS ? 'junction' : 'dir');
  console.log(`Building ${name} in a fresh checkout of ${commit}...`);
  await run(process.execPath, ['scripts/build-svelte-release.js'], { cwd: checkout, env: environment, maxBuffer: 1 << 26 });
  await run(process.execPath, ['scripts/build-third-party-notices.js', path.join(scratch, 'THIRD-PARTY-NOTICES.txt')], { cwd: checkout, env: environment, maxBuffer: 1 << 24 });

  // 2. The folder.
  await rm(folder, { recursive: true, force: true });
  await rm(zip, { force: true });
  await mkdir(folder, { recursive: true });
  for (const page of PAGES) await copyFile(path.join(checkout, 'build-svelte', 'release', page), path.join(folder, page));
  await copyFile(path.join(scratch, 'THIRD-PARTY-NOTICES.txt'), path.join(folder, 'THIRD-PARTY-NOTICES.txt'));
  await writeFile(path.join(folder, 'pms-config.txt'), SETTINGS_TEXT);
} finally {
  // The link first, by itself: on Windows `git worktree remove --force` follows a junction and deletes what is inside it, the real node_modules
  // (Phase 11a-3: it did).
  await unlink(path.join(checkout, 'node_modules')).catch(() => {});
  await git('worktree', 'remove', '--force', checkout);
}

// 3. What no page may hold.
const problems = [];
const files = [];
for (const page of PAGES) {
  const bytes = await readFile(path.join(folder, page));
  problems.push(...pageProblems(page, bytes.toString('utf8')));
  if (bytes.includes(13)) problems.push(`${page} has carriage returns: it was not built from a fresh checkout`);
  files.push({ name: page, bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, sha256: sha256(bytes) });
}
if (problems.length) fail(`a page holds what it must not:\n  ${problems.join('\n  ')}`);
for (const other of ['pms-config.txt', 'THIRD-PARTY-NOTICES.txt']) {
  const bytes = await readFile(path.join(folder, other));
  files.push({ name: other, bytes: bytes.length, sha256: sha256(bytes) });
}

// 4. The documents, then the checksums of everything.
const notes = releaseNotes({ commit, folderName: name, files });
const book = runbook({ commit, folderName: name });
await writeFile(path.join(folder, 'RELEASE-NOTES.md'), notes);
await writeFile(path.join(folder, 'RUNBOOK.md'), book);
for (const [doc, text] of [['RELEASE-NOTES.md', notes], ['RUNBOOK.md', book]]) files.push({ name: doc, bytes: Buffer.byteLength(text), sha256: sha256(text) });
await writeFile(path.join(folder, 'SHA256SUMS.txt'), checksumFile(files));

// 5. The checks: in the folder, then in a fresh unzip of the zip.
const check = async (where) => {
  const { stdout } = await (WINDOWS ? run('sha256sum', ['-c', 'SHA256SUMS.txt'], { cwd: where }) : run('shasum', ['-a', '256', '-c', 'SHA256SUMS.txt'], { cwd: where }));
  const mine = verifyChecksums(await readFile(path.join(where, 'SHA256SUMS.txt'), 'utf8'), (file) => {
    try { return readFileSync(path.join(where, file)); } catch { return null; }
  });
  return { stdout: stdout.trim(), mine };
};
const inFolder = await check(folder);
await (WINDOWS ? run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', `${name}.zip`, name], { cwd: PACKAGES }) : run('zip', ['-X', '-q', '-r', `${name}.zip`, name], { cwd: PACKAGES }));
const unzipped = await mkdtemp(path.join(os.tmpdir(), 'pms-unzip-'));
await run('unzip', ['-q', zip, '-d', unzipped]);
const fromZip = await check(path.join(unzipped, name));
const listed = (await readdir(path.join(unzipped, name))).sort();
const expected = [...files.map((file) => file.name), 'SHA256SUMS.txt'].sort();
await rm(unzipped, { recursive: true, force: true });
await rm(scratch, { recursive: true, force: true });
for (const [where, result] of [['the folder', inFolder], ['a fresh unzip', fromZip]]) {
  const lines = result.stdout.split('\n');
  if (lines.length !== files.length || !lines.every((line) => line.endsWith(': OK'))) fail(`shasum -c in ${where} did not pass:\n${result.stdout}`);
  if (result.mine.length !== files.length || !result.mine.every((entry) => entry.ok)) fail(`the checksums do not hold in ${where}`);
}
if (JSON.stringify(listed) !== JSON.stringify(expected)) fail(`the zip holds ${listed.join(', ')}, not ${expected.join(', ')}`);
// (Phase 10g) The settings file is pms-config.txt, exactly, and no file in the folder or in the zip is a .json file.
const listing = [...listingProblems(await readdir(folder)), ...listingProblems(listed)];
if (listing.length) fail(listing.join('\n  '));
if ((await readFile(path.join(folder, 'pms-config.txt'), 'utf8')) !== SETTINGS_TEXT) fail('pms-config.txt is not exactly the settings text.');

const zipBytes = await readFile(zip);
const summary = {
  name, commit, madeAt: new Date().toISOString(),
  files,
  sha256sums: checksumFile(files),
  zip: { name: `${name}.zip`, bytes: zipBytes.length, sha256: sha256(zipBytes) },
  checks: { folder: inFolder.stdout, unzip: fromZip.stdout, unzipFiles: listed },
  proofs: 'no page holds a site address, a folder name, a PIN hash, the demo PIN, p_cec_ or CreativeExpCOE; pms-config.txt is exactly the settings text and no file is a .json',
};
await mkdir(path.join(ROOT, 'test-results', 'release'), { recursive: true });
await writeFile(path.join(ROOT, 'test-results', 'release', 'package.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${path.relative(ROOT, folder)}/`);
for (const file of files) console.log(`  ${file.sha256}  ${file.name.padEnd(24)} ${String(file.bytes).padStart(9)} B${file.gzip ? `  (gzip -9 ${file.gzip} B)` : ''}`);
console.log(`${path.relative(ROOT, zip)}: ${zipBytes.length} B, SHA-256 ${summary.zip.sha256}`);
console.log('Proved: no page holds a site address, a folder name, a PIN hash, the demo PIN, p_cec_ or CreativeExpCOE; pms-config.txt is exactly the settings text and no file is a .json;');
console.log(`shasum -a 256 -c passes in the folder (${files.length} OK) and in a fresh unzip (${files.length} OK), which holds exactly the folder's ${listed.length} files.`);
