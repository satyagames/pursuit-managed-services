// The two documents of the release package for the new site (Phase 10f): RUNBOOK.md, for the colleague who puts the app on the site, and
// RELEASE-NOTES.md. Plain functions of what the package holds, so scripts/test-release-docs.js can hold their words to the site, the steps,
// the permissions (scripts/permissions.js, from public/js/pms-schema-meta.js) and the QA-TESTING.md items. scripts/build-release-package.js
// writes them into the package folder; they are never committed (build-svelte/ is git-ignored).
import { VERSION } from '../public/js/pms-schema.js';
import { participantGroups, permissionsTable, SETUP_NOTE } from './permissions.js';

/** The new site (VJR, 14 Oct 2026). Nothing in the pages names it: a page works out its site from its own address (Phase 10b). */
export const SITE = 'https://internal.global.deloitteonline.com/sites/PCOE';
export const LIBRARY_FOLDER = 'Shared Documents';
export const FOLDER = 'PMS';
export const FOLDER_URL = `${SITE}/${encodeURIComponent(LIBRARY_FOLDER)}/${FOLDER}`;
/** The settings file of this deployment, exactly. */
export const SETTINGS = Object.freeze({ configVersion: 1, listPrefix: '', label: 'PMS' });
export const SETTINGS_TEXT = '{"configVersion": 1, "listPrefix": "", "label": "PMS"}';
/** The four files that are uploaded; the rest of the package stays on the deployer's computer. */
export const UPLOADED = Object.freeze(['index.html', 'admin.html', 'setup.html', 'pms-config.txt']);
export const LAST_LINE = 'Steps 1 to 9 of this runbook have run on the real site (14 Oct 2026, pms-969bf16), and Go live, a participant\'s visit and the self-test (15 Oct 2026, pms-e250a36). Everything after them is new.';

/**
 * Which QA-TESTING.md item each step answers (items 102 to 132, 138 to 142, and the earlier ones the same steps show). An item that no step answers is
 * in LATER, with what shows it. (Phase 10h put the self-test in as step 10: the steps after it moved one on.)
 */
export const QA_BY_STEP = Object.freeze({
  2: [88, 93],
  3: [111],
  4: [110, 115, 125, 129],
  5: [118, 119, 120, 121, 122, 123, 124, 127, 128],
  6: [107, 113, 114, 116],
  7: [112, 126],
  8: [100, 130],
  9: [132, 133],
  10: [139, 142, 143],
  11: [135],
  13: [108, 134, 136, 140],
  14: [134, 137],
  15: [137],
});
/** Which QA-TESTING.md item each step of the note for the PCOE site answers (Phase 10i: the site of version 2 brought to version 3). */
export const QA_BY_NOTE = Object.freeze({
  2: [145],
  5: [145],
  8: [143],
  9: [145],
  10: [144],
});
export const LATER = Object.freeze([
  [102, 'no item for a session in the answers list: press Restart on Results for the iPad\'s visit of step 13'],
  [103, 'codes retired without a filter on the Yes/No column: needs guests with codes (Guests and QR), then End session'],
  [104, 'a session with more than 200 codes: needs a guest list of 250'],
  [105, 'tidying a replaced tile picture: Content, an answer with an uploaded tile picture'],
  [106, 'deleting a client, and the check-in code: Clients'],
  [109, 'the self-test\'s sentence: only if Setup\'s optional self-test reports that $batch is refused'],
  [117, 'an answer text over 255 characters: fixed in Phase 10c-3, and checked by item 131'],
  [131, 'the 255-character limits: Content and Clients, once an admin is in'],
  [138, 'a missing pms-config.txt comes back as a 404 (Phase 10g): after the steps, rename pms-config.txt in the folder, open its address in a browser with the Network panel open, and reload setup.html; put the file back'],
  [141, 'a read that names a column the list lacks (Phase 10h): only on a site where a column was deleted by hand after Setup marked it ready; Check Lists names it'],
]);

const code = (text) => `\`${text}\``;

/**
 * RUNBOOK.md.
 * @param {{ commit: string, folderName: string }} build
 */
export function runbook({ commit, folderName }) {
  const groups = participantGroups();
  const steps = [
    ['Check the checksums.', [
      `On a Mac, in Terminal, go into the unzipped folder ${code(folderName)} and run ${code('shasum -a 256 -c SHA256SUMS.txt')}. Every line must end with ${code('OK')}.`,
      `On Windows, in PowerShell, in that folder: ${code('Get-FileHash -Algorithm SHA256 index.html,admin.html,setup.html,pms-config.txt')} and compare each hash with the line of SHA256SUMS.txt for that file.`,
      'If any line does not match, stop: do not upload anything, and send the output.',
    ], 'the output of the check (or "all OK").'],
    ['Upload the four files.', [
      `Open ${SITE}, go to the document library ${LIBRARY_FOLDER}, and create the folder ${code(FOLDER)} if it is not there.`,
      `Upload exactly these four files from the package into ${code(`${LIBRARY_FOLDER}/${FOLDER}`)}, with these names and nothing else: ${UPLOADED.map(code).join(', ')}.`,
      `${code('pms-config.txt')} must be exactly ${code(SETTINGS_TEXT)}: no prefix in front of the list names (the lists are ${code('PMSClients')} and the rest), and the label "PMS" in the admin bar.`,
      `The settings file is a ${code('.txt')} on purpose: this site does not serve ${code('.json')} files from a document library (observed 14 Oct 2026), and does serve a ${code('.txt')}. Its content is still JSON, and the pages read ${code('pms-config.txt')} and nothing else. Check it: open ${FOLDER_URL}/pms-config.txt in the browser; it must show the line above as text.`,
      'Do not put the pages in a sub-folder, and do not rename them. The other files of the package (RUNBOOK.md, RELEASE-NOTES.md, THIRD-PARTY-NOTICES.txt, SHA256SUMS.txt) stay on your computer.',
    ], 'a screenshot of the folder in SharePoint showing the four files and their sizes.'],
    ['Open Setup, and read "This copy of the app".', [
      `Open ${FOLDER_URL}/setup.html (signed in to SharePoint as yourself, a site owner).`,
      `Under "1. This copy of the app", check the rows: **Opened from** ${FOLDER_URL}/; **Site** ${SITE} "(from this page's address)"; **Lists** "PMSClients, PMSClientSessions, ... (12)" "(no prefix from pms-config.txt)"; **Picture library** PMSClientImages; **Label** PMS "(from pms-config.txt)"; **Build** ${code(folderName)}, the name of this package.`,
      'Under "2. Lists" the page says in red that the lists have not been set up for this app yet (PMS-LST-010): that is expected until step 7.',
      'If the page shows a code (PMS-CFG-...) instead, stop there and send it with its Details line.',
    ], 'a screenshot of "This copy of the app".'],
    ['Show the plan.', [
      'Under "2. Lists", press **Show the plan**. It only reads the site.',
      'The lists were built by hand, so expect **"Nothing to create"**, or a short list of what is missing, each with its fix.',
      `A column with a wrong name (for example ${code('Session_x0020_Id')}, where the list needs ${code('SessionId')}) is listed under what Setup "will not touch": Setup never deletes or renames a column. Delete that column in the list's settings (it holds nothing on a new site), press **Show the plan** again, and the plan then names the right column to create.`,
      'Open "Technical details" if the plan lists anything.',
    ], 'a screenshot of the plan, with "Technical details" open if it lists anything.'],
    ['Create, only if the plan lists something.', [
      'Press **Create** and confirm ("Create what the plan shows on this site (...)? It only adds: ..."). It makes exactly what the plan shows and only adds: it never deletes, renames or changes a column\'s type. It takes a few seconds to a minute, and ends with "Created ... in ... s (... writes)."; a clean Create then marks the site as ready by itself (step 7).',
      'If it stops, its message says what was made and why it stopped; press **Show the plan** and **Create** again to carry on.',
      'If the plan said "Nothing to create", skip this step.',
    ], 'the last line it shows ("Created ... in ... s (... writes)."), or its stop message in full.'],
    ['Check Lists, until every row is Ready.', [
      'Press **Check Lists**. Expect "All list schemas ready. Write permissions have not been tested.", and every list and the picture library **Ready**.',
      'A row that is not Ready says what to fix, in words, in the table "What to fix". Fix it in the list\'s settings, then press **Check Lists** again.',
    ], 'a screenshot of the table with every row (all Ready).'],
    ['Mark the site as ready.', [
      `Press **Mark the site as ready**. Expect: "The site is marked ready: every list passed the check, and the settings item of PMSAppSettings now says version ${VERSION}."`,
      `If Create ran in step 5 and ended clean, it has done this already, and the button says "The site was already marked ready (version ${VERSION}). Nothing was written."`,
      'If it says "Not marked ready", it lists what the check found: fix that, press **Check Lists**, and press it again.',
      'Until the site is marked ready, the participant and admin pages stop with PMS-LST-010; that is expected.',
    ], 'a screenshot of the message.'],
    ['Add an admin.', [
      'Under "3. Admins", type a name, and a PIN of 6 to 12 digits twice, and press **Add an admin**. Expect "Admins on this site: <the name>."',
      '**There is no demo PIN on this site**: 1234 does not open the admin page. Keep the PIN to yourself and give it to the facilitators who need it.',
    ], 'the line "Admins on this site: ...". Never send the PIN.'],
    ['Seed sample clients.', [
      'Under "4. Sample clients", press **Seed sample clients** and confirm. It creates Kroger and Domino\'s with their activities, and first puts their pictures (a logo, a hero and a background each) in the picture library.',
      'Expect: "Complete: 76 created, 0 completed, 0 already present. Pictures: 6 uploaded, 0 already in the library." Pressing it again creates and uploads nothing.',
    ], 'the line it shows.'],
    ['Optional: run the self-test.', [
      `Under "5. SharePoint self-test (optional)", press **Run self-test** and confirm. It creates one test item in ${code('PMSParticipantAnswers')}, changes it, reads it back, tries to create it a second time, lists it, reads two things in one request, asks the site four read-only questions, and deletes everything it made. It is safe on a new site with no real answers: the only item it touches is its own.`,
      'Expect **"Passed: 11 of 11 steps"**. The step "A second create with the same AppId is refused" must say "Refused: AppId enforces unique values." (this site refuses a duplicate with status 500, observed 14 Oct 2026; these pages take that as a duplicate). The row "Probe (read-only): columns this site leaves out of a read that names no columns" lists what this site leaves out of an item read that does not name its columns (it left `ClientId` out of PMSActivities on 14 Oct 2026; these pages name their columns in every read, so nothing depends on it).',
      'The row "Probe (read-only): columns this site will not return by name" reads one item of each list that has one, naming every column the list has, and names any column the site refuses to return (this site refused `DisplayName` on PMSVisitLog, observed 15 Oct 2026: SharePoint gives every list item a property of that name). On a new site it should name none; no column of these pages is named like such a property, so nothing depends on it. A list with no item is not tested, and the row says which.',
      'If a step fails, its row says why, and the self-test still deletes what it made.',
    ], 'the whole table of steps (every row, with its detail) and the status line above it.'],
    ['Set permissions.', [
      `**Participant accounts** (the accounts the iPads sign in with, and anyone who opens the participant page) may **write** ${groups.write.map(code).join(', ')}; may only **read** ${groups.read.map(code).join(', ')}; and **must not read** ${groups.none.map(code).join(', ')}: it holds the facilitators' PIN hashes, and its permission is the real lock on the admin page.`,
      'Facilitators need what the table says. A facilitator who also opens the participant page (to try it) needs the participant accounts\' rights too.',
      SETUP_NOTE,
      `On ${code('PMSAdminUsers')}: List settings, Permissions for this list, Stop Inheriting Permissions, then remove every group the participant accounts are in (keep the site owners and the facilitators). Then use **Check Permissions** with a participant account: it must say "None".`,
      '',
      permissionsTable(),
    ], 'for each list, the permission levels it shows (a screenshot of each list\'s permissions page), and what Check Permissions says for one participant account on PMSAdminUsers.'],
    ['Optional: a support contact.', [
      'To show who to ask on the pages\' error screens, replace pms-config.txt in the folder (it stays a .txt; only its content is JSON) with exactly this (your own name and address), and nothing else:',
      '',
      '```json',
      '{"configVersion": 1, "listPrefix": "", "label": "PMS", "support": {"name": "Your name", "contact": "you@deloitte.com"}}',
      '```',
      '',
      'The name is 60 characters at most; the contact is an email address or an https link. A key that is not one of these stops every page with PMS-CFG-002, so copy it exactly. Reload setup.html afterwards: "This copy of the app" shows the contact.',
    ], 'the file as you uploaded it, if you changed it.'],
    ['Go live with a sample client.', [
      `Open ${FOLDER_URL}/admin.html, enter the PIN of step 8, and open **Today**.`,
      'Pick **Kroger** and today\'s date, look at the readiness list (blockers must be none; no "no logo" warning for the sample clients), and press **Go live**. Expect "Verified: participants now see Kroger".',
      'One warning is expected, "Staff mode": each person needs their own sign-in. iPads that share one sign-in must use **Guests scan a personal QR** (under Controls, once the session is live).',
      `Under **Participant link** the address is ${FOLDER_URL}/index.html, with its QR code.`,
    ], 'a screenshot of Today after Go live, readiness included.'],
    ['Answer one activity on an iPad.', [
      `On one iPad, signed in to SharePoint with a participant account, open the participant link: ${FOLDER_URL}/index.html (Today also shows it, with its QR code).`,
      'Expect Kroger\'s Welcome with its hero badge and its background; press "Click here to begin", open one activity and answer every question to its end.',
    ], 'a screenshot of Welcome and one of the activity\'s last screen.'],
    ['Look at Results.', [
      'In admin.html open **Results**: today\'s session (Kroger and today\'s date) shows one participant, named by the iPad\'s sign-in, with "5 of 6 questions answered" (the five of the activity of step 14, of the six in Kroger\'s two activities), and the live results under it.',
    ], 'a screenshot of today\'s session card.'],
    ['Remove setup.html, or restrict it.', [
      `Delete ${code('setup.html')} from the folder, or set its permissions so only site owners can open it. Setup can make lists and add admins.`,
      'Keep the package: setup.html can be uploaded again later.',
    ], 'which of the two you did.'],
  ];
  const lines = [
    '# Runbook: Pursuit Managed Services on the new site',
    '',
    `Package ${code(folderName)}, made from commit ${code(commit)} of the branch ${code('pms-redesign')}.`,
    '',
    `- **Site:** ${SITE}`,
    `- **Folder:** ${code(`${LIBRARY_FOLDER}/${FOLDER}`)}, which is ${FOLDER_URL}/`,
    `- **Participant page:** ${FOLDER_URL}/index.html`,
    `- **Admin page:** ${FOLDER_URL}/admin.html`,
    `- **Setup:** ${FOLDER_URL}/setup.html`,
    '',
    'You need: to be a site owner (Setup creates lists and sets their settings), one iPad signed in with a participant account, and about an hour. Do the steps in order. Under each step is what to send back.',
    'The pages have no address built into them: each works out its site from where it is opened, and reads its settings from pms-config.txt beside it.',
    '',
    '## The PCOE site has its lists of version 2: do this instead of steps 1 to 11',
    '',
    `The package pms-969bf16 ran steps 1 to 9 on this site on 14 Oct 2026: it has its lists, their version (2), an admin, the sample clients, and ${code('PMSAdminUsers')} locked to the site owners. On 15 Oct 2026 the package pms-e250a36 ran there: the self-test passed (10 of 10), Content showed each client's activities, Domino's went live, and a participant's visit worked to its end in Chrome. Then **Results did not load**: "SharePoint (400): Value does not fall within the expected range." **This SharePoint will not return a column named ${code('DisplayName')}** (observed 15 Oct 2026: every read of ${code('PMSVisitLog')} that named it was refused, and every other column of every list came back; ${code('DisplayName')} is also a property SharePoint gives every list item). So these pages are for **version 3 of the lists**: the guest's name is ${code('PMSGuestList.GuestName')} and a staff sign-in's name ${code('PMSVisitLog.SignedInName')}. The old ${code('DisplayName')} columns stay where they are: nothing reads or writes them. Do only this, in order:`,
    '',
    `1. Replace ${code('index.html')}, ${code('admin.html')} and ${code('setup.html')} in the folder with the three from this package (upload them over the old ones). Keep ${code('pms-config.txt')} as it is: it has the right content (${code(SETTINGS_TEXT)}). Change nothing else. (Delete ${code('pms-config.json')} if it is still there: nothing reads it, and this site does not serve ${code('.json')} files.)`,
    `2. Open ${FOLDER_URL}/setup.html: "1. This copy of the app" shows the build ${code(folderName)}, and under "2. Lists" it says in red that the lists are version 2 and this version of the app needs version 3 ("This site's lists need an update before this version of the app can use them. ... (PMS-LST-011, SchemaVersion 2, this build needs 3)"). Until step 5 the participant and admin pages stop with PMS-LST-011: that is expected. *Send back:* a screenshot of "2. Lists".`,
    `3. Press **Show the plan**. Expect **"0 lists, 2 columns, 0 settings to create."**: ${code('GuestName')} on PMSGuestList and ${code('SignedInName')} on PMSVisitLog, and nothing else; under what Setup will not touch, the two old ${code('DisplayName')} columns, "no longer used since version 3", marked harmless (a site owner may delete them by hand later; there is no need). *Send back:* a screenshot of the plan.`,
    '4. Press **Create** and confirm. Expect **"Created 0 lists, 2 columns and 0 settings in ... s (2 writes)."** It only adds. *Send back:* that line.',
    '5. A clean Create then marks the site as ready by itself (what **Mark the site as ready** does): the line under that button says **"Raised the lists from version 2 to version 3."**; the line under "2. Lists" then says "The lists are the version this app needs." (Pressed again, the button says "The site was already marked ready (version 3). Nothing was written.") *Send back:* a screenshot of both lines.',
    '6. Press **Check Lists**: every row **Ready** (the old `DisplayName` columns are not a problem). *Send back:* a screenshot of the table.',
    `7. Open ${FOLDER_URL}/admin.html with your PIN. On **Today**, under Controls, choose **Guests scan a personal QR** for the live session (Domino's). Then on **Guests and QR** paste one name (yours will do), press **Add 1 guest**, then **Generate all codes (1)**: the guest list and the codes now have an item each. Keep that guest's code at hand (**Show QR**) for step 10. *Send back:* a screenshot of the guest's row.`,
    '8. Back in Setup, run the self-test (step 10) and send back **the whole table**. Expect "Passed: 11 of 11 steps", and both probes report: "columns this site leaves out of a read that names no columns" (as on 15 Oct), and "columns this site will not return by name", which should name `PMSGuestList.DisplayName` and `PMSVisitLog.DisplayName` ("no longer used since version 3") and no column of the app; the lists it could not test, because they are empty, are named too.',
    "9. In admin.html open **Results**: the live session's card loads (on 15 Oct it did not). The visit made on 15 Oct shows as **\"Unnamed participant 1\"**: its sign-in name was written to the old `DisplayName` column, which this site will not return, so it cannot be read back; everyone who visits from now on is named. *Send back:* a screenshot of the card.",
    `10. Then step 14 on an iPad, **by scanning the guest's QR code of step 7**: Welcome says "Hi" and the guest's name; answer one activity to its end. Look at Results again (the guest is named, with the answers), and then step 16. (Step 11's permissions: nothing about them changed; ${code('PMSAdminUsers')} is locked already. Steps 12, 13 and 15 are not needed: Domino's is live.)`,
    '',
    'On a new, empty site, follow the steps from step 1.',
    '',
    '## The steps',
    '',
    ...steps.flatMap(([title, body, back], index) => [
      `${index + 1}. **${title}**`,
      // (A step's lines are indented as far as its number reaches, so a table or a block of JSON stays inside step 11 or 12.)
      ...body.map((line) => (line === '' ? '' : line.split('\n').map((row) => `${' '.repeat(String(index + 1).length + 2)}${row}`).join('\n'))),
      '',
      `${' '.repeat(String(index + 1).length + 2)}*Send back:* ${back}`,
      '',
    ]),
    '## What to send back',
    '',
    'Screenshots at steps 3, 4, 6, 7, 13, 14 and 15, the lines of steps 1, 5, 8 and 9, the table of step 10, the permissions of step 11, and **any page that shows a code**, with its **Details** line. On the PCOE site, what each step of the note asks for.',
    '',
    '## What a code means',
    '',
    '- **PMS-CFG-...** is the settings: pms-config.txt is missing, cannot be read, or has a mistake. The Details line says which setting.',
    `- **PMS-CFG-002** with \`page 200\` in the Details means the site sent a web page where pms-config.txt should be: its sign-in page, or an error page such as "File Not Found" when it will not hand the file out. Open ${FOLDER_URL}/pms-config.txt in the browser: it must show the text of the file, not a page.`,
    '- **PMS-LST-010** means **Mark the site as ready** (step 7) has not been done, or the settings item of PMSAppSettings is missing.',
    '- **PMS-LST-011** means the lists are of an older version than these pages: in Setup press **Show the plan**, **Create** and **Mark the site as ready** (the note above, on the PCOE site). **PMS-LST-012** means they are of a newer version: upload the newer files. Never change the version by hand; send the screenshot.',
    '',
    '## Printed QR codes',
    '',
    `A guest's QR code is the address of this folder's participant page (${FOLDER_URL}/index.html) with the code at the end. **If the files are ever moved to another folder or site, every printed code must be printed again.**`,
    '',
    '## Which QA-TESTING.md items each step answers',
    '',
    '| Step | Items |',
    '|---|---|',
    ...Object.entries(QA_BY_STEP).map(([step, items]) => `| ${step} | ${items.join(', ')} |`),
    ...Object.entries(QA_BY_NOTE).map(([step, items]) => `| Note ${step} | ${items.join(', ')} |`),
    '',
    'Items 102 to 145 that these steps do not reach, and what shows them later:',
    '',
    ...LATER.map(([item, what]) => `- **${item}**: ${what}.`),
    '',
    'Items 133 to 137 are new in Phase 10f (the new site, the pictures in the library, the permissions, the folder address in QR codes). Item 138 is new in Phase 10g (the settings file is pms-config.txt). Items 139 to 142 are new in Phase 10h (what this site leaves out of an unnamed read, Content and Today after that fix, a column deleted by hand, and the site\'s error code for a duplicate). Items 143 to 145 are new in Phase 10i (which columns this site will not return by name, the QR check-in of a named guest, and the lists brought from version 2 to version 3).',
    '',
    LAST_LINE,
    '',
  ];
  return lines.join('\n');
}

/**
 * RELEASE-NOTES.md.
 * @param {{ commit: string, folderName: string, files: { name: string, bytes: number, sha256: string, gzip?: number }[] }} build
 */
export function releaseNotes({ commit, folderName, files }) {
  return [
    `# ${folderName}: release notes`,
    '',
    `Pursuit Managed Services for the new site, ${SITE}, folder ${code(`${LIBRARY_FOLDER}/${FOLDER}`)}. Made from commit ${code(commit)} of the branch ${code('pms-redesign')} (never pushed) by ${code('npm run package:release')}, in a fresh checkout of that commit.`,
    '',
    '## What it is',
    '',
    'Three single-file pages (the participant page, the admin page and Setup), their settings file, and the documents to put them on the site. The pages keep their data in SharePoint lists on the same site. RUNBOOK.md is the order to do it in.',
    '',
    '| File | Bytes | gzip -9 | SHA-256 |',
    '|---|---:|---:|---|',
    ...files.map((file) => `| ${file.name} | ${file.bytes.toLocaleString('en-US')} | ${file.gzip ? file.gzip.toLocaleString('en-US') : ''} | ${code(file.sha256)} |`),
    '',
    '## What changed since pms-e250a36 (15 Oct 2026: on the new site Go live, a visit and the self-test worked, and Results did not load)',
    '',
    `- **Schema version 3: ${code('GuestName')} and ${code('SignedInName')} in place of ${code('DisplayName')}.** Why: Results did not load on the real site: "SharePoint (400): Value does not fall within the expected range." The failing request was the visit log's read of the names, which names its columns, ${code('DisplayName')} among them. Read one column at a time, every custom column of every list came back but ${code('PMSVisitLog.DisplayName')}: ${code('DisplayName')} is also a property SharePoint gives every list item, and a column of that name can be written and not read back. ${code('PMSGuestList.DisplayName')} only passed because the guest list was empty; once a guest existed, the QR check-in of a named guest, and Guests and QR, would have failed the same way. The record field is the same; only the two columns are renamed, and no column of these pages is named like such a property (a test lists them).`,
    '- **Setup brings a site of version 2 to version 3.** Show the plan names the two new columns and nothing else, and lists the old `DisplayName` columns under what it will not touch, as harmless (Setup never deletes a column). Create adds them. Mark the site as ready, once the check of version 3 is clean, raises the version and says "Raised the lists from version 2 to version 3."; it never lowers a higher version and writes nothing while a problem remains. Until then the participant and admin pages stop with PMS-LST-011, whose words in Setup now say what to press. RUNBOOK.md has the note for the PCOE site.',
    '- **The self-test asks a fourth read-only question:** which columns this site will not return by name, list by list (eleven steps).',
    '- **A visit logged before the upgrade** keeps its sign-in name only in the old column, which the site will not return: Results names it "Unnamed participant N". A guest added before it would have no name (the PCOE guest list was empty).',
    '- **Nothing else changed:** not what is counted or how, not the number or order of the requests a page sends (the reads of PMSGuestList and PMSVisitLog name the new column in place of the old). The participant page is 8 B larger (gzip) and the admin page 6 B.',
    '',
    '## What changed in pms-e250a36 (since pms-969bf16, steps 1 to 9 on the new site, 14 Oct 2026)',
    '',
    `- **Every item read names its columns.** Why: on the real site an item read that did not say which columns to return (${code('items?$top=200')}) came back with every column of PMSActivities but ${code('ClientId')}, and the same read with ${code('$select')} returned it. So Content and Today said Kroger and Domino's had no activities although the four seeded activities were on the list, and Go live would have failed with "belongs to a different client". Each read now names the list's columns (${code('$select=Id,AppId,...')}); nothing else in a request changed, and the item a create returns is completed from what was written in case the site leaves the same column out of it.`,
    '- **A duplicate refused with 500 is still a duplicate.** Why: the real site refuses a second item with the same AppId with status 500 and the words "duplicate values were found", where the pages expected 400, so Setup\'s self-test said "Refused, but not as a duplicate", and every path that meets a record already there (a participant\'s answers after a lost reply, a visit, the visit log, two admins pressing Go live, seeding, the import, a copy, a taken slug) would have failed. A refusal is a duplicate when SharePoint says 400, 409 or 500 with its duplicate error code or words about duplicate or unique values; any other 500 stays a 500.',
    '- **Setup\'s buttons can be seen.** Why: the deployer pressed Create, Add an admin and Seed sample clients with the keyboard: Setup never loaded the admin page\'s colours and type, so its blue buttons were white words on white and the others plain text. Setup now looks like the admin page (it is about 33 kB larger: the three Open Sans faces).',
    '- **Setup names the real lists.** The self-test\'s words and its confirmation named "the Responses list" and QRTokens.Used; they name PMSParticipantAnswers and PMSGuestQRCodes.Used (with the prefix of the settings, if any), as do two lines of the admin page.',
    '- **The self-test asks a third read-only question:** which columns this site leaves out of an item read that names none, list by list. RUNBOOK.md has the self-test as an optional step 10 (the steps after it moved one on), and a note for this site before the steps.',
    '- **One thing a broken site now shows differently:** a column deleted by hand from a list the admin page reads (after Setup marked the site ready) stops Today with SharePoint\'s words naming the column, where it used to be a readiness blocker; Setup\'s Check Lists still names it.',
    '- **Nothing else changed:** not the lists or their columns, not what is counted or how, not the number or order of the requests a page sends. The participant page is 167 B larger (gzip) and the admin page 136 B.',
    '',
    '## What changed in pms-969bf16 (since pms-50ae628, the first upload to the new site, 14 Oct 2026)',
    '',
    `- **The settings file is ${code('pms-config.txt')}, not ${code('pms-config.json')}** (Phase 10g). Why: the first run on the real site showed that its document library will not serve ${code('.json')} files. ${code('pms-config.json')} in the folder was answered with SharePoint's own "File Not Found" page and a success status although the file was there, so ${code('setup.html')} stopped with PMS-CFG-002; the same file renamed ${code('pms-config.txt')} is served as its text. The content is the same and so are the rules; there is one name, and a ${code('pms-config.json')} left in the folder is never read.`,
    '- **PMS-CFG-002 says more.** It now names the cause "an error page such as \'File Not Found\' when the site will not hand out this kind of file", and its Details line carries the HTTP status that came back (for example `page 200`).',
    '- **A site that already has the earlier upload:** replace the three pages, keep or replace pms-config.txt, and delete pms-config.json; RUNBOOK.md has the note before the steps.',
    '- **Nothing else changed:** not the lists or their columns, not what is counted or how, not a request a page sends. The three pages are rebuilt from the new commit and are a few bytes larger.',
    '',
    '## What changed since the 9c package (pms-8fe2daa)',
    '',
    `- **A new site and folder.** ${SITE}, ${code(`${LIBRARY_FOLDER}/${FOLDER}`)}. No address is built into the pages: each works out its site from where it is opened, and reads ${code('pms-config.txt')} beside it (Phase 10b). pms-8fe2daa had the old site (CreativeExpCOE) inside it; these pages have no site, folder or list prefix in them at all.`,
    '- **The `PMS` lists, schema version 2** (Phase 10c-2b): PMSClients, PMSClientSessions, PMSActivities, PMSActivityQuestions, PMSAnswerOptions, PMSParticipants, PMSParticipantAnswers, PMSGuestQRCodes, PMSGuestList, PMSVisitLog, PMSAdminUsers, PMSAppSettings and the picture library PMSClientImages, with no prefix. Every page checks the lists\' version (PMS-LST-010 to 012).',
    '- **Setup prepares the site** (Phase 10c-3): Show the plan, Create (adds only), Check Lists, Mark the site as ready, Add an admin. There is no demo PIN: the first admin is added in Setup.',
    '- **One app** (Phase 10c-1): the legacy pages are gone from the package and the branch.',
    '- **Sample pictures** (Phase 10f): Seed sample clients puts Kroger\'s and Domino\'s logos, heroes and backgrounds (VJR\'s six pictures, the clients\' real logos for this internal app, stored as Brand Studio stores them) in the picture library first. They are inside setup.html only.',
    '',
    '## What is not proven',
    '',
    '**Steps 1 to 9 of the runbook have run on the real site** (14 Oct 2026, pms-969bf16: Create made 13 lists, 89 columns and 47 settings; Check Lists all Ready; the site marked ready; an admin added; the samples seeded with their six pictures; PMSAdminUsers locked), **and with pms-e250a36** (15 Oct 2026) the self-test (10 of 10), Content, Go live with Domino\'s and a participant\'s visit in Chrome; Results did not load. **These pages have not run there yet, and nothing has run on an iPad.** They were tested against a local server and a mocked SharePoint REST API that answers as the real site did (it leaves `ClientId` out of an unnamed read and refuses a duplicate with 500), in Playwright\'s Chromium, WebKit and Firefox on a Mac, and the runbook (with the note for this site) was rehearsed on that mock with these very pages. Unproven until the site shows them: that Setup brings the site from version 2 to version 3 and Results then loads (QA-TESTING.md item 145); which columns the site will not return by name, with a guest and a code on it (item 143); the QR check-in of a named guest (item 144); what the site leaves out of an unnamed read besides `ClientId` (item 139); Content, Today, Go live and Results with these pages (item 140); the site\'s error code for a duplicate (item 142); that a missing pms-config.txt is a 404 (item 138); the participant accounts\' permissions; Go live, an iPad and Results at all. RUNBOOK.md says which QA-TESTING.md item each step answers.',
    '',
  ].join('\n');
}
