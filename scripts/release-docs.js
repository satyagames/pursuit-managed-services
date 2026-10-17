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
/** The branch a package is made from (Phase 13: pms-13, made from pms-12-fixes; Phase 11b: pms-11b, made from pms-11a3; Phase 11a-3: pms-11a3, pushed to GitHub as a branch and never merged into main; until then pms-redesign, never pushed). */
export const BRANCH = 'pms-13';

export const LAST_LINE = 'Steps 1 to 9 of this runbook have run on the real site (14 Oct 2026, pms-969bf16), and Go live, a participant\'s visit and the self-test (15 Oct 2026, pms-e250a36), and with pms-da9fc8d the lists of version 3 and a participant\'s visit (15 Oct 2026), and with pms-0a1c701 a named guest\'s visit by QR code and Results (15 Oct 2026), and with pms-3fb312a the Results charts, their names and full screen on a Windows laptop in Chrome (16 Oct 2026), and with pms-283ad18 the charts\' fit, tooltips and headlines on that laptop and an iPad (16 Oct 2026). Everything after them is new.';

/**
 * The timing check (Phase 10j): one line for Chrome's console on index.html, read-only. It lists the requests the page made to SharePoint's REST API and for its
 * settings file, each with when it started, how long it took, its status and its size, and says how long the page file took, how many requests there were, their
 * median and slowest time, and each read of a list's columns. RUNBOOK.md and QA-TESTING.md carry it exactly as it is here.
 */
export const TIMING_CHECK = "(()=>{const n=performance.getEntriesByType('navigation')[0];const e=performance.getEntriesByType('resource').filter(x=>/\\/_api\\/|pms-config/.test(x.name));const t=e.map(x=>({at:Math.round(x.startTime),ms:Math.round(x.duration),status:x.responseStatus??'',kb:Math.round(x.transferSize/1024),what:decodeURIComponent(x.name.split('/_api/')[1]||x.name.split('/').pop()).replace(/&?\\$select=.*$/,'').slice(0,80)}));console.table(t);const d=t.map(x=>x.ms).sort((a,b)=>a-b);console.log(`page file ${Math.round(n.responseEnd-n.startTime)} ms, ${Math.round(n.transferSize/1024)} KB | requests ${d.length}, median ${d[d.length>>1]} ms, slowest ${d[d.length-1]} ms | fields reads: ${t.filter(x=>/\\/fields/.test(x.what)).map(x=>x.ms+' ms, '+x.kb+' KB').join('; ')||'none'}`)})()";

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
/**
 * Which QA-TESTING.md item each step of the note for the PCOE site answers (Phase 11a: the three pages replaced, the Results charts, the names, the wall;
 * Phase 11a-2: the headlines' words, and the Windows laptop that showed the fault; Phase 11a-3: the tooltips clear of the card's words, the long question in
 * full screen, and a locked activity's title and the heroes on the iPad; Phase 11b: the Live display's PDF and PowerPoint, the leader report, in black and white,
 * and a session of one iPad; Phase 13: the summary pack, PowerPoint on a projector, the summary CSV in Excel, the leader report in Edge, Acrobat and black and white,
 * one iPad and a switched-off activity, and a reader who was not in the room).
 */
export const QA_BY_NOTE = Object.freeze({
  3: [144, 164],
  4: [150, 159, 160],
  5: [151, 152, 153],
  6: [157, 158, 161, 165],
  7: [154, 156],
  8: [146, 147, 148, 149],
  9: [167, 168, 169, 170, 171, 172, 173, 174, 175, 176],
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
  [145, 'the lists brought from version 2 to version 3 (Phase 10i): done on the PCOE site with pms-da9fc8d on 15 Oct 2026; the note\'s step 2 says what to do if Setup still says version 2'],
  [155, 'a staff sign-in name on the Live display (Phase 11a): only in staff mode; open the Live display from Results, and then from its own address in a new tab'],
  [162, 'names in the "Who picked" panel and the CSV (Phase 11a-3): no change, by VJR\'s decision of 16 Oct 2026 to keep "Last, First"'],
  [163, 'the wall page\'s header (Phase 11a-3): no change, by VJR\'s decision of 16 Oct 2026 to leave it'],
  [166, 'the network coming back during a look (Phase 11a-3): on an iPad with a question open, Wi-Fi off, the facilitator restarts that activity, Wi-Fi on'],
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
    `Package ${code(folderName)}, made from commit ${code(commit)} of the branch ${code(BRANCH)}.`,
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
    '## The PCOE site has its lists of version 3: do this instead of steps 1 to 11',
    '',
    `The package pms-969bf16 ran steps 1 to 9 on this site on 14 Oct 2026: it has its lists, an admin, the sample clients, and ${code('PMSAdminUsers')} locked to the site owners. On 15 Oct 2026 the package pms-e250a36 ran there (the self-test, Content, Go live with Domino's, a participant's visit; Results did not load), and then pms-da9fc8d, whose lists are of **version 3** (${code('PMSGuestList.GuestName')} and ${code('PMSVisitLog.SignedInName')} in place of the two ${code('DisplayName')} columns, which this SharePoint will not return by name). With pms-da9fc8d **the participant page responded slowly, showing its loading lines** (reported by VJR, 15 Oct 2026), and pms-0a1c701 made it wait for fewer requests. With pms-0a1c701 **Results showed plain blue bars and totals only, and nothing showed who picked what** (reported by VJR, 15 Oct 2026: a named guest had joined by QR code and finished four activities). The package pms-3fb312a drew a chart of its own kind for each question, in Deloitte's colours, and on the facilitator's own view a bar opens the names of the people who picked it; the wall display has no names. With pms-3fb312a, **on a colleague's Windows laptop in Chrome, a confidence question in full screen had a scrollbar inside its chart and its tooltip cut off, over a step's name, with an empty space under the chart** (photographed by VJR, 16 Oct 2026), and two headlines read "Most people (50%) chose ..." and "... co..". The package pms-283ad18 made every chart fit its card with nothing in it that scrolls, drew every tooltip whole and clear of its label, widened a confidence scale's columns, centred the figures under the bars on their gridlines, kept each card at its own height, and fixed the two headlines. With pms-283ad18, **a chart's tooltip could lie over the question, the "got it right first time" line and the Show answer / View as table buttons above its mark, and a locked activity's title was too faint to read** (photographed by Satyadev, 16 Oct 2026). These pages keep a tooltip clear of its card's words and buttons wherever there is room, make a locked activity's title white, never leave a long question cut off in full screen, and look again at once when the network comes back during a look. **This package (Phase 11b) also redraws the files the facilitator saves**: the Live display's **Export PDF** and **Export PPT** show each question as the Live display does (its sentence, "N of M got it right first time", the correct answer with a tick and "Correct", Deloitte's colours, no names) and say "N answers from M iPads" as the screen does (they counted every visit: Kroger's said 5 iPads where the screen said 4), and the **Leader report (PDF)** draws its results in the same words and colours, with every number it printed before (RELEASE-NOTES.md says what changed). **Replace the three pages; nothing else changes. The lists stay at version 3, and nothing in Setup changes.** The participant page changed for the first time since pms-0a1c701: a locked activity's title, and when it looks again after the network comes back. (pms-21462b6's was byte for byte the participant page of the 11a-3 packages, pms-618b8fc to pms-e2fbfb6.) **This package (Phase 12) fixes what a review of every screen on a local copy of the site found** (RELEASE-NOTES.md, UX-REVIEW.md): a single-choice poll no longer blocks Go live, an account that may not open the admin page is told so, a used QR code no longer points at a list that is not there, the wall no longer shows the facilitator's notice about a damaged answer item, picture tiles have the logo plate, and the participant page's chosen answers, loading words and phone bar are clearer. The participant page changes again; Open Sans stays embedded. **This package (Phase 13) redesigns the files a leader gets** (RELEASE-NOTES.md, EXPORT-DESIGN.md): the Live display's **Export PDF** and **Export PPT** are a summary pack (a page of what each activity found, then each activity's questions, large enough to project, with speaker notes in the PowerPoint); its **Export CSV** and a new button on each Results card save **Summary by activity (CSV)**, one row per answer for a spreadsheet; **Participant answers (CSV)** is now called **All answers (CSV)**, its columns as they were; and the **Leader report (PDF)** opens "At a glance" and gives each activity its own pages. The participant page is byte for byte the one already there; nothing is counted or stored differently. Do only this, in order:`,
    '',
    `1. Replace ${code('index.html')}, ${code('admin.html')} and ${code('setup.html')} in the folder with the three from this package (upload them over the old ones). Keep ${code('pms-config.txt')} as it is: it has the right content (${code(SETTINGS_TEXT)}). Change nothing else. (Delete ${code('pms-config.json')} if it is still there: nothing reads it, and this site does not serve ${code('.json')} files.)`,
    `2. Open ${FOLDER_URL}/setup.html: "1. This copy of the app" shows the build ${code(folderName)}, and the line under "2. Lists" says "The lists are the version this app needs." Press nothing else in Setup: nothing there changed. (If it says the lists are version 2, PMS-LST-011, the upgrade of 15 Oct was not done: press **Show the plan**, **Create** and **Mark the site as ready** first, and expect "Raised the lists from version 2 to version 3.") *Send back:* a screenshot of "1." and "2.".`,
    `3. On an iPad, **scan a named guest's QR code** (if the live session has no guest with a code: open ${FOLDER_URL}/admin.html with your PIN; on **Today**, under Controls, choose **Guests scan a personal QR**; on **Guests and QR** paste one name, press **Add 1 guest**, then **Generate all codes (1)**, and **Show QR**). Welcome says "Hi" and the guest's name; open an activity and answer it to its end. On the Activities hub, an activity that is still locked (when the session asks for one at a time) has its title in white, readable, beside the lock and "Finish the previous activity". (A client's hero is a square when the picture uploaded for it has no transparent background: the sample heroes were made from JPEGs.) *Send back:* which answers the guest picked, and a screenshot of the hub with a locked activity.`,
    `4. In ${FOLDER_URL}/admin.html, **Results**, the live session's **Live display**: each question is a chart with a sentence above it; press the bar of an answer the guest picked: \`Who picked: <answer> (N people)\` appears under its card with the guest's name and the time. **View as table** on one card shows the same numbers. The sentence above a chart says "Most people (N%) chose ..." only when more than half chose it ("The top choice (50%) was ..." at half), and an answer whose own words end with a full stop ends its sentence with that one. The line under "Live results" counts only the iPads that answered ("N answers from M iPads": a visit that answered nothing is not among the M). *Send back:* a screenshot with the names open.`,
    '5. Press **Full screen** and **Next** through every question: no participant\'s name anywhere (the written answers have none under them), and a quiz question marks no answer until **Show answer** on its card. Leave full screen, press **Open in a new tab** and enter your PIN there: the heading says "Live results · Wall display", there is no **Names shown** switch, and there is no name anywhere. *Send back:* a screenshot of each.',
    '6. On the Windows laptop that showed the fault (Chrome, its display scaling as it is): **Full screen** and **Next** to a confidence question (Kroger\'s, or any client\'s that has one): no scrollbar inside the white card, wide columns, the plot reaching down to the step names with no empty space under them, and pointing at a column shows its tooltip whole, above the column\'s number and clear of the step\'s name. On a single choice and a ranking the figures under the bars ("0%", "50%", "100%") sit centred on their gridlines. Then **Open in a new tab** on the same laptop: nothing scrolls inside a card, every tooltip is whole, and two cards side by side each keep their own height. On the admin view and in full screen, point at the top bar of a single choice: the tooltip stays clear of the question, of "N answered · N of N got it right first time" and of **Show answer** / **View as table** (under the bar when there is no room above). On a ranking in full screen, point at the last bar: its tooltip hides none of the other bars\' figures. In full screen, a question with many long answers is whole on the screen, or the screen scrolls as one page with "More below": never cut at the card\'s edge. *Send back:* a photo of the confidence question with its tooltip showing, and one of the top bar\'s tooltip.',
    '7. The Live display on the iPad, in Safari, upright and on its side: nothing scrolls sideways, a tap on a bar opens its names and × closes them. On the room\'s projector, full screen: the words read from the back of the room. *Send back:* a photo or a screenshot of each.',
    '8. If the timing check with pms-0a1c701 (below) has not been sent yet, run it now with these pages: the participant page changed only in a locked activity\'s title and in when it looks again after the network comes back. *Send back:* the table and the summary line.',
    `9. The files (Phase 13). In ${FOLDER_URL}/admin.html, **Results**, Kroger's session (16 Oct 2026, or any session with answers): **Live display**, then **Export PDF** and **Export PPT**. Page 1 of each says "N answers from M iPads" as the Live display's own header does (for Kroger's 16 Oct session, "34 answers from 4 iPads") and one takeaway per activity, and reads in two minutes; then each activity's questions, each with its sentence above its chart, a correct answer with a tick and the word "Correct", and no participant's name anywhere. Open the PowerPoint in PowerPoint: 16:9, the text can be edited, nothing runs off a slide, each slide has speaker notes; show it in slide show on the room's projector. Then, on Results, the card's **Summary by activity (CSV)**: open it in Excel (columns in reading order, numbers are numbers, a PivotTable by Activity adds up the Answers), and **All answers (CSV)** (its columns as before). Then **Leader report (PDF)** for Kroger and for Domino's, opened in Edge and in Acrobat: page 1 is At a glance, each activity starts its own page; print one in black and white: every chart still reads by its words and its ticks. A session where only one iPad answered says "1 answer from 1 iPad"; an activity that is switched off is not in the Live display's files. Last, give page 1 of the leader report to someone who was not in the session and ask what happened. *Send back:* the four files, a photo of the black-and-white page with the ranking, and what the reader said.`,
    '',
    '### The timing check',
    '',
    'Read-only, in Chrome, on index.html: it writes and changes nothing, and reads only the timings the browser keeps of the requests the page made.',
    '',
    '1. Open the participant page fresh: press Ctrl+F5 (on a Mac, Cmd+Shift+R).',
    '2. Begin a visit ("Click here to begin"), open an activity, answer it to its end, and press **Back to activities**.',
    '3. Press F12, open **Console**, paste the line below, and press Enter. Send back the table and the summary line under it (a screenshot, or select and copy them).',
    '',
    '```',
    TIMING_CHECK,
    '```',
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
    '- **PMS-LST-011** means the lists are of an older version than these pages: in Setup press **Show the plan**, **Create** and **Mark the site as ready**. **PMS-LST-012** means they are of a newer version: upload the newer files. Never change the version by hand; send the screenshot.',
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
    'Items 102 to 160 that these steps do not reach, and what shows them later:',
    '',
    ...LATER.map(([item, what]) => `- **${item}**: ${what}.`),
    '',
    'Items 133 to 137 are new in Phase 10f (the new site, the pictures in the library, the permissions, the folder address in QR codes). Item 138 is new in Phase 10g (the settings file is pms-config.txt). Items 139 to 142 are new in Phase 10h (what this site leaves out of an unnamed read, Content and Today after that fix, a column deleted by hand, and the site\'s error code for a duplicate). Items 143 to 145 are new in Phase 10i (which columns this site will not return by name, the QR check-in of a named guest, and the lists brought from version 2 to version 3). Items 146 to 149 are new in Phase 10j (the timing check before and after, the size and time of a read of a list\'s columns, whether the site answers 429 or 503, and an activity that opens at once with an edit made in Content). Items 150 to 156 are new in Phase 11a (a named guest on the right bar, no names on the wall, Show answer, the table view, the charts on an iPad, a staff sign-in name on the Live display, and Deloitte\'s colours on a projector). Items 157 to 160 are new in Phase 11a-2 (a confidence question in full screen on the Windows laptop, the wall page, the headlines\' words, and "N iPads" counting the iPads that answered). Items 161 to 166 are new in Phase 11a-3 (a tooltip and the words above its mark, the names and the wall page as VJR decided, the heroes and a locked activity on an iPad, eight long answers in full screen, and the network coming back during a look). Items 167 to 170 are new in Phase 11b (the Live display\'s PDF and PowerPoint, the leader report, the leader report in black and white, and a session of one iPad).',
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
  // The pages' gzip sizes in pms-d19bd14, the last package of Phase 12 (RELEASE-12.md), for what this package adds to each.
  const before = { 'index.html': 157_027, 'admin.html': 559_126 };
  const grew = (name) => {
    const now = files.find((file) => file.name === name)?.gzip;
    if (!now) return 'not measured';
    const change = now - before[name];
    if (change === 0) return "byte for byte pms-d19bd14's";
    return `${change >= 0 ? `${change.toLocaleString('en-US')} B larger` : `${(-change).toLocaleString('en-US')} B smaller`} than pms-d19bd14's`;
  };
  return [
    `# ${folderName}: release notes`,
    '',
    `Pursuit Managed Services for the new site, ${SITE}, folder ${code(`${LIBRARY_FOLDER}/${FOLDER}`)}. Made from commit ${code(commit)} of the branch ${code(BRANCH)} (a branch on GitHub, never merged into main) by ${code('npm run package:release')}, in a fresh checkout of that commit.`,
    '',
    '## What it is',
    '',
    'Three single-file pages (the participant page, the admin page and Setup), their settings file, and the documents to put them on the site. The pages keep their data in SharePoint lists on the same site. RUNBOOK.md is the order to do it in.',
    '',
    '| File | Bytes | gzip -9 | SHA-256 |',
    '|---|---:|---:|---|',
    ...files.map((file) => `| ${file.name} | ${file.bytes.toLocaleString('en-US')} | ${file.gzip ? file.gzip.toLocaleString('en-US') : ''} | ${code(file.sha256)} |`),
    '',
    "## What changed since pms-d19bd14 (17 Oct 2026: the Results files were a small copy of the screen, and a leader who was not in the room could not find the answer)",
    '',
    '- **The Live display\'s Export PDF and Export PPT are a summary pack**, not a small copy of the screen. Page 1 says who took part ("N answers from M iPads") and one sentence for each activity: what people chose, knew or felt. Then each activity has its own page (two or more when it needs them), with a card for each question, its sentence first. Nothing is smaller than 12 point, so a slide reads when it is projected. The PDF is A4 landscape and carries Open Sans; the PowerPoint is 16:9, its text can be edited, and each slide has speaker notes: each question, its answers, and how it was counted. When some answers could not be read, page 1 says how many, with no name.',
    '- **Summary by activity (CSV)**, from the Live display\'s **Export CSV** and from a new button on each Results card: one row per answer option, in the order of the screen, with the client, the date, the question\'s number and type, the answers and their share as whole numbers, the correct answer and the top choice, and the question\'s sentence. Every written comment is a row of its own at the end, with no name. Its eight old columns are gone: Count is now Answers, Percentage is Share of answers (%) as a whole number, Score is Rank or score (a ranking\'s support score, 0 to 100, where it was points), and Respondents is Answers to this question. A spreadsheet built on the old columns must be pointed at the new names.',
    '- **All answers (CSV)** is the file that was called Participant answers (CSV): its columns are as they were.',
    '- **The leader report opens "At a glance"**: who joined, who answered, how many answers, who finished, one sentence for each activity, the hardest and easiest question, and three lines on how to read it, all on page 1. Each activity then starts its own page, under a band with its numbers and its sentence; each question is one card, never split, which says "Only four answers." (and so on) when fewer than five people answered; a graded activity ends with its average right first time and the question most often missed. The client\'s colour is the title band only; rules are Deloitte Green. Every number it printed before is still printed.',
    `- **Nothing else changed:** not the lists (version 3), not Setup, not what is counted or stored, and not a request any page sends. The participant page is ${grew('index.html')} and the admin page ${grew('admin.html')} (gzip).`,
    '',
    "## What changed in pms-d19bd14 (since pms-21462b6, 17 Oct 2026: a review of every screen on a local copy of the site, UX-REVIEW.md, found a poll that blocked Go live and words that misled)",
    '',
    '- **A poll never blocks Go live.** A single choice or true-or-false with no answer marked right is a poll; SharePoint stores its answers as "not correct", and Today called that "graded but no answer is marked correct", a blocker.',
    `- **An account that may not open the admin page is told so**, with the list it may not read and whom to ask (it said "Couldn't reach the server").`,
    '- **A used QR code says "Ask your facilitator for a new code."** (it pointed at a client list that is not there).',
    '- **The wall and full screen say only how many answers could not be counted**; the instruction for the facilitator stays on the admin view.',
    '- **A picture tile sits on the white logo plate**, so a transparent logo reads over a background picture; its verdict no longer covers it.',
    '- **A Results card shows its Live results before the list of people.**',
    '- **Open Sans stays embedded** (the brand font on every device); a measured stand-in takes its room while it loads, so nothing moves.',
    '- The participant page: **"Loading..."** while it starts (it said "Restoring your session..." on a first visit too); **a chosen answer has a ring and its number or letter in a badge**; on a phone the Next/Submit bar lets a background picture show through; a switched-off button keeps a visible edge; confetti from a finished activity does not fall on the next one; no request for /favicon.ico.',
    `- The admin page: "Correct" and "Top choice" beside a bar share a baseline; Content's activity buttons fit one line, Delete at the end.`,
    "- **Nothing else changed:** not the lists (version 3), not Setup's steps, not what is counted or stored, and not a request any page sends. The participant page was 298 B larger and the admin page 381 B larger than pms-21462b6's (gzip).",
    '',
    "## What changed in pms-21462b6 (since pms-e2fbfb6, 17 Oct 2026: the Live display's one-page PDF and PowerPoint drew plain bars and counted every visit as an iPad; the leader report's results were in its own words and the client's colour)",
    '',
    '- **The Live display\'s Export PDF and Export PPT draw the Live display\'s charts.** Each question has the sentence the screen puts above it, "N answered" and "N of M got it right first time", its bars in the screen\'s order with the correct answer in Dark Green, a tick and "Correct", the top choice in blue and "Top choice", a true-or-false question as one split bar, a confidence scale\'s columns with its average, a ranking\'s places and support scores, and the words that came up most in written answers. Deloitte\'s colours of the screen; the client\'s colours stay in the header. No participant\'s name is in either file. The two files are still one layout, and still one page for a typical session.',
    '- **The header of both says "N answers from M iPads" as the Live display does**: the iPads that answered. Kroger\'s 16 Oct session, whose five visits answered 9, 8, 0, 8 and 9 times, says "34 answers from 4 iPads" where it said 5. One iPad is "1 answer from 1 iPad", on the screen too (it said "1 answers from 1 iPads").',
    '- **The leader report\'s "Results by activity" uses the same words and colours**: each question\'s sentence and "N of M got it right first time" over its bars, drawn as on the screen; the facts under each question, the cover, the comments with their names and the counting rules are as they were, and every number it printed before is still printed. The last page adds one sentence: the Live display and its files count only the iPads that answered, so their figure can be lower than the participants the report lists.',
    '- **The one-pager\'s header words** were white on a client colour of middle lightness (3.7:1 on #3C8DBC); they are now whichever of white and near-black reads better.',
    "- **Nothing else changed:** not the lists (version 3), not Setup, not what is counted or stored, not the CSV files, and not a request any page sends. The participant page was byte for byte the same as pms-e2fbfb6's, and the admin page 4,482 B larger (gzip).",
    '',
    "## What changed in pms-e2fbfb6 (since pms-283ad18, 16 Oct 2026: a chart's tooltip could lie over the words above its mark, and a locked activity's title was too faint to read)",
    "",
    "- **A tooltip keeps clear of its card's words and buttons** (the question, \"N answered · N of N got it right first time\", **Show answer**, **View as table**, a caption) wherever the window has room: above its mark, moved along, or under it. Then it keeps clear of the other bars' figures and names too, moving along its own bar if it must (seen with pms-618b8fc: a ranking's last bar hid the figures of the two bars above it). Where there is no room it covers as little as it can, a figure before a word. It is still always whole, inside the window and clear of the mark and its own label.",
    "- **A ranking's places are plain numbers**: \"1\", \"1\", \"3\", \"4\", \"5\". A shared place was \"1=\" and the others \"3.\", which read as a typo on the real site; two bars with the same number, and the sentence above the chart, say it is a tie.",
    "- **A locked activity's title is white**, as its caption and lock are; it was a pale blue on blue (about 2:1). The pill still reads as locked by its darker fill, the lock and \"Finish the previous activity\".",
    "- **A question too long for full screen is never cut at the card's edge.** On a screen 1,550 px wide or more (a projector, a large monitor) the type stopped getting smaller before it reached its smallest, and the card was cut; now it gets smaller down to its smallest, and then the screen scrolls as one page with \"More below\". On an iPad or a phone nothing changed.",
    "- **The participant page looks again at once when the network comes back during a look**, as soon as that look ends; before, it waited for its next look (up to a minute with a question on screen) to learn, for example, of a restart.",
    "- **No change, by VJR's decisions of 16 Oct 2026:** names stay \"Last, First\" as the directory gives them, and the wall page keeps the admin header, tabs, Lock and Export. **Client heroes are squares** when the picture uploaded for them has no transparent background (the sample heroes were made from JPEGs): uploading a transparent PNG in Brand Studio makes a round one, with no new build.",
    '- **Nothing else changed:** not the exports, not what is counted or stored, not the lists (version 3), not Setup, and not a request any page sends. The participant page is 30 B larger than pms-283ad18\'s and the admin page 32 B larger than pms-283ad18\'s (gzip).',
    '',
    '## What changed in pms-283ad18 (since pms-3fb312a, 16 Oct 2026: on a Windows laptop a confidence question in full screen had a scrollbar inside its chart and its tooltip cut off)',
    '',
    '- **Nothing inside a chart\'s card scrolls.** The confidence chart was a box that could scroll (and on Windows a fraction of a pixel is enough for a scrollbar with arrows); so was the numbers view. Neither is now, at any size.',
    '- **A tooltip is always whole.** It is drawn over the page, next to the mark it is about, clear of the mark\'s own label (and of a scale\'s "Average ..."), above it or under it, and inside the window; it follows the mark when the page scrolls.',
    '- **In full screen the chart fills its card**: a scale\'s plot is as tall as the card allows, the bars share out the height, and a true-or-false bar sits in the middle; no empty white space under the chart. A question too long for a screen held upright even at the smallest type now lets the screen scroll as one page, with "More below" and the controls in view, instead of being cut at the card\'s edge. Each refresh no longer puts the type back to full size for a moment.',
    '- **Wider confidence columns** (40% of a step, 24 to 72 px on the admin page, larger in full screen) and **the figures under the bars centred on their gridlines** ("0%", "50%", "100%").',
    '- **Each card keeps its own height**: opening the names of one card no longer stretches the card beside it.',
    '- **The headlines\' words**: "Most people (N%) chose ..." only when more than half did; otherwise "The top choice (N%) was ...". A true-or-false question says "Most people (N%) said True." or "The top answer (N%) was True."; multiple choice says the same as single choice. An answer whose own words end with a full stop ends the sentence with that one stop.',
    '- **"N answers from M iPads" counts the iPads that answered** (VJR\'s choice), on the Live display\'s header and on each Results card: Kroger\'s five visits of 16 Oct, which answered 9, 8, 0, 8 and 9 times, are "34 answers from 4 iPads" where they were "from 5 iPads". The Live display\'s one-page PDF and PowerPoint still print every visit, until Phase 11b redesigns them.',
    '- **Nothing else changed:** not the exports, not what is counted or stored, not the lists (version 3), not Setup, not a request any page sends, and not the participant page (byte for byte as pms-0a1c701\'s). The admin page is 2,158 B larger than pms-3fb312a\'s (gzip).',
    '',
    '## What changed in pms-3fb312a (since pms-0a1c701, 15 Oct 2026: on the new site Results showed plain blue bars and totals only, and nothing showed who picked what)',
    '',
    '- **A chart of its own kind for each question, drawn by hand** (no chart library: Chart.js has left the admin page, which is about 54 kB smaller). Single and multiple choice: bars, highest first, the top choice in Deloitte Blue with the words "Top choice", the rest in a lighter blue, every bar with its count and share written at its end. True or false: one bar split, True on the left. A confidence scale: a column for each step in shades of blue, three light bands behind them, and the average at its true place ("Average 2.0 of 3"). A ranking: a support score from 0 to 100 (100 means everyone ranked it first), shared places shown as "1=". Written answers: the words that came up most (repeated words, counted by comment: not themes), each a button that shows only the comments that hold it, and the comments themselves.',
    '- **A sentence above every chart** says the result in words, worked out from the data: "Most people (50%) chose ...", "A tie between X and Y (2 each).", "No answers yet.", and for a quiz "3 of 4 got it right first time." **View as table** swaps a chart for its numbers.',
    '- **Names on the facilitator\'s own view.** Press a bar: `Who picked: <answer> (N people)` appears under its card, each name with the time it was given (the names Results and the leader report use). A **Names shown** switch hides them all. No request was added: a guest\'s name is on the visit; a staff sign-in name is known when Results has been opened in that tab (opened straight from its address, the Live display calls that person "Unnamed participant N").',
    '- **The wall display has no names.** Full screen, and the page **Open in a new tab** opens (its address ends in `/wall`), show no participant\'s name anywhere, and a quiz question marks its answer only after **Show answer** on its card. The facilitator\'s own view always marks it.',
    '- **Deloitte\'s colours** for the charts (Deloitte Blue, Dark Green for a correct answer with a tick and the word, Deloitte Green as a rule on each card); the client\'s logo, name and colour stay in the heading. Every pairing was measured: words 4.5:1 or more, and the marks still apart in greyscale.',
    '- **Nothing else changed:** not the exports (CSV, PDF, PowerPoint, the leader report and the participant answers), not what is counted or stored, not the lists (version 3), not Setup, not a request any page sends, and not the participant page (byte for byte as pms-0a1c701\'s). The admin page is 54,058 B smaller (gzip); Setup is as it was.',
    '',
    '## What changed in pms-0a1c701 (since pms-da9fc8d, 15 Oct 2026: on the new site the participant page responded slowly, showing its loading lines)',
    '',
    'The data is small (a live client has a few activities); what cost was the number of requests the page waited for **one after another** (rounds), and the screens that waited on them. Counted on the mocked SharePoint by `scripts/test-participant-waits.js`, which holds every request and lets the waiting ones go together, in waves: a moment\'s rounds are the waves it needs (the settings file aside).',
    '',
    '| Moment | Rounds before | Rounds now |',
    '|---|---:|---:|',
    '| Page open on the staff link, up to Welcome | 4 | 2 |',
    '| The same, someone with an earlier visit today | 4 | 3 |',
    '| Page open by a first QR scan | 4 | 4 |',
    '| "Click here to begin", once the page has fetched ahead | 7 | 2 |',
    '| "Click here to begin", pressed at once | 8 | 4 |',
    '| The Activities hub, arriving | 1 | 0 before it is drawn |',
    '| Opening an activity | 1 | 0 |',
    '| Next | 0 | 0 |',
    '| Submit (the earlier answers saved) | 1 | 1 |',
    '',
    '- **The column check reads only what it checks.** Before a list\'s first write the pages read its columns; that read named no properties, and a real list answers it with every field it has, hidden ones too, each with its whole definition. It now names the eight the check uses (`$select=InternalName,TypeAsString,...`). The schema checks of Today and Setup still read every property.',
    '- **"Click here to begin" waits for two rounds.** AppSettings and the session are read side by side (what AppSettings says still wins); the write token and the types and column checks the visit needs are fetched once the first screen is up; the session is moved to in progress with the version its check read, after the visit is written, and the press does not wait for it.',
    '- **The first screen waits for two rounds.** The session\'s visits (has this account visited today?) are read beside the client, the session and the activities; what that read finds is used only for a live session of staff. The activities\' questions and options are read once the first screen is up, all of them in one go, and held for as long as the page is open.',
    '- **The hub and the activities open from what the page holds.** The hub is drawn at once, then reads the activities and the enabled ones\' questions and options again behind it (one request where the site can batch), so **an edit made in Content reaches a participant at the next activity they open after visiting the hub**; an activity already open keeps what it opened with. A read behind the hub that fails leaves the activities on the screen. A loading line that is still needed appears only after 300 ms.',
    '- **The requests:** a whole visit of the staff link (open, begin, both of Kroger\'s activities, finish) is 30 requests where it was 33 for the session\'s first device, and 27 where it was 29 after it. **On a site that cannot batch** (`"batch": false`) it is 34 and 31: each arrival on the hub reads three lists there. This site batches (its self-test passed the batch step).',
    '- **Nothing else changed:** not what is saved, or how (Submit still waits until the answers are saved, and "Couldn\'t save, Retry" is as it was), not first tries, not single-use QR codes, not the page\'s timer, not the admin page or Setup, not the lists (version 3). The participant page is 1,207 B larger (gzip) and the admin page 933 B.',
    '',
    '## What changed in pms-da9fc8d (since pms-e250a36, 15 Oct 2026: on the new site Go live, a visit and the self-test worked, and Results did not load)',
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
    '**Steps 1 to 9 of the runbook have run on the real site** (14 Oct 2026, pms-969bf16: Create made 13 lists, 89 columns and 47 settings; Check Lists all Ready; the site marked ready; an admin added; the samples seeded with their six pictures; PMSAdminUsers locked), **with pms-e250a36** (15 Oct 2026) the self-test (10 of 10), Content, Go live with Domino\'s and a participant\'s visit in Chrome; Results did not load, **and with pms-da9fc8d** the lists of version 3 and a participant\'s visit, which was slow; **with pms-0a1c701** (15 Oct 2026) a named guest\'s visit by QR code, four activities, and Results\' plain bars; **with pms-3fb312a** (16 Oct 2026, a colleague\'s Windows laptop in Chrome) the Results charts, their names panel, Names shown, the ranking\'s figures, the correct answer\'s tick and the numbers view, and in full screen a confidence chart that scrolled and cut its tooltip off. **These pages have not run there yet, and nothing has run on an iPad or a projector.** Their charts, names and wall (QA-TESTING.md items 150 to 156) were tested on the local server and the mocked SharePoint REST in three engines: a named guest on the right bar, no name anywhere on the wall, Show answer, the numbers views, every chart at five sizes, axe, and the marks apart in greyscale; and how they fit their cards (items 157 to 159) at nine sizes and at a Windows laptop\'s 125% and 150% scaling, in full screen and on the wall page: nothing inside a card scrolls, every tooltip is whole, seen at its corners and clear of its label, and each chart fills its card. How long one request takes on that site, how large a read of a list\'s columns is there, and whether it answers 429 or 503, nobody has measured: the timing check of the note says (QA-TESTING.md items 146 to 148). They were tested against a local server and a mocked SharePoint REST API that answers as the real site did (it leaves `ClientId` out of an unnamed read and refuses a duplicate with 500), in Playwright\'s Chromium, WebKit and Firefox on a Mac, and the runbook (with the note for this site) was rehearsed on that mock with these very pages. Unproven until the site shows them: that Setup brings the site from version 2 to version 3 and Results then loads (QA-TESTING.md item 145); which columns the site will not return by name, with a guest and a code on it (item 143); the QR check-in of a named guest (item 144); what the site leaves out of an unnamed read besides `ClientId` (item 139); Content, Today, Go live and Results with these pages (item 140); the site\'s error code for a duplicate (item 142); that a missing pms-config.txt is a 404 (item 138); the participant accounts\' permissions; Go live, an iPad and Results at all. RUNBOOK.md says which QA-TESTING.md item each step answers.',
    '',
  ].join('\n');
}
