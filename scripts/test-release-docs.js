// Phase 10f, part C: the release package's rules and documents. Run: node --test scripts/test-release-docs.js (part of `npm test` and of
// `npm run test:release-package`).
//
// What no page of the package may hold (scripts/release-proofs.js), shown to be able to fail; the checksum file as `shasum -a 256 -c` reads it;
// the permissions table (scripts/permissions.js) held to migration/src/lib/schema/pms-schema-meta.js and to VJR's three groups; and RUNBOOK.md and
// RELEASE-NOTES.md (scripts/release-docs.js) held to the site, the steps, the codes and the QA-TESTING.md items. `npm run package:release`
// builds the package itself and runs the same proofs on the real pages.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { LIBRARY, LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { LIBRARY_META, META } from '../migration/src/lib/schema/pms-schema-meta.js';
import { NONE, READ, ROLES, WRITE, participantGroups, permissionRows, permissionsTable } from './permissions.js';
import { DEMO_PIN_HASH, checksumFile, listingProblems, pageProblems, sha256, verifyChecksums, withoutEncodedBytes } from './release-proofs.js';
import { FOLDER_URL, LAST_LINE, LATER, QA_BY_NOTE, QA_BY_STEP, SETTINGS, SETTINGS_TEXT, SITE, TIMING_CHECK, UPLOADED, releaseNotes, runbook } from './release-docs.js';

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

  it('the participant accounts: write the five lists of a visit, only read the content, the settings, the guest list and the pictures, and never read the admins or who may do what', () => {
    assert.deepEqual(participantGroups(), {
      write: ['PMSClientSessions', 'PMSParticipants', 'PMSGuestQRCodes', 'PMSVisitLog', 'PMSParticipantAnswers'],
      read: ['PMSClients', 'PMSActivities', 'PMSActivityQuestions', 'PMSAnswerOptions', 'PMSAppSettings', 'PMSGuestList', 'PMSClientImages'],
      none: ['PMSAdminUsers', 'PMSUsers', 'PMSRoleAssignments', 'PMSAuditLog'], // (Prompt 21: the three access lists are no guest's business)
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
    const { wrongSetting } = await import('../migration/src/lib/settings/deploy-settings.js');
    const json = /```json\n\s*(\{.+\})\n\s*```/.exec(book)?.[1];
    assert.ok(json, 'the exact JSON is in the runbook');
    assert.equal(wrongSetting(JSON.parse(json)), '', 'and every page would accept it');
    assert.equal(wrongSetting(SETTINGS), '');
    for (const title of [...participantGroups().write, ...participantGroups().read, ...participantGroups().none]) assert.ok(book.includes(`\`${title}\``), title);
    assert.ok(book.includes(permissionsTable().split('\n')[2]), 'the table itself');
  });

  it('what to send back, the codes, the printed QR codes, every QA item from 102 to 132 and 138 to 166, and the last line', () => {
    assert.match(book, /Screenshots at steps 3, 4, 6, 7, 13, 14 and 15, the lines of steps 1, 5, 8 and 9, the table of step 10, the permissions of step 11/);
    assert.match(book, /any page that shows a code\*\*, with its \*\*Details\*\* line\./);
    assert.match(book, /\*\*PMS-CFG-\.\.\.\*\* is the settings/);
    assert.match(book, /\*\*PMS-LST-010\*\* means \*\*Mark the site as ready\*\*/);
    assert.match(book, /\*\*PMS-LST-011\*\* means the lists are of an older version than these pages: in Setup press \*\*Show the plan\*\*, \*\*Create\*\* and \*\*Mark the site as ready\*\*/);
    assert.match(book, /\*\*PMS-LST-012\*\* means they are of a newer version: upload the newer files/);
    assert.match(book, /every printed code must be printed again/);
    const covered = new Set([...Object.values(QA_BY_STEP).flat(), ...Object.values(QA_BY_NOTE).flat(), ...LATER.map(([item]) => item)]);
    for (const item of [...Array.from({ length: 31 }, (_, index) => 102 + index), ...Array.from({ length: 33 }, (_, index) => 138 + index)]) assert.ok(covered.has(item), `QA item ${item} is answered by a step or said to come later`);
    assert.match(book, /\| Note 4 \| 150, 159, 160 \|/, 'the note\'s items are in the table');
    assert.match(book, /\| Note 5 \| 151, 152, 153 \|/);
    assert.match(book, /\| Note 3 \| 144, 164 \|/);
    assert.match(book, /\| Note 6 \| 157, 158, 161, 165 \|/);
    assert.match(book, /\| Note 8 \| 146, 147, 148, 149 \|/);
    assert.match(book, /\| Note 9 \| 167, 168, 169, 170, 171, 172, 173, 174, 175, 176 \|/, 'the files of Phase 11b and Phase 13');
    // Phase 14: the note says nothing a person sees changed, and ends with the smoke test of this package.
    assert.match(book, /\| Note 10 \| 177, 178, 179, 180, 181 \|/, 'the smoke test of Phase 14');
    assert.match(book, /\| Note 13 \| 195, 196, 197 \|/, 'the full pass of Phase 17');
    assert.match(book, /\*\*This package \(Phase 14\) changes nothing a person sees\*\*/);
    assert.match(book, /^10\. The smoke test of this package\. /m);
    // Phase 15: what this package moves and lines up, and its own step: the motion on an iPad and an iPhone, Reduce Motion, the laptop, the switch.
    assert.match(book, /\| Note 11 \| 182, 183, 184, 185, 186, 187 \|/, 'the motion and the switch of Phase 15');
    assert.match(book, /\*\*This package \(Phase 15\) moves the participant screens and lines them up\*\*[^\n]*Nothing in the lists changes \(version 3\)/);
    assert.match(book, /^11\. The motion and the Animations switch \(Phase 15, QA-TESTING\.md items 182 to 187\)\. [^\n]*Reduce Motion[^\n]*\*\*Brand Studio\*\*[^\n]*\*\*Today\*\*/m);
    for (const line of [/Setup: the Build row says/, /Run self-test/, /a guest's QR code/, /Results/, /Leader report \(PDF\)/]) assert.match(book.slice(book.indexOf('The smoke test of this package')), line);
    assert.equal(book.trimEnd().split('\n').at(-1), LAST_LINE);
    assert.match(LAST_LINE, /Steps 1 to 9 of this runbook have run on the real site \(14 Oct 2026, pms-969bf16\), and Go live, a participant's visit and the self-test \(15 Oct 2026, pms-e250a36\), and with pms-da9fc8d the lists of version 3 and a participant's visit \(15 Oct 2026\)/);
  });

  it('a note before the steps for the PCOE site, whose lists are version 3 (Phase 11a, 11a-2): the three pages, Setup as it is, a guest\'s visit, the names on a bar and the headlines, the wall, the Windows laptop, the iPad and the projector, and the timing check if it is still owed', () => {
    const [before, afterSteps] = book.split('## The steps');
    assert.ok(afterSteps, 'the steps follow the note');
    const [note, timing] = before.slice(before.indexOf('## ')).split('### The timing check');
    assert.ok(timing, 'the timing check follows the note');
    assert.match(note, /^## The PCOE site has its lists of version 3: do this instead of steps 1 to 11/);
    assert.match(note, /pms-969bf16 ran steps 1 to 9 on this site on 14 Oct 2026/, 'it says which runs it follows');
    assert.match(note, /`PMSAdminUsers` locked to the site owners/);
    assert.match(note, /then pms-da9fc8d, whose lists are of \*\*version 3\*\* \(`PMSGuestList\.GuestName` and `PMSVisitLog\.SignedInName`/);
    assert.match(note, /\*\*the participant page responded slowly, showing its loading lines\*\* \(reported by VJR, 15 Oct 2026\), and pms-0a1c701 made it wait for fewer requests/);
    assert.match(note, /With pms-0a1c701 \*\*Results showed plain blue bars and totals only, and nothing showed who picked what\*\* \(reported by VJR, 15 Oct 2026/, 'what was reported');
    assert.match(note, /With pms-3fb312a, \*\*on a colleague's Windows laptop in Chrome, a confidence question in full screen had a scrollbar inside its chart and its tooltip cut off[^\n]*\(photographed by VJR, 16 Oct 2026\)/, 'and what was seen with 11a');
    assert.match(note, /\*\*Replace the three pages; nothing else changes\. The lists stay at version 3, and nothing in Setup changes\.\*\*/);
    // (Phase 11a-3) what was seen with pms-283ad18, and that the participant page changed this time.
    assert.match(note, /With pms-283ad18, \*\*a chart's tooltip could lie over the question, the "got it right first time" line and the Show answer \/ View as table buttons above its mark, and a locked activity's title was too faint to read\*\* \(photographed by Satyadev, 16 Oct 2026\)/);
    assert.match(note, /The participant page changed for the first time since pms-0a1c701: a locked activity's title, and when it looks again after the network comes back\./);
    const items = [...note.matchAll(/^(\d+)\. (.+)$/gm)].map((match) => [Number(match[1]), match[2]]);
    assert.deepEqual(items.map(([number]) => number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 'sixteen steps since Prompt 21, Phase 1 (fifteen since Prompt 19)');
    const said = Object.fromEntries(items);
    // (Phase 18) Brand Studio in Content: its own step, and the note says what moved and that no data, list or setting changed.
    assert.match(said[14], /^Brand Studio in the Content tab \(Phase 18, QA-TESTING\.md items 198 to 204\)[^\n]*\*\*Content\*\*[^\n]*Activities \| Brand[^\n]*\*\*Brand\*\* on a client's row[^\n]*#content\/brand[^\n]*Unsaved changes[^\n]*Preview an activity in this look\.\.\.[^\n]*\*Send back:\*/);
    assert.match(note, /\*\*This package \(Phase 18\) moves Brand Studio into the Content tab\*\*[^\n]*no data, list, column or setting changed/);
    assert.match(note, /step 13 is Phase 17's; step 14 is Phase 18's; step 15 is Prompt 19's; step 16 is this package's\./);
    // (Prompt 19) the sign-in that runs out: its own step, and the note says what changed and that no data, list, column or setting did.
    assert.match(said[15], /^The sign-in that runs out \(Prompt 19, QA-TESTING\.md items 205 to 210\)[^\n]*F12[^\n]*SPRequestGuid[^\n]*sleep[^\n]*Your SharePoint sign-in needs refreshing[^\n]*\*\*Reload\*\*[^\n]*unsaved[^\n]*Idle session sign-out[^\n]*\*Send back:\*/);
    assert.match(note, /\*\*This package \(Prompt 19\) renews a SharePoint sign-in that stops being accepted, or says so plainly\*\*[^\n]*no data, list, column or setting changed/);
    // (Prompt 20) the confidence check, and (Prompt 21, Phase 1) who may do what: the note says the lists move to version 5 and what Setup does.
    assert.match(note, /\*\*This package adds the confidence check, Before and After \(Prompt 20\), and who may do what \(Prompt 21, Phase 1\)\*\*[^\n]*unlocks with their PIN as before[^\n]*\*\*The lists move to version 5\*\*[^\n]*step 2/);
    assert.match(said[16], /^Who may do what \(Prompt 21, Phase 1, QA-TESTING\.md items 216 to 221\)[^\n]*the PIN screen as before[^\n]*Add yourself as a Super admin in Setup[^\n]*\*\*People and access\*\*[^\n]*\*\*Make me a Super admin\*\*[^\n]*\*\*Copy into the new lists\*\*[^\n]*\*Send back:\*/);
    assert.match(book, /\| Note 16 \| 216, 217, 218, 219, 220, 221 \|/, 'the steps of Prompt 21, Phase 1');
    assert.match(book, /\| Note 15 \| 205, 206, 207, 208, 209, 210 \|/, 'the steps of Prompt 19');
    assert.match(book, /\| Note 14 \| 198, 199, 200, 201, 202, 203, 204 \|/, 'the steps of Phase 18');
    assert.match(said[13], /^One full pass of the package \(Phase 17, QA-TESTING\.md items 195 to 197\)[^\n]*11 of 11[^\n]*by QR code and by manual select[^\n]*every kind of question[^\n]*\*\*Delete session\*\*[^\n]*8 requests[^\n]*\*Send back:\*/);
    assert.match(note, /\*\*This package \(Phase 17\) changes nothing a person sees\*\*: the data layer was cut into parts and stylesheet rules that nothing could match were removed; no data, list, setting or behaviour changed, and the pages were rebuilt from the restructured source\./);
    assert.match(said[12], /^Results, Delete session and editing in place \(Phase 16, QA-TESTING\.md items 188 to 194\)[^\n]*\*\*Delete permanently\*\*[^\n]*refused, in words[^\n]*\*Send back:\*[^\n]*recycle bin/);
    assert.match(said[1], /^Replace `index\.html`, `admin\.html` and `setup\.html`[^\n]*Keep `pms-config\.txt` as it is[^\n]*Change nothing else\./);
    assert.ok(said[1].includes(SETTINGS_TEXT), 'the content that stays, exactly');
    assert.match(said[1], /Delete `pms-config\.json` if it is still there[^\n]*does not serve `\.json` files/);
    // (Prompt 20: the lists move to version 4, so on PCOE Setup now has something to do: two columns, then the version raised. Prompt 21: version 5,
    // three lists and two settings more.)
    assert.match(said[2], /setup\.html: "1\. This copy of the app" shows the build `pms-abc1234`, and the line under "2\. Lists" says the lists are version 3 and this version of the app needs version 5 \(PMS-LST-011\)\. Press \*\*Show the plan\*\*: it names Prompt 20's two columns, `PMSClientSessions\.ConfidenceCheck` and `PMSActivities\.Kind`, version 5's two settings, `PMSAppSettings\.FiscalYearStartMonth` and `PMSAppSettings\.MinSample`, and version 5's three lists, `PMSUsers`, `PMSRoleAssignments` and `PMSAuditLog`\. Press \*\*Create\*\*, then \*\*Mark the site as ready\*\* if Create did not already: expect "Raised the lists from version 3 to version 5\." Nothing else in Setup yet \(step 16 is the rest\)\./);
    assert.match(said[2], /If it says the lists are version 2, PMS-LST-011[^\n]*\*\*Show the plan\*\*, \*\*Create\*\* and \*\*Mark the site as ready\*\*/, 'and what to do if the upgrade was not done');
    assert.match(said[3], /^On an iPad, \*\*scan a named guest's QR code\*\*[^\n]*\*\*Guests scan a personal QR\*\*[^\n]*\*\*Add 1 guest\*\*, then \*\*Generate all codes \(1\)\*\*/);
    assert.match(said[4], /\*\*Live display\*\*[^\n]*press the bar of an answer the guest picked: `Who picked: <answer> \(N people\)`[^\n]*\*\*View as table\*\*/);
    assert.match(said[4], /"Most people \(N%\) chose \.\.\." only when more than half chose it \("The top choice \(50%\) was \.\.\." at half\)[^\n]*that one\./);
    assert.match(said[4], /counts only the iPads that answered/);
    assert.match(said[5], /^Press \*\*Full screen\*\*[^\n]*no participant's name anywhere[^\n]*\*\*Show answer\*\*[^\n]*\*\*Open in a new tab\*\*[^\n]*"Live results · Wall display", there is no \*\*Names shown\*\* switch/);
    assert.match(said[6], /^On the Windows laptop that showed the fault \(Chrome, its display scaling as it is\)[^\n]*no scrollbar inside the white card[^\n]*tooltip whole[^\n]*centred on their gridlines[^\n]*\*\*Open in a new tab\*\*[^\n]*keep their own height/);
    assert.match(said[7], /^The Live display on the iPad, in Safari, upright and on its side[^\n]*projector/);
    assert.match(said[3], /an activity that is still locked[^\n]*has its title in white/);
    assert.match(said[6], /point at the top bar of a single choice: the tooltip stays clear of the question[^\n]*never cut at the card's edge/);
    // (Phase 11b) the files: the one-pager's header as the screen's, the charts, no names, PowerPoint, the leader report and its last page, black and white, one iPad.
    assert.match(note, /\*\*This package \(Phase 11b\) also redraws the files the facilitator saves\*\*[^\n]*\*\*Export PDF\*\* and \*\*Export PPT\*\*[^\n]*Kroger's said 5 iPads where the screen said 4[^\n]*\*\*Leader report \(PDF\)\*\*/);
    assert.match(note, /pms-21462b6's was byte for byte the participant page of the 11a-3 packages, pms-618b8fc to pms-e2fbfb6/);
    assert.match(note, /\*\*This package \(Phase 12\) fixes what a review of every screen on a local copy of the site found\*\*[^\n]*a single-choice poll no longer blocks Go live[^\n]*Open Sans stays embedded\./);
    // (Phase 13) step 9 is the redesigned files: the summary pack, the two CSV files and the leader report's At a glance.
    assert.match(said[9], /^The files \(Phase 13\)\.[^\n]*\*\*Export PDF\*\* and \*\*Export PPT\*\*[^\n]*"34 answers from 4 iPads"[^\n]*one takeaway per activity[^\n]*a tick and the word "Correct"[^\n]*no participant's name anywhere[^\n]*Open the PowerPoint in PowerPoint[^\n]*speaker notes[^\n]*\*\*Summary by activity \(CSV\)\*\*[^\n]*PivotTable[^\n]*\*\*All answers \(CSV\)\*\*[^\n]*\*\*Leader report \(PDF\)\*\* for Kroger and for Domino's[^\n]*At a glance[^\n]*black and white[^\n]*"1 answer from 1 iPad"[^\n]*someone who was not in the session/);
    assert.match(said[8], /^If the timing check with pms-0a1c701 \(below\) has not been sent yet, run it now with these pages: the participant page changed only in a locked activity's title and in when it looks again after the network comes back\./);
    // The timing check: three steps, and the line in a block with no language, exactly as it was given.
    assert.match(timing, /\n1\. Open the participant page fresh: press Ctrl\+F5/);
    assert.match(timing, /\n2\. Begin a visit \("Click here to begin"\), open an activity, answer it to its end, and press \*\*Back to activities\*\*\./);
    assert.match(timing, /\n3\. Press F12, open \*\*Console\*\*, paste the line below, and press Enter\. Send back the table and the summary line/);
    assert.match(timing, /it writes and changes nothing/);
    assert.equal(/\n```\n(.*)\n```\n/.exec(timing)?.[1], TIMING_CHECK, 'the fence has no language label');
    assert.equal(TIMING_CHECK, GIVEN_TIMING_CHECK);
    assert.doesNotThrow(() => new Function(TIMING_CHECK), 'it is one line of JavaScript');
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

/** The timing check exactly as the Phase 10j brief gave it, for RUNBOOK.md and QA-TESTING.md. */
const GIVEN_TIMING_CHECK = String.raw`(()=>{const n=performance.getEntriesByType('navigation')[0];const e=performance.getEntriesByType('resource').filter(x=>/\/_api\/|pms-config/.test(x.name));const t=e.map(x=>({at:Math.round(x.startTime),ms:Math.round(x.duration),status:x.responseStatus??'',kb:Math.round(x.transferSize/1024),what:decodeURIComponent(x.name.split('/_api/')[1]||x.name.split('/').pop()).replace(/&?\$select=.*$/,'').slice(0,80)}));console.table(t);const d=t.map(x=>x.ms).sort((a,b)=>a-b);console.log(` + '`page file ${Math.round(n.responseEnd-n.startTime)} ms, ${Math.round(n.transferSize/1024)} KB | requests ${d.length}, median ${d[d.length>>1]} ms, slowest ${d[d.length-1]} ms | fields reads: ${t.filter(x=>/\\/fields/.test(x.what)).map(x=>x.ms+\' ms, \'+x.kb+\' KB\').join(\'; \')||\'none\'}`' + String.raw`)})()`;

describe('RELEASE-NOTES.md', () => {
  it('what it is, the commit, each file with its checksum, what changed since the 9c package, and what is not proven', () => {
    const files = [{ name: 'index.html', bytes: 368_000, gzip: 155_000, sha256: 'a'.repeat(64) }, { name: 'pms-config.txt', bytes: 54, sha256: 'b'.repeat(64) }];
    const notes = releaseNotes({ commit: 'abc1234', folderName: 'pms-abc1234', files });
    assert.match(notes, /^# pms-abc1234: release notes/);
    assert.match(notes, /commit `abc1234`/);
    for (const file of files) assert.ok(notes.includes(file.sha256), file.name);
    assert.match(notes, /since the 9c package \(pms-8fe2daa\)/);
    // (Phase 10i) what changed since pms-e250a36, and why: the two columns renamed, Setup raising a site of version 2, the fourth probe, the visit of before.
    // (Phase 11a-2) what changed since pms-3fb312a, and why: nothing in a card scrolls, whole tooltips, the chart filling its card, the columns and the axis,
    // cards at their own height, the headlines' words, and "N iPads" counting the iPads that answered (VJR's choice; the PDF and PowerPoint left for 11b).
    // (Phase 11a-3) what changed since pms-283ad18, and why, newest first; and the branch the package is made from.
    // (Phase 11b) what changed since pms-e2fbfb6, newest first; the 11a-3 section is now "in pms-e2fbfb6".
    // (Phase 13) what changed since pms-d19bd14, newest first; the Phase 12 section is now "in pms-d19bd14", with its sizes recorded.
    // (Phase 14) what changed since pms-757be5c: the code's structure and the documents, nothing a person sees; the Phase 13 section is "in pms-757be5c",
    // with its sizes recorded.
    // (Phase 15) what changed in pms-b643f1b, since pms-e470847: the motion, the switch and the alignment; the Phase 14 section is "in pms-e470847".
    // (Phase 16) what changed since pms-b643f1b: Results newest first, Delete session, editing in place; the Phase 15 section is "in pms-b643f1b", with its sizes.
    // (Phase 17) what changed since pms-07eb42b: the structure of the code and the dead CSS, nothing a person sees; the Phase 16 section is "in pms-07eb42b", with its sizes.
    // (Phase 18) what changed since pms-f59fcde: Brand Studio in the Content tab; the Phase 17 section is "in pms-f59fcde", with its sizes.
    // (Prompt 19) what changed since the Phase 18 build, which was not packaged: the sign-in ladder and the banner, newest first.
    assert.match(notes, /## What changed since the Phase 18 build \(23 Oct 2026: the admin page showed SharePoint's raw "403 Access denied" after it had been open a while\)/);
    assert.match(notes, /\*\*A sign-in SharePoint stops accepting is renewed by the page itself\.\*\*/);
    assert.match(notes, /\*\*When it cannot be renewed, one banner says so in words\.\*\*/);
    assert.match(notes, /\*\*Nothing else changed:\*\* no data, list, column or setting[^\n]*The participant page is (not measured|[\d,]+ B (larger|smaller) than pms-f59fcde's) and the admin page/);
    assert.ok(notes.indexOf('since the Phase 18 build') < notes.indexOf('since pms-f59fcde'), 'the newest change first');
    assert.match(notes, /## What changed since pms-f59fcde \(22 Oct 2026: a client's look was one screen and its activities another, reached from different tabs\)/);
    assert.match(notes, /\*\*Content is one client's workspace\.\*\*/);
    assert.match(notes, /\*\*Brand on a client's row on Clients\*\*/);
    assert.match(notes, /\*\*Nothing else changed:\*\* no data, list or column \(version 3\)[^\n]*The participant page is (not measured|byte for byte pms-f59fcde's|[\d,]+ B (larger|smaller) than pms-f59fcde's) and the admin page/);
    assert.ok(notes.indexOf('since pms-f59fcde') < notes.indexOf('in pms-f59fcde'), 'the newest change first');
    assert.match(notes, /## What changed in pms-f59fcde \(since pms-07eb42b, 22 Oct 2026: the data layer was one file of 2,845 lines, and the stylesheets carried rules that nothing could match\)/);
    assert.match(notes, /\*\*The data layer is in parts\.\*\*/);
    assert.match(notes, /\*\*72 stylesheet rules that nothing could match are gone\.\*\*/);
    assert.match(notes, /\*\*Nothing a person sees changed:\*\* no data, list or column \(version 3\)[^\n]*The participant page was 701 B smaller and the admin page 1,922 B larger than pms-07eb42b's \(gzip\)/);
    assert.ok(notes.indexOf('in pms-f59fcde') < notes.indexOf('in pms-07eb42b'), 'the newest change first');
    assert.match(notes, /## What changed in pms-07eb42b \(since pms-b643f1b, 19 Oct 2026: today's session was at the bottom of Results, a session's data could not be deleted, and a question's editor opened below the whole list\)/);
    assert.match(notes, /\*\*Results shows the newest session first\*\*/);
    assert.match(notes, /\*\*Delete session\.\.\.\*\*[^\n]*for good[^\n]*never touched/);
    assert.match(notes, /\*\*A question is edited where it is\.\*\*/);
    assert.match(notes, /\*\*Nothing else changed:\*\* no list or column \(version 3\)[^\n]*The participant page was 128 B larger \(it carries[^\n]*and the admin page 6,759 B larger than pms-b643f1b's \(gzip\)\./);
    assert.ok(notes.indexOf('in pms-07eb42b') < notes.indexOf('in pms-b643f1b'), 'the newest change first');
    assert.match(notes, /## What changed in pms-b643f1b \(since pms-e470847, 18 Oct 2026: a participant's screens appeared all at once, and an answer's words moved sideways when it was picked\)/);
    assert.match(notes, /\*\*The screens move, by the kind of question\.\*\*/);
    assert.match(notes, /\*\*An Animations switch for each client\*\*[^\n]*no list or column changes/);
    assert.match(notes, /\*\*Nothing else changed:\*\*[^\n]*The participant page was 1,938 B larger and the admin page 6,914 B larger than pms-e470847's \(gzip\)\./);
    assert.ok(notes.indexOf('in pms-b643f1b') < notes.indexOf('in pms-e470847'), 'the newest change first');
    assert.match(notes, /## What changed in pms-e470847 \(since pms-757be5c, 17 Oct 2026: the code and its documents were rearranged for whoever changes them next; nothing a person sees changed\)/);
    assert.match(notes, /\*\*Nothing a person sees changed:\*\*[^\n]*The participant page and the admin page were byte for byte pms-757be5c's\./);
    assert.ok(notes.indexOf('in pms-e470847') < notes.indexOf('in pms-757be5c'), 'the newest change first');
    assert.match(notes, /## What changed in pms-757be5c \(since pms-d19bd14, 17 Oct 2026: the Results files were a small copy of the screen, and a leader who was not in the room could not find the answer\)/);
    assert.match(notes, /The participant page is byte for byte pms-d19bd14's and the admin page 3,480 B larger than pms-d19bd14's \(gzip\)/);
    assert.match(notes, /\*\*The Live display's Export PDF and Export PPT are a summary pack\*\*/);
    assert.match(notes, /\*\*Summary by activity \(CSV\)\*\*[^\n]*Its eight old columns are gone/);
    assert.match(notes, /\*\*The leader report opens "At a glance"\*\*/);
    assert.match(notes, /The participant page is (not measured|byte for byte pms-d19bd14's|[\d,]+ B (larger|smaller) than pms-d19bd14's) and the admin page/);
    assert.ok(notes.indexOf('since pms-d19bd14') < notes.indexOf('in pms-d19bd14'), 'the newest change first');
    // (Phase 12) what changed in pms-d19bd14, since pms-21462b6; the 11b section is "in pms-21462b6".
    assert.match(notes, /## What changed in pms-d19bd14 \(since pms-21462b6, 17 Oct 2026: a review of every screen on a local copy of the site, UX-REVIEW\.md, found a poll that blocked Go live and words that misled\)/);
    assert.match(notes, /\*\*A poll never blocks Go live\.\*\*/);
    assert.match(notes, /\*\*Open Sans stays embedded\*\*/);
    assert.match(notes, /The participant page was 298 B larger and the admin page 381 B larger than pms-21462b6's \(gzip\)\./);
    assert.ok(notes.indexOf('in pms-d19bd14') < notes.indexOf('in pms-21462b6'), 'the newest change first');
    assert.match(notes, /## What changed in pms-21462b6 \(since pms-e2fbfb6, 17 Oct 2026: the Live display's one-page PDF and PowerPoint drew plain bars and counted every visit as an iPad[^\n]*\)/);
    assert.match(notes, /\*\*The Live display's Export PDF and Export PPT draw the Live display's charts\.\*\*/);
    assert.match(notes, /\*\*The header of both says "N answers from M iPads" as the Live display does\*\*[^\n]*"34 answers from 4 iPads" where it said 5[^\n]*"1 answer from 1 iPad"/);
    assert.match(notes, /\*\*The leader report's "Results by activity" uses the same words and colours\*\*[^\n]*every number it printed before is still printed/);
    assert.match(notes, /The participant page was byte for byte the same as pms-e2fbfb6's, and the admin page 4,482 B larger \(gzip\)\./);
    assert.match(notes, /## What changed in pms-e2fbfb6 \(since pms-283ad18, 16 Oct 2026: a chart's tooltip could lie over the words above its mark, and a locked activity's title was too faint to read\)/);
    assert.match(notes, /\*\*A tooltip keeps clear of its card's words and buttons\*\*/);
    assert.match(notes, /\*\*A locked activity's title is white\*\*/);
    assert.match(notes, /\*\*A question too long for full screen is never cut at the card's edge\.\*\*/);
    assert.match(notes, /\*\*No change, by VJR's decisions of 16 Oct 2026:\*\* names stay "Last, First"/);
    assert.match(notes, /The participant page is 30 B larger than pms-283ad18's and the admin page 32 B larger than pms-283ad18's \(gzip\)\./);
    assert.ok(notes.indexOf('since pms-283ad18') < notes.indexOf('in pms-283ad18'), 'the newest change first');
    assert.match(notes, /of the branch `pms-19` \(a branch on GitHub, never merged into main\)/);
    // (Phase 11a-2, since 11a-3 the section "in pms-283ad18") what changed since pms-3fb312a.
    assert.match(notes, /## What changed in pms-283ad18 \(since pms-3fb312a, 16 Oct 2026: on a Windows laptop a confidence question in full screen had a scrollbar inside its chart and its tooltip cut off\)/);
    assert.match(notes, /\*\*Nothing inside a chart's card scrolls\.\*\*/);
    assert.match(notes, /\*\*A tooltip is always whole\.\*\*/);
    assert.match(notes, /\*\*The headlines' words\*\*: "Most people \(N%\) chose \.\.\." only when more than half did/);
    assert.match(notes, /\*\*"N answers from M iPads" counts the iPads that answered\*\*[^\n]*"34 answers from 4 iPads"[^\n]*one-page PDF and PowerPoint still print every visit/);
    assert.match(notes, /not the participant page \(byte for byte as pms-0a1c701's\)\. The admin page is [\d,]+ B larger than pms-3fb312a's \(gzip\)\./);
    assert.ok(notes.indexOf('since pms-3fb312a') < notes.indexOf('in pms-3fb312a'), 'the newest change first');
    // (Phase 11a) what changed in pms-3fb312a, since pms-0a1c701, and why: the charts, the sentence, the names, the wall, the colours, and what did not change.
    assert.match(notes, /## What changed in pms-3fb312a \(since pms-0a1c701, 15 Oct 2026: on the new site Results showed plain blue bars and totals only, and nothing showed who picked what\)/);
    assert.match(notes, /\*\*A chart of its own kind for each question, drawn by hand\*\* \(no chart library/);
    assert.match(notes, /\*\*Names on the facilitator's own view\.\*\*[^\n]*No request was added/);
    assert.match(notes, /\*\*The wall display has no names\.\*\*[^\n]*\*\*Show answer\*\*/);
    assert.match(notes, /not the participant page \(byte for byte as pms-0a1c701's\)\. The admin page is 54,058 B smaller/);
    assert.ok(notes.indexOf('since pms-0a1c701') < notes.indexOf('in pms-0a1c701'), 'the newest change first');
    assert.ok(notes.indexOf('in pms-3fb312a') < notes.indexOf('in pms-0a1c701'), 'and the one before it next');
    // (Phase 10j) what changed in pms-0a1c701, since pms-da9fc8d, and why: the rounds, the column check, the visit begun, the first screen, the hub, the requests.
    assert.match(notes, /## What changed in pms-0a1c701 \(since pms-da9fc8d, 15 Oct 2026: on the new site the participant page responded slowly, showing its loading lines\)/);
    assert.match(notes, /\| Page open on the staff link, up to Welcome \| 4 \| 2 \|/);
    assert.match(notes, /\| "Click here to begin", once the page has fetched ahead \| 7 \| 2 \|/);
    assert.match(notes, /\*\*The column check reads only what it checks\.\*\*/);
    assert.match(notes, /\*\*an edit made in Content reaches a participant at the next activity they open after visiting the hub\*\*/);
    assert.match(notes, /\*\*On a site that cannot batch\*\* \(`"batch": false`\) it is 34 and 31/);
    assert.doesNotMatch(notes, /PARTICIPANT_GROWTH|ADMIN_GROWTH|ADMIN_CHANGE|ADMIN_DELTA/, 'the sizes are filled in');
    assert.ok(notes.indexOf('since pms-da9fc8d') < notes.indexOf('in pms-da9fc8d'), 'the newest change first');
    assert.match(notes, /## What changed in pms-da9fc8d \(since pms-e250a36, 15 Oct 2026: on the new site Go live, a visit and the self-test worked, and Results did not load\)/);
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
    assert.match(notes, /\*\*with pms-e250a36\*\* \(15 Oct 2026\)[^\n]*Results did not load, \*\*and with pms-da9fc8d\*\* the lists of version 3 and a participant's visit, which was slow/);
    assert.match(notes, /the timing check of the note says \(QA-TESTING\.md items 146 to 148\)/);
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
