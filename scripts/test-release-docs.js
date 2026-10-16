// Phase 10f, part C: the release package's rules and documents. Run: node --test scripts/test-release-docs.js (part of `npm test` and of
// `npm run test:release-package`).
//
// What no page of the package may hold (scripts/release-proofs.js), shown to be able to fail; the checksum file as `shasum -a 256 -c` reads it;
// the permissions table (scripts/permissions.js) held to public/js/pms-schema-meta.js and to VJR's three groups; and RUNBOOK.md and
// RELEASE-NOTES.md (scripts/release-docs.js) held to the site, the steps, the codes and the QA-TESTING.md items. `npm run package:release`
// builds the package itself and runs the same proofs on the real pages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { LIBRARY, LISTS } from '../public/js/pms-schema.js';
import { LIBRARY_META, META } from '../public/js/pms-schema-meta.js';
import { NONE, READ, ROLES, WRITE, participantGroups, permissionRows, permissionsTable } from './permissions.js';
import { DEMO_PIN_HASH, checksumFile, listingProblems, pageProblems, sha256, verifyChecksums, withoutEncodedBytes } from './release-proofs.js';
import { FOLDER_URL, LAST_LINE, LATER, QA_BY_NOTE, QA_BY_STEP, SETTINGS, SETTINGS_TEXT, SITE, UPLOADED, releaseNotes, runbook } from './release-docs.js';

const ROOT = path.join(import.meta.dirname, '..');

describe('what no page of the package may hold', () => {
  const clean = '<!doctype html><script>const digits = "0123456789"; const where = location.pathname.split("/sites/");</script>';

  it('a clean page passes, and each thing it must not hold is found (the check can fail)', () => {
    assert.deepEqual(pageProblems('index.html', clean), []);
    const cases = [
      ['https://internal.global.deloitteonline.com/sites/PCOE', 'a site address'],
      ['https://contoso.sharepoint.com/sites/x', 'a site address'],
      ['/sites/PCOE/', 'a site address'],
      ['CreativeExpCOE', 'the old site'],
      ['Shared%20Documents/PMS/index.html', 'a folder name'],
      ['Shared Documents', 'a folder name'],
      ['p_cec_02', 'an old copy'],
      [DEMO_PIN_HASH, 'a PIN hash'],
      [sha256('482916'), 'a PIN hash'],
      ['pin: "1234"', 'the demo PIN'],
    ];
    for (const [text, what] of cases) {
      const found = pageProblems('admin.html', `${clean}<script>const x = ${JSON.stringify(text)};</script>`);
      assert.ok(found.some((line) => line.includes(what)), `${text}: ${found.join(' / ') || 'not found'}`);
    }
  });

  it('bytes a page carries (a picture, a font) are not read as words, so random base64 cannot fail it; a hash is looked for even there', () => {
    const random = Buffer.from(Array.from({ length: 3000 }, (_, index) => (index * 2654435761) % 251)).toString('base64');
    const planted = `${random.slice(0, 500)}1234PCOE${random.slice(500)}`;
    assert.equal(withoutEncodedBytes(`a data:image/webp;base64,${planted} b`), 'a data:<bytes> b');
    assert.deepEqual(pageProblems('setup.html', `${clean}<script>const p = "data:image/webp;base64,${planted}";</script>`), []);
    assert.deepEqual(pageProblems('admin.html', `${clean}<script>const f = "${planted}";</script>`), [], 'a long base64 string is bytes too');
    assert.ok(pageProblems('setup.html', `${clean}<script>const p = "data:image/webp;base64,${random}${DEMO_PIN_HASH}";</script>`).length > 0);
  });
  // (The real pages are held to the same rules by scripts/test-bundle-budget.js, which builds them fresh, and by npm run package:release.)
});

describe('the files of the package (Phase 10g)', () => {
  const folder = ['index.html', 'admin.html', 'setup.html', 'pms-config.txt', 'THIRD-PARTY-NOTICES.txt', 'RELEASE-NOTES.md', 'RUNBOOK.md', 'SHA256SUMS.txt'];

  it('the settings file is pms-config.txt and no file is a .json: the first real site would not hand one out of a document library (the check can fail)', () => {
    assert.deepEqual(listingProblems(folder), []);
    assert.ok(listingProblems([...folder, 'pms-config.json']).some((line) => line.includes('pms-config.json')), 'the old name');
    assert.ok(listingProblems([...folder, 'other.JSON']).length > 0, 'any .json, whatever the case');
    assert.ok(listingProblems(folder.filter((name) => name !== 'pms-config.txt')).some((line) => line.includes('no pms-config.txt')), 'and the settings file must be there');
  });
});

describe('the checksum file', () => {
  it('is what shasum -a 256 writes ("<hex>  <name>", sorted, LF), and reads back true, and false for a changed or missing file', () => {
    const files = { 'b.html': Buffer.from('bee'), 'a.json': Buffer.from('{}') };
    const text = checksumFile(Object.entries(files).map(([name, bytes]) => ({ name, sha256: sha256(bytes) })));
    assert.equal(text, `${sha256('{}')}  a.json\n${sha256('bee')}  b.html\n`);
    assert.deepEqual(verifyChecksums(text, (name) => files[name] ?? null).map((entry) => entry.ok), [true, true]);
    assert.deepEqual(verifyChecksums(text, (name) => (name === 'b.html' ? Buffer.from('bea') : files[name])).map((entry) => entry.why), ['', 'different']);
    assert.deepEqual(verifyChecksums(text, (name) => (name === 'a.json' ? null : files[name])).map((entry) => entry.why), ['missing', '']);
  });
});

describe('the permissions, from pms-schema-meta.js', () => {
  it('every list and the picture library, each role\'s level worked out from who reads and writes it', () => {
    const rows = permissionRows();
    assert.deepEqual(rows.map((row) => row.title), [...Object.keys(META).map((key) => LISTS[key].title), LIBRARY]);
    for (const row of rows) {
      const entry = row.key === 'logoLibrary' ? LIBRARY_META : META[row.key];
      for (const { page } of ROLES) {
        const expected = entry.writes.includes(page) ? 'Contribute' : entry.reads.includes(page) ? READ : NONE;
        assert.ok(row[page].startsWith(expected), `${row.title}, ${page}: ${row[page]}`);
      }
    }
    assert.ok(WRITE.startsWith('Contribute'));
  });

  it('the participant accounts: write the five lists of a visit, only read the content, the settings, the guest list and the pictures, and never read the admins', () => {
    assert.deepEqual(participantGroups(), {
      write: ['PMSClientSessions', 'PMSParticipants', 'PMSGuestQRCodes', 'PMSVisitLog', 'PMSParticipantAnswers'],
      read: ['PMSClients', 'PMSActivities', 'PMSActivityQuestions', 'PMSAnswerOptions', 'PMSAppSettings', 'PMSGuestList', 'PMSClientImages'],
      none: ['PMSAdminUsers'],
    });
  });

  it('the table is in SHAREPOINT-LISTS.md as it is generated', async () => {
    const reference = (await readFile(path.join(ROOT, 'SHAREPOINT-LISTS.md'), 'utf8')).replace(/\r\n/g, '\n');
    assert.ok(reference.includes(permissionsTable()), 'SHAREPOINT-LISTS.md carries the table: npm run build:lists-reference');
  });
});

describe('RUNBOOK.md', () => {
  const book = runbook({ commit: 'abc1234', folderName: 'pms-abc1234' });
  const steps = [...book.matchAll(/^(\d+)\. \*\*(.+?)\*\*$/gm)];

  it('sixteen numbered steps in the brief\'s order, each with a line of what to send back (Phase 10h: the self-test is step 10)', () => {
    assert.deepEqual(steps.map((match) => Number(match[1])), Array.from({ length: 16 }, (_, index) => index + 1));
    const titles = steps.map((match) => match[2]);
    for (const [index, words] of [[0, /checksums/], [1, /four files/], [2, /This copy of the app/], [3, /Show the plan/], [4, /^Create, only if the plan lists something/],
      [5, /Check Lists/], [6, /Mark the site as ready/], [7, /Add an admin/], [8, /Seed sample clients/], [9, /^Optional: run the self-test/], [10, /permissions/], [11, /support contact/], [12, /Go live/],
      [13, /iPad/], [14, /Results/], [15, /setup\.html/]]) assert.match(titles[index], words, `step ${index + 1}`);
    const bodies = book.split(/^\d+\. \*\*/m).slice(1, 17);
    for (const [index, body] of bodies.entries()) assert.match(body, new RegExp(`\\n {${String(index + 1).length + 2}}\\*Send back:\\* \\S`), `step ${index + 1} says what to send back, indented under its number`);
  });

  it('the real addresses, the four files, the settings file exactly, and no demo PIN', () => {
    assert.equal(SITE, 'https://internal.global.deloitteonline.com/sites/PCOE');
    assert.equal(FOLDER_URL, 'https://internal.global.deloitteonline.com/sites/PCOE/Shared%20Documents/PMS');
    for (const address of [`${FOLDER_URL}/index.html`, `${FOLDER_URL}/admin.html`, `${FOLDER_URL}/setup.html`]) assert.ok(book.includes(address), address);
    assert.deepEqual([...UPLOADED], ['index.html', 'admin.html', 'setup.html', 'pms-config.txt']);
    assert.equal(SETTINGS_TEXT, '{"configVersion": 1, "listPrefix": "", "label": "PMS"}');
    assert.deepEqual(JSON.parse(SETTINGS_TEXT), SETTINGS);
    assert.ok(book.includes(SETTINGS_TEXT));
    assert.match(book, /There is no demo PIN on this site/);
    assert.match(book, /Shared Documents\/PMS/);
    assert.match(book, /Session_x0020_Id/);
  });

  it('the support contact is a settings file a page accepts, and the participant groups are the table\'s', async () => {
    const { wrongSetting } = await import('../migration/src/lib/deploy-settings.js');
    const json = /```json\n\s*(\{.+\})\n\s*```/.exec(book)?.[1];
    assert.ok(json, 'the exact JSON is in the runbook');
    assert.equal(wrongSetting(JSON.parse(json)), '', 'and every page would accept it');
    assert.equal(wrongSetting(SETTINGS), '');
    for (const title of [...participantGroups().write, ...participantGroups().read, ...participantGroups().none]) assert.ok(book.includes(`\`${title}\``), title);
    assert.ok(book.includes(permissionsTable().split('\n')[2]), 'the table itself');
  });

  it('what to send back, the codes, the printed QR codes, every QA item from 102 to 132 and 138 to 145, and the last line', () => {
    assert.match(book, /Screenshots at steps 3, 4, 6, 7, 13, 14 and 15, the lines of steps 1, 5, 8 and 9, the table of step 10, the permissions of step 11/);
    assert.match(book, /any page that shows a code\*\*, with its \*\*Details\*\* line\./);
    assert.match(book, /\*\*PMS-CFG-\.\.\.\*\* is the settings/);
    assert.match(book, /\*\*PMS-LST-010\*\* means \*\*Mark the site as ready\*\*/);
    assert.match(book, /\*\*PMS-LST-011\*\* means the lists are of an older version than these pages: in Setup press \*\*Show the plan\*\*, \*\*Create\*\* and \*\*Mark the site as ready\*\*/);
    assert.match(book, /\*\*PMS-LST-012\*\* means they are of a newer version: upload the newer files/);
    assert.match(book, /every printed code must be printed again/);
    const covered = new Set([...Object.values(QA_BY_STEP).flat(), ...Object.values(QA_BY_NOTE).flat(), ...LATER.map(([item]) => item)]);
    for (const item of [...Array.from({ length: 31 }, (_, index) => 102 + index), 138, 139, 140, 141, 142, 143, 144, 145]) assert.ok(covered.has(item), `QA item ${item} is answered by a step or said to come later`);
    assert.match(book, /\| Note 8 \| 143 \|/, 'the note\'s items are in the table');
    assert.equal(book.trimEnd().split('\n').at(-1), LAST_LINE);
    assert.match(LAST_LINE, /Steps 1 to 9 of this runbook have run on the real site \(14 Oct 2026, pms-969bf16\), and Go live, a participant's visit and the self-test \(15 Oct 2026, pms-e250a36\)/);
  });

  it('a note before the steps for the PCOE site, whose lists are version 2 (Phase 10i): the three pages, Setup, the plan, Create, raised, Check Lists, a guest and a code, the self-test, Results, the iPad', () => {
    const [before, afterSteps] = book.split('## The steps');
    assert.ok(afterSteps, 'the steps follow the note');
    const note = before.slice(before.indexOf('## '));
    assert.match(note, /^## The PCOE site has its lists of version 2: do this instead of steps 1 to 11/);
    assert.match(note, /pms-969bf16 ran steps 1 to 9 on this site on 14 Oct 2026/, 'it says which runs it follows');
    assert.match(note, /`PMSAdminUsers` locked to the site owners/);
    assert.match(note, /On 15 Oct 2026 the package pms-e250a36 ran there[^\n]*\*\*Results did not load\*\*: "SharePoint \(400\): Value does not fall within the expected range\."/);
    assert.match(note, /\*\*This SharePoint will not return a column named `DisplayName`\*\* \(observed 15 Oct 2026/, 'as observed');
    assert.match(note, /`PMSGuestList\.GuestName`[^\n]*`PMSVisitLog\.SignedInName`/);
    const items = [...note.matchAll(/^(\d+)\. (.+)$/gm)].map((match) => [Number(match[1]), match[2]]);
    assert.deepEqual(items.map(([number]) => number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const said = Object.fromEntries(items);
    assert.match(said[1], /^Replace `index\.html`, `admin\.html` and `setup\.html`[^\n]*Keep `pms-config\.txt` as it is[^\n]*Change nothing else\./);
    assert.ok(said[1].includes(SETTINGS_TEXT), 'the content that stays, exactly');
    assert.match(said[1], /Delete `pms-config\.json` if it is still there[^\n]*does not serve `\.json` files/);
    assert.match(said[2], /setup\.html: "1\. This copy of the app" shows the build `pms-abc1234`, and under "2\. Lists" it says in red that the lists are version 2 and this version of the app needs version 3[^\n]*PMS-LST-011, SchemaVersion 2, this build needs 3/);
    assert.match(said[3], /^Press \*\*Show the plan\*\*\. Expect \*\*"0 lists, 2 columns, 0 settings to create\."\*\*: `GuestName` on PMSGuestList and `SignedInName` on PMSVisitLog, and nothing else; under what Setup will not touch, the two old `DisplayName` columns, "no longer used since version 3", marked harmless/);
    assert.match(said[4], /^Press \*\*Create\*\* and confirm\. Expect \*\*"Created 0 lists, 2 columns and 0 settings in \.\.\. s \(2 writes\)\."\*\*/);
    assert.match(said[5], /\*\*"Raised the lists from version 2 to version 3\."\*\*/);
    assert.match(said[6], /^Press \*\*Check Lists\*\*: every row \*\*Ready\*\*/);
    assert.match(said[7], /admin\.html[^\n]*\*\*Guests scan a personal QR\*\*[^\n]*\*\*Guests and QR\*\* paste one name[^\n]*\*\*Add 1 guest\*\*, then \*\*Generate all codes \(1\)\*\*: the guest list and the codes now have an item each/);
    assert.match(said[8], /^Back in Setup, run the self-test \(step 10\) and send back \*\*the whole table\*\*\. Expect "Passed: 11 of 11 steps", and both probes report[^\n]*`PMSGuestList\.DisplayName` and `PMSVisitLog\.DisplayName`/);
    assert.match(said[9], /\*\*Results\*\*: the live session's card loads[^\n]*\*\*"Unnamed participant 1"\*\*[^\n]*everyone who visits from now on is named/);
    assert.match(said[10], /^Then step 14 on an iPad, \*\*by scanning the guest's QR code of step 7\*\*[^\n]*then step 16\./);
    assert.match(afterSteps, /\n16\. \*\*Remove setup\.html, or restrict it\.\*\*/, 'step 16 is where it ends');
    // The old name is said where the note tells you to delete it, in the observation, and in the reason a code can mean: nowhere as a file to upload.
    assert.ok(!UPLOADED.includes('pms-config.json'));
    const upload = /\n2\. \*\*Upload the four files\.\*\*([\s\S]*?)\n3\. /.exec(book)?.[1] ?? '';
    assert.ok(upload.includes('`pms-config.txt`') && !upload.includes('pms-config.json'), 'step 2 uploads pms-config.txt');
    assert.match(upload, /`\.txt` on purpose/, 'and says why it is a .txt');
    const support = /\n12\. \*\*Optional: a support contact\.\*\*([\s\S]*?)\n13\. /.exec(book)?.[1] ?? '';
    assert.match(support, /replace pms-config\.txt in the folder/, 'step 12 names pms-config.txt');
    assert.ok(!support.includes('pms-config.json'));
    assert.match(afterSteps, /\*\*PMS-CFG-002\*\* with `page 200`[^\n]*pms-config\.txt/, 'and a code that means the file is not being handed out says what to look at');
  });

  it('step 10, the self-test: optional, safe on a new site, deletes what it makes, expects every step to pass, and asks for the whole table (Phase 10h; eleven steps since Phase 10i)', () => {
    const selfTest = /\n10\. \*\*Optional: run the self-test\.\*\*([\s\S]*?)\n11\. /.exec(book)?.[1] ?? '';
    assert.match(selfTest, /`PMSParticipantAnswers`/);
    assert.match(selfTest, /deletes everything it made\. It is safe on a new site with no real answers/);
    assert.match(selfTest, /asks the site four read-only questions/);
    assert.match(selfTest, /Expect \*\*"Passed: 11 of 11 steps"\*\*/);
    assert.match(selfTest, /"Probe \(read-only\): columns this site will not return by name"[^\n]*refused `DisplayName` on PMSVisitLog, observed 15 Oct 2026/);
    assert.match(selfTest, /"Refused: AppId enforces unique values\." \(this site refuses a duplicate with status 500, observed 14 Oct 2026/);
    assert.match(selfTest, /columns this site leaves out of a read that names no columns/);
    assert.match(selfTest, /\*Send back:\* the whole table of steps/);
  });

  it('every QA item it names is in QA-TESTING.md', async () => {
    const qa = await readFile(path.join(ROOT, 'QA-TESTING.md'), 'utf8');
    for (const item of [...Object.values(QA_BY_STEP).flat(), ...Object.values(QA_BY_NOTE).flat(), ...LATER.map(([number]) => number)]) assert.match(qa, new RegExp(`^${item}\\. \\*\\*`, 'm'), `QA-TESTING.md item ${item}`);
  });
});

describe('RELEASE-NOTES.md', () => {
  it('what it is, the commit, each file with its checksum, what changed since the 9c package, and what is not proven', () => {
    const files = [{ name: 'index.html', bytes: 368_000, gzip: 155_000, sha256: 'a'.repeat(64) }, { name: 'pms-config.txt', bytes: 54, sha256: 'b'.repeat(64) }];
    const notes = releaseNotes({ commit: 'abc1234', folderName: 'pms-abc1234', files });
    assert.match(notes, /^# pms-abc1234: release notes/);
    assert.match(notes, /commit `abc1234`/);
    for (const file of files) assert.ok(notes.includes(file.sha256), file.name);
    assert.match(notes, /since the 9c package \(pms-8fe2daa\)/);
    // (Phase 10i) what changed since pms-e250a36, and why: the two columns renamed, Setup raising a site of version 2, the fourth probe, the visit of before.
    assert.match(notes, /## What changed since pms-e250a36 \(15 Oct 2026: on the new site Go live, a visit and the self-test worked, and Results did not load\)/);
    assert.match(notes, /Schema version 3: `GuestName` and `SignedInName` in place of `DisplayName`\.\*\* Why: Results did not load on the real site: "SharePoint \(400\): Value does not fall within the expected range\."/);
    assert.match(notes, /Setup brings a site of version 2 to version 3\.\*\*[^\n]*"Raised the lists from version 2 to version 3\."/);
    assert.match(notes, /The self-test asks a fourth read-only question:\*\* which columns this site will not return by name/);
    assert.match(notes, /A visit logged before the upgrade\*\*[^\n]*"Unnamed participant N"/);
    assert.ok(notes.indexOf('since pms-e250a36') < notes.indexOf('in pms-e250a36'), 'the newest change first');
    // (Phase 10h) what changed in pms-e250a36, since the run of steps 1 to 9 on the new site, and why: the three fixes, the probe, and the one thing a broken site shows differently.
    assert.match(notes, /## What changed in pms-e250a36 \(since pms-969bf16, steps 1 to 9 on the new site, 14 Oct 2026\)/);
    assert.match(notes, /Every item read names its columns\.\*\* Why: [^\n]*`ClientId`/);
    assert.match(notes, /A duplicate refused with 500 is still a duplicate\.\*\* Why:/);
    assert.match(notes, /Setup's buttons can be seen\.\*\* Why:/);
    assert.match(notes, /Setup names the real lists\./);
    assert.match(notes, /a column deleted by hand from a list the admin page reads/);
    assert.ok(notes.indexOf('since pms-969bf16') < notes.indexOf('since pms-50ae628'), 'the newest change first');
    assert.match(notes, /\*\*and with pms-e250a36\*\* \(15 Oct 2026\)[^\n]*Results did not load/);
    // (Phase 10g) what changed since the first upload to the new site, and why.
    assert.match(notes, /## What changed in pms-969bf16 \(since pms-50ae628/);
    assert.match(notes, /settings file is `pms-config\.txt`, not `pms-config\.json`/);
    assert.match(notes, /File Not Found/);
    assert.match(notes, /14 Oct 2026/);
    assert.match(notes, /Details line carries the HTTP status/);
    assert.match(notes, /nothing else changed/i);
    assert.ok(notes.indexOf('since pms-50ae628') < notes.indexOf('since the 9c package'), 'the newest change first');
    for (const words of [/new site/, /`PMS` lists/, /Setup prepares the site/, /Sample pictures/]) assert.match(notes, words);
    assert.match(notes, /Steps 1 to 9 of the runbook have run on the real site/);
    assert.match(notes, /These pages have not run there yet, and nothing has run on an iPad/);
    for (const item of [138, 139, 140, 142, 143, 144, 145]) assert.match(notes, new RegExp(`item ${item}\\b`), `item ${item} is still to see`);
  });
});
