// Phase 9c (LIC-1): THIRD-PARTY-NOTICES.txt names every runtime dependency of the review's table, with the lock file's version and the whole licence
// text, says so where a licence file is missing, and mentions no dev-only tool. The list below is the review's table typed again here, on purpose:
// taking an entry out of the script's own list must fail this test.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, test } from 'node:test';
import { RUNTIME_DEPENDENCIES, buildNotices, copyrightLines, fontCopyright } from './build-third-party-notices.js';

const root = path.join(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8')).packages;

/** REVIEW-9A.md (in git history at 7347c72), "Dependencies and licences": [name, lock path] */
const REVIEW_TABLE = [
  ['svelte', 'node_modules/svelte'], ['svelte-spa-router', 'node_modules/svelte-spa-router'], ['regexparam', 'node_modules/regexparam'],
  ['canvas-confetti', 'node_modules/canvas-confetti'], ['lean-qr', 'node_modules/lean-qr'],
  ['chart.js', 'node_modules/chart.js'], ['@kurkle/color', 'node_modules/@kurkle/color'],
  ['jspdf', 'node_modules/jspdf'], ['fflate', 'node_modules/fflate'], ['fast-png', 'node_modules/fast-png'], ['iobuffer', 'node_modules/iobuffer'],
  ['pako', 'node_modules/pako'], ['@babel/runtime', 'node_modules/@babel/runtime'],
  ['pptxgenjs', 'node_modules/pptxgenjs'], ['jszip', 'node_modules/jszip'], ['lie', 'node_modules/lie'],
  ['pako', 'node_modules/jszip/node_modules/pako'], ['readable-stream', 'node_modules/readable-stream'], ['setimmediate', 'node_modules/setimmediate'],
  ['tailwindcss', 'node_modules/tailwindcss'],
];
/** Tools that build or test the project and never enter a page (and are not in the review's table). Distinctive enough to look for in the licence texts too. */
const DEV_ONLY = ['playwright', 'axe-core', 'pdfjs-dist', 'pdf.js', 'vite', 'esbuild', 'svelte-check', 'typescript', 'cheerio', 'rollup', 'rolldown'];
/** The local server's packages: in no page. Words like "express" are in licence prose, so only the entry names are checked for these. */
const SERVER_ONLY = ['express', 'cors'];

let result;
before(async () => {
  result = await buildNotices();
});

test('every runtime dependency of the review is in the file, with the lock file\'s version', () => {
  const { text } = result;
  for (const [name, lockPath] of REVIEW_TABLE) {
    const version = lock[lockPath]?.version;
    assert.ok(version, `${lockPath} is in the lock file`);
    assert.ok(text.includes(`\n${name} ${version}\nLicence: `), `${name} ${version} has an entry`);
  }
  assert.ok(text.includes('\nOpen Sans\nLicence: Apache-2.0\n'), 'Open Sans has an entry');
  assert.equal(result.entries.length, REVIEW_TABLE.length + 1, 'nothing else is in it');
  assert.equal(RUNTIME_DEPENDENCIES.length, REVIEW_TABLE.length + 1, 'the script keeps exactly the review\'s list');
});

test('the dependencies in package.json are each either in the file or named here as not in any page', async () => {
  const { dependencies } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const notInAPage = new Set(SERVER_ONLY);
  for (const name of Object.keys(dependencies)) {
    assert.ok(notInAPage.has(name) || result.entries.some((entry) => entry.name === name), `${name}: add it to RUNTIME_DEPENDENCIES, or say here why it is in no page`);
  }
});

test('no dev-only tool is mentioned', () => {
  for (const tool of DEV_ONLY) {
    const word = new RegExp(`(^|[^A-Za-z0-9@/-])${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9/-])`, 'i');
    assert.ok(!word.test(result.text), `${tool} appears in the notices`);
  }
  for (const entry of result.entries) assert.ok(![...DEV_ONLY, ...SERVER_ONLY].includes(entry.name), entry.name);
  for (const name of Object.keys(lock).filter((key) => lock[key].dev).map((key) => key.replace(/^.*node_modules\//, ''))) {
    if (name === 'tailwindcss') continue; // a dev dependency whose generated CSS is in every page, and so in the table
    assert.ok(!result.entries.some((entry) => entry.name === name), `${name} is a dev dependency`);
  }
});

test('each entry carries its whole licence text, a copyright line and no placeholder', async () => {
  assert.deepEqual(result.missing, [], 'every package has a licence file here');
  assert.deepEqual(result.warnings, [], 'node_modules holds the versions of the lock file');
  assert.ok(!/undefined|null|\[object/.test(result.text));
  for (const entry of result.entries) {
    assert.ok(entry.files.length > 0, `${entry.label} has a licence file`);
    for (const relative of entry.files) {
      let licence = (await readFile(path.join(root, relative), 'utf8')).replace(/\r\n/g, '\n').trimEnd();
      if (entry.name === 'jszip') licence = licence.split(/^GPL version 3\s*$/m)[0].trimEnd();
      assert.ok(result.text.includes(licence), `${entry.label}: the text of ${relative} is whole`);
    }
    const block = entry.text.split('\n').slice(0, 12).join('\n');
    assert.ok(/^Copyright line: \S/m.test(block), `${entry.label} has a copyright line`);
  }
  assert.ok(!result.text.includes('GNU GENERAL PUBLIC LICENSE'), 'the GPL option of jszip is not reproduced');
});

test('jszip is said to be offered as MIT or GPL-3.0-or-later and used under MIT; the dist-file packages say whose copy they are', () => {
  const jszip = result.entries.find((entry) => entry.name === 'jszip').text;
  assert.match(jszip, /^Licence: MIT or GPL-3\.0-or-later .*used here under MIT$/m);
  for (const name of ['lie', 'readable-stream', 'setimmediate']) assert.match(result.entries.find((entry) => entry.name === name).text, /bundled inside jszip's own prebuilt dist file/);
  assert.match(result.entries.find((entry) => entry.label === 'pako 1.0.11').text, /bundled inside jszip/);
  assert.doesNotMatch(result.entries.find((entry) => entry.label === 'pako 2.2.0').text, /bundled inside jszip/);
});

test('Open Sans: the Apache text of both font folders, once, and the copyright line from the font file itself', () => {
  const font = result.entries.find((entry) => entry.name === 'Open Sans');
  assert.equal(font.files.length, 1, 'the two licence files are identical, so the text is printed once');
  assert.match(font.text, /migration\/src\/assets\/fonts\/LICENSE-OpenSans-Apache-2\.0\.txt, migration\/src\/assets\/report-fonts\/LICENSE-OpenSans-Apache-2\.0\.txt \(identical text\)/);
  assert.match(font.text, /Digitized data copyright .* Google Corporation\./);
  assert.match(font.text, /the licence file has no copyright line/);
  assert.equal(font.text.match(/^ *Copyright line:.*$/gm).length, 1, 'a clause of the Apache text is not taken for a copyright line');
});

test('a licence file that is not there is said to be missing, in the file and in the result; nothing is invented', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'pms-notices-'));
  try {
    await mkdir(path.join(base, 'node_modules/has-licence'), { recursive: true });
    await mkdir(path.join(base, 'node_modules/no-licence'), { recursive: true });
    await writeFile(path.join(base, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/has-licence': { version: '1.0.0', license: 'MIT' }, 'node_modules/no-licence': { version: '2.0.0', license: 'MIT' } } }));
    await writeFile(path.join(base, 'node_modules/has-licence/package.json'), JSON.stringify({ name: 'has-licence', version: '1.0.0' }));
    await writeFile(path.join(base, 'node_modules/has-licence/LICENSE'), 'Copyright (c) 2020 Somebody\n\nThe whole licence.\n');
    await writeFile(path.join(base, 'node_modules/no-licence/package.json'), JSON.stringify({ name: 'no-licence', version: '2.0.0', author: 'Someone Else' }));
    const { text, missing, entries } = await buildNotices({ root: base, dependencies: [{ name: 'has-licence', where: 'x' }, { name: 'no-licence', where: 'y' }] });
    assert.deepEqual(missing, ['no-licence 2.0.0']);
    assert.match(text, /LICENCE FILES MISSING FOR: no-licence 2\.0\.0/);
    assert.match(text, /no-licence 2\.0\.0\nLicence: MIT\nUsed in: y\nLicence file: NO LICENCE FILE FOUND in node_modules\/no-licence\//);
    assert.ok(text.includes('Copyright line: Copyright (c) 2020 Somebody'));
    assert.equal(entries[1].files.length, 0);
    assert.ok(!/Permission is hereby granted/.test(text), 'no licence text was written from memory');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('the copyright rules: what is a notice and what only sounds like one', () => {
  assert.deepEqual(copyrightLines('Copyright (c) 2019, A B\n\nThe above copyright notice shall be included'), ['Copyright (c) 2019, A B']);
  assert.deepEqual(copyrightLines('#Copyright (c) 2014-2018 Calvin Metcalf'), ['Copyright (c) 2014-2018 Calvin Metcalf']);
  assert.deepEqual(copyrightLines('Copyright\n(c) 2010-2025 James Hall\n(c) 2015-2025 yWorks GmbH'), ['(c) 2010-2025 James Hall', '(c) 2015-2025 yWorks GmbH']);
  assert.deepEqual(copyrightLines('   Copyright [yyyy] [name of copyright owner]\n(c) You must retain, in the Source form\ncopyright notice that is included\ncopyright owner or entity authorized'), []);
});

test('the font copyright is read from the name table of the project\'s own TTF', async () => {
  const buffer = await readFile(path.join(root, 'public/assets/Font/open-sans/OpenSans-Regular.ttf'));
  assert.match(fontCopyright(buffer), /^Digitized data copyright .* 2010-2011, Google Corporation\.$/);
  assert.equal(fontCopyright(Buffer.alloc(12)), '');
});

test('it is an extra file: the three-file build does not know about it', async () => {
  const release = await readFile(path.join(root, 'scripts/build-svelte-release.js'), 'utf8');
  assert.ok(!/notice/i.test(release), 'build-svelte-release.js is not told about the notices');
  assert.match(release, /files\.length !== 3/, 'the release folder is still exactly three files');
});
