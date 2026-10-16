# QA testing checklist

> **Parts of this checklist describe the old site and the legacy screens.** The legacy app left this branch in Phase 10c-1 and is kept only in the local tag `legacy-final`; the old site keeps running the files already uploaded there. The checklist is reorganised with the README in Phase 10e (its lists part follows Phase 10c-3). Until then: the per-screen lists that say they describe the legacy screens are history, the numbered items of the later sections are the ones that apply to the new pages, and only the steps that would now fail are corrected here.

Manual pass to run before a session, on a real iPad (iPadOS 16.4+, Safari) in the same
Wi-Fi as the server. Tick each box; write down anything that differs from "Expect".

## 0. Setup

For SharePoint-only deployment, upload the build contents, sign in on each device,
and use the p_cec_01 URLs instead of a local server. First run the read-only schema check
at setup.html, then explicitly import starter data if needed. Verify that Network
requests use `/sites/CreativeExpCOE/_api/`, not `/api` or Microsoft Graph. Test permission
denials and sign-in expiry separately from offline behavior. Follow the remaining
checklist with SharePoint; no Node process is needed at the venue.

- [ ] `npm run dev` on the host machine (the API; it serves no page since Phase 10c-1), and beside it `npm run dev:svelte` (and `npm run dev:svelte:admin` for the admin). Note the Network address Vite prints: that is the URL for the iPad.
- [ ] Back up `server/data/` (or run against a scratch copy: `DATA_DIR=/tmp/qa-data npm run dev`),
      because this pass creates tracks and answers.
- [ ] On the iPad open the URL in Safari → Share → **Add to Home Screen**, then launch it from the
      icon. **Expect:** no Safari address bar or tabs; content clear of the status bar and home bar.
- [ ] Have the admin open on a second device (or a second tab): the address `npm run dev:svelte:admin` prints, ending `/admin.html` (on SharePoint: `admin.html` in the same folder).
- [ ] Facilitator display (optional): `<url>/admin.html#live-display` (Today → Live display). The old participant address
      `<url>/#/master-results/<sessionId>` is only a notice that points there.

Kiosk behaviour (do once, on the iPad):

- [ ] Pinch on any screen. **Expect:** page doesn't zoom.
- [ ] Double-tap a button quickly. **Expect:** no zoom, and the action happens once.
- [ ] Drag down at the top of a short screen. **Expect:** no rubber-band bounce.
- [ ] Long-press text or a logo. **Expect:** no select handles, no "Save image" menu.
- [ ] Tap into the admin PIN field and the QR link field. **Expect:** page doesn't zoom on focus;
      long-press in the link field still offers copy.

## 1. Full click-through, per screen

### Participant flow on an iPad or iPhone (Svelte, Phase 2): check these on real hardware

The per-screen lists below describe the legacy screens. For the Svelte participant page, run the
flow once on a real iPad (portrait and landscape) and once on an iPhone, signed in as the firm
account, with a visitor QR code.

- [ ] Scan the QR: **Welcome** shows the client logo on a white round plate, "Hi {visitor name}!"
      and "Click here to begin"; after any answer the button reads "Activities".
- [ ] The header keeps the Deloitte wordmark left; on every other screen it shows "Hi {name}!" and the
      sound switch (off by default). The notch, Dynamic Island and home indicator never cover a control.
- [ ] **Activities**: the second pill is dimmed with a lock and "Finish the previous activity" until the
      first is finished; finishing gives the first a green dot and opens the second within ~10 s.
- [ ] **Question** (graded): tap a wrong answer. It turns red with "Incorrect" and the button reads Retry;
      Retry clears it; a second wrong answer turns the right one green and shows Next. Tap a right answer: green
      with "Correct" and Next. Taps feel instant and nothing waits on the network until the last Submit.
- [ ] On the iPhone the Next / Retry bar sticks to the bottom and clears the home indicator. Rotate to landscape:
      the stage stays centred and nothing is clipped.
- [ ] Logo-tile questions show a 2x2 grid; the tapped tile turns purple-tinted with a red frame, the right one white with a green frame.
- [ ] Ranking: tap options in order; tapping a ranked option removes it; "Clear ranking" starts again.
- [ ] Turn Wi-Fi off on the last question and tap Submit. After about two seconds it reads "Couldn't save, Retry"
      and keeps the answers. Turn Wi-Fi on and tap it: the activity completes. Reload mid-activity: it resumes at the
      first unanswered question.
- [ ] Switch on **Reduce Motion** (Settings, Accessibility): no confetti and no step animation.
- [ ] With VoiceOver: each new question's heading is read, and "Correct", "Incorrect" and the reveal are announced once.
- [ ] Sound and confetti: see "Sound and confetti on a real iPad" below.
- [ ] From the admin, **Preview** an activity: right answers are marked, answers cannot be picked, nothing is saved.

### Sound and confetti on a real iPad (Phase 3): only a person can check these

The automated tests prove the cues are not silent, are not loud, are the right length, start and end without a
click, play the notes in the table, and fire at the right moments (and only those). They cannot tell you whether
anything sounds good or feels annoying, or how it behaves on real iPad hardware. Use an iPad running iPadOS 17 or
later (and one on 16.4 if the firm still has them), volume about halfway.

To audition every cue and burst on its own, run `npm run dev:svelte` on the Mac and open
`http://<the Mac's LAN address>:5173/#/styleguide` on the iPad; the "Sound and confetti" section has one button
per cue and per confetti size (they play whatever the header switch says).

- [ ] **Silent by default.** Open the real page (QR or Welcome). Tap through a whole activity with the header switch
      off: no sound at all.
- [ ] **Turning it on is heard.** Tap the header switch: a short two-note chime plays at once, inside the tap. If
      nothing plays, that is the iOS audio-unlock failing; note the iPadOS version and the browser.
- [ ] **Ringer switch on silent.** With the iPad's silent mode on and the header switch on, the cues should still
      play (iPadOS 17+). With the header switch off they must not. On iPadOS 16.x they may stay muted by the ringer
      switch; record which version you tested.
- [ ] **Other audio.** The `playback` session can pause music or a podcast that was playing when sound is switched
      on. Confirm that is acceptable and that it resumes when the switch goes off.
- [ ] **Each cue, by ear.** Listen to all eight: Sound on (two-note chime), Option picked (soft tick), Correct first
      try (bright rising two notes), Correct after a retry (one gentler note), Incorrect (soft, low, falling),
      Answer revealed (one neutral note), Activity complete (rising three notes), Finale (major-chord fanfare).
      Are they pleasant, never harsh, never startling? Are they about equally loud? Can you tell a first-try win
      from a retry win, and a wrong answer from a reveal, without looking?
- [ ] **The tick** follows the tap with no noticeable delay and does not machine-gun when you tap options quickly.
- [ ] **Next, Back and Home are silent.**
- [ ] **A real flow.** Answer a graded activity wrong, retry, right; then a first-try right; then a double wrong
      (reveal). Each gives exactly one sound, and confetti only on the first-try right. Finish the activity (rising
      three notes and a medium burst), then the last activity (fanfare and the big finale).
- [ ] **Confetti.** Small is near the green "Correct" pill, medium comes from both lower corners, large fills the
      screen over about 2.5 seconds. It is smooth on the oldest iPad in use, never blocks a tap (tap Next while it
      is falling), leaves nothing behind, and never makes the page scroll sideways. It is not red on any client.
- [ ] **Reduce Motion** (Settings, Accessibility, Motion): no confetti anywhere, but with sound on the cues still play.
- [ ] **Interruptions.** With sound on, take a call or ask Siri, lock and unlock the iPad, switch to another app
      and back. After the next tap the following cue plays (the context resumes). Note any cue that was lost.
- [ ] **Reload.** With sound on, reload the page: the switch still reads On, nothing plays at load, and the first
      tap (Welcome's "Click here to begin") starts audio without a sound of its own.
- [ ] **Bluetooth and AirPods.** Cues come out of the connected device. Note whether the first cue after the earbuds
      have been idle is clipped.
- [ ] **Other browsers.** Repeat the chime and one right/wrong answer in Safari and Chrome on the iPad (both are
      WebKit), and on desktop Chrome, Edge and Firefox. In Firefox and Edge confirm the console shows no errors.
- [ ] **No Web Audio.** Hard to force on a device; the automated test covers it. If a locked-down browser has
      none, the switch must be greyed with "Sound isn't available in this browser" and the activity still works.

Use the seeded Kroger session unless noted. Every tap target should be comfortably hittable
with a finger (44×44 pt minimum). Run the console audit in section 6 on each screen too.

### Welcome (`#/welcome`)

- [ ] Loads with client logo/name area, "Scan QR code to begin", Select Client dropdown.
- [ ] Choosing a client with no tracks yet goes straight to the Agenda.
- [ ] Choosing a client that already has a track shows the resume list and "Start a new session".
- [ ] Choosing a client with no open session shows "No active session for this client yet."
- [ ] Opening a used/expired QR link lands here with the reason shown.

### Agenda (`#/agenda`)

- [ ] Lists only enabled sections, in order.
- [ ] Each row shows "Not started" until every question in it is answered, then "Completed ✓".
- [ ] "I'm finished" stays hidden until every listed section is complete.

### Quiz / poll (`#/quiz/<id>`)

- [ ] Every question type present in the data renders and can be answered
      (single-select, multi-select, true/false, confidence scale, ranked voting).
- [ ] Submit is disabled until all questions are answered. Ranked voting needs every rank used once.
- [ ] Submit returns to the Agenda with the section marked complete.
- [ ] Re-opening a completed section shows the earlier answers; changing and resubmitting works.
- [ ] Back returns to the Agenda without saving.
- [ ] Revisit a quiz and the Agenda with Network open. **Expect:** each screen's HTML
      is fetched once per page load; responses and section enablement remain fresh.
- [ ] Submit a multi-question quiz on SharePoint. **Expect:** one Responses read and
      one write after metadata/digest warm-up (extra requests only for retries).
- [ ] While Submit is saving, change a selection and tap Submit again. **Expect:**
      no second submission; a failed save keeps selections and allows retry.

### Feedback (open-text section)

- [ ] Submit is disabled while the box is empty or whitespace only.
- [ ] Submitting returns to the Agenda; re-opening shows the saved text.

### Thank you (`#/thank-you`)

- [ ] Only reachable once everything is complete (typing the URL early bounces to the Agenda).
- [ ] "Start over" returns to Welcome with no track; the previous answers stay in the results.

### Live display (admin → Results, or Today → Live display; it was the Master screen, `#/master-results/<sessionId>`)

- [ ] `admin.html#live-display` opens the live session's display; with nothing live it lists sessions to choose from.
- [ ] Charts and open-text comments match what was submitted; the counts ("N answers from M iPads") update within about 12 seconds on SharePoint
      (2 on the local server), with no reload.
- [ ] Since Phase 11a each question is a chart of its own kind, in Deloitte's colours (Deloitte Blue bars, the tint for the rest, Dark Green with a tick for
      a quiz's correct answer, a Deloitte Green rule on each card); the client's logo and name, and its colour under the heading, are in the header.
- [ ] Each card's headline says the result in words ("Most people (75%) chose ..." only above half, "The top choice (50%) was ..." otherwise: Phase 11a-2),
      **View as table** shows the same numbers, and on the facilitator's
      view a bar opens **who picked it** under its card; **Names shown** hides every name. **Open in a new tab** opens the wall display
      (`#live-display/<id>/wall`): no names anywhere, and **Show answer** on each quiz question.
- [ ] Export CSV / PDF / PPT each produce a file that opens (on an iPad: Safari's download prompt).
- [ ] **Full screen** (see "Projecting the Live display" in section 10): large type, no tabs or buttons, ONE question at a time with the whole card
      on the screen (nothing to scroll), **Previous / Next** and the left and right arrow keys, an **Auto-advance** switch (off by default), and a way
      out and controls that fade together and return on touch. No participant's name is on it, and a quiz question's answer is marked only after
      **Show answer** on its card.
- [ ] `#/master-results/<id>` on the participant page says "Results have moved to the admin page" and its link opens the display.

### Leader report and participant answers (admin → Results, under each session's heading)

Automated: `npm run test:report` (every number against a session worked by hand, the PDF read back with pdf.js, the layout guard, both
storage adapters) and `leader-report.spec.ts` (both downloads in Chromium and WebKit). What a person should still look at:

- [ ] **Leader report (PDF)** on a session's card: the line beside the buttons counts "Preparing page N of M", then says "Saved
      leader-report-<session>-<date>.pdf (M pages)". **Cancel** during it says "Cancelled. Nothing was saved." and no file arrives.
- [ ] Open the file. **Cover (the answer first)**: the client's logo (or nothing, if it has none: the name is in the band either way) and the
      Deloitte wordmark in black with its green dot; the client's name, the event title and the session's date in a band of the client's colour;
      then **Summary**: the three figures (joined, finished every activity, average first-try score), completion by activity, and the hardest
      and easiest question; then one line, "Made on ... from the answers saved for this session. How the numbers are counted is on the last
      page." (With many activities the hardest and easiest, and that line, are the top of page 2.) The cover has no counting rules.
- [ ] **The last page, "How the numbers are counted"**: "About this report" with the session line (and whether it had ended), the eight
      counting rules, and the notes (a restart, a switched-off activity, a character the font cannot print).
- [ ] **Admin → Results lists the same people**: the same names, in the same order, as the report's Participants pages ("Unnamed participant N"
      for a visit with no name, "José Álvarez (2)" for a second visit, never the client's name or "Visit 1").
- [ ] **Results by activity**: every question with a bar, a count and a percentage for each answer; the correct answer in **bold with a
      tick and the words "(correct answer)"**; "Right first time: N of M"; the most common wrong first answer; what became of the wrong
      first tries. A poll has no tick. A confidence question has its average; a ranking is in order of points.
- [ ] **What participants said**: every written answer in full, under its question, with the writer's name in bold. A long one wraps and,
      if it must, carries on to the next page: nothing ends in "...".
- [ ] **Participants**: one block a person, in the order they joined; a block is on one page unless it is longer than a page. Each answer
      to a graded question has a tick or a cross and the words "(right first time)" or "(wrong), then ...". Someone who answered nothing
      says "No answers recorded."; someone the facilitator restarted has the time of the restart; someone with no name is "Unnamed
      participant N" (never the client's name).
- [ ] Every page: "Confidential – internal", the client's name, "Page N of M".
- [ ] **Print one page in black and white**: the bars, the tick and the cross are still plain; nothing depends on the colour.
- [ ] Names with accents (José, Zoë, Søren, Łukasz) are right in the PDF. An emoji in a comment prints as a small "?" in a diamond, and
      the notes on the last page say so; the CSV has the emoji.
- [ ] **Participant answers (CSV)**: opens in Excel with the accents right (the file starts with a byte-order mark); one row for each
      person and question; a comment with a comma or a line break is still one cell; a comment that starts with `=` shows as text with
      an apostrophe in front, not as a formula.
- [ ] Delete a question that people answered (Content), make the report again: the question is gone from the results, its answers are
      under **Questions no longer in the activity** at the end, and no score changed because of them.
- [ ] The Live display's own Export CSV / PDF / PPT are unchanged.

### Admin (`/admin.html`)

The Svelte admin has five tabs: **Today, Clients, Content, Guests and QR, Results** (the frozen legacy admin keeps its
older five: Sections, Content, Clients, Sessions, User Setup). Content is the old Activities and Content tabs in one, scoped by a client
switcher; `#sections` (the old Activities address) opens it. Walk the whole of "Running a demo day" in section 10 for Today.

- [ ] Today: pick a client and date, Go live, the readiness rows, the status panel, the controls, End session / Reopen session.
- [ ] Content: the client switcher (opens on the live client); each client's activities with the live switch, Preview, Rename (name and
      description), Duplicate, Move up/down, Delete (asks, and counts recorded answers); Add activity; Copy from another client...;
      the selected activity's questions: add/edit/delete a
      question and its options, **Layout** (list or picture tiles) and each option's picture address with its preview.
- [ ] Clients: add/edit (slug, event title, subtitle, welcome line, results colours), archive/restore, delete, logo upload, Generate QR (image, link, Copy, Open, New code).
- [ ] Guests and QR: paste names, Add, Generate all codes, each guest's status, Generate QR / Show QR / Replace code / New visit code, Disable, Print QR sheet, Export CSV, recent entries.
- [ ] Results: track list with live status, Restart…, Live results, Live display, Refresh.
- [ ] Lock returns to the PIN screen.

## 2. Two simultaneous clients (merge)

Two iPads, or two browser tabs (same client, second tab → "Start a new session"; or Generate QR twice
and open each link in its own tab). Watch Admin → Results → Live results or the Live display.

- [ ] Sessions shows **two** tracks for the session, each with its own status.
- [ ] Client A and client B answer the **same** question at the same time with different options.
      **Expect:** both answers appear in the tally (count = 2, respondents = 2); neither overwrites the other.
- [ ] A finishes everything; B has answered only some. **Expect:** A reaches Thank you, B's Agenda is
      unaffected, and the tally shows A's answers plus B's so far.
- [ ] A restarts a module (Admin → Sessions → Restart…) on A's track only. **Expect:** A gets the
      notice and jumps to that module within ~3 s, B is not disturbed, and only A's answers to it disappear.
- [ ] Two iPads scan the **same** QR code together. **Expect:** exactly one gets a track; the other is told
      the code was already used.
- [ ] Unplug one iPad's Wi-Fi mid-quiz. **Expect:** the other iPad and the tally keep working (section 3).

## 3. Server unreachable / flaky network

Simulate by stopping the server (`Ctrl+C`), or turn the iPad's Wi-Fi off.

- [ ] While on the Agenda: after about 6–9 s a red bar appears at the bottom, "Can't reach the server.
      Reconnecting…" with a Retry button. The screen underneath stays as it is.
- [ ] Turn the network back on. **Expect:** the bar disappears by itself within a few seconds.
- [ ] While offline, tap into a screen that needs data (or reload). **Expect:** "We can't reach the server"
      with **Try again**, not a blank page; it retries by itself every 5 s and shows the screen once
      the server is back.
- [ ] While offline, press Submit on a quiz. **Expect:** "Could not save your answers. Please try again."
      and the choices are still selected; Submit works again after reconnecting.
- [ ] Reload while offline on a `?qr=` link. **Expect:** retry screen, and after reconnecting the code
      still works (it is not burned).
- [ ] Admin offline: opening a tab shows "Can't reach the server" with Try again; the PIN screen says
      "Couldn't reach the server".
- [ ] One iPad offline does not change anything on the others.

## 4. Admin enable / disable mid-session

Client on the Agenda, admin on Sections. The client polls every ~3 s.

- [ ] Disable a section. **Expect:** it disappears from the client's Agenda within ~3 s, with no reload
      or flicker of the other rows.
- [ ] Re-enable it. **Expect:** it reappears in its original position, still showing "Completed ✓" if it was.
- [ ] Enable a section the client hasn't done after they finished the rest. **Expect:** "I'm finished"
      disappears (they have work again); disable it and it comes back.
- [ ] Disable a section **while a client is inside it**. **Expect (current behaviour):** the open
      quiz is not interrupted and Submit still saves; the section is gone from their Agenda afterwards.
      Confirm this is acceptable for the room.
- [ ] Disable a section, then try its URL by hand (`#/quiz/<id>`). Note the result; the quiz screen does not
      re-check `enabled`.
- [ ] A client on Thank you when another section is enabled stays there until they tap Start over.
- [ ] Disabled sections don't count towards "all complete", and their earlier answers stay in the results.
- [ ] Preview from admin works for a disabled section and writes nothing.

## 5. Resume after reload

The track id rides in the URL hash (`#/quiz/<id>?t=<track>`); nothing is stored in the browser.

- [ ] Mid-quiz, with some answers saved: reload. **Expect:** same screen, saved answers filled in.
- [ ] Reload on the Agenda. **Expect:** same Agenda with the completed marks intact.
- [ ] Reload on Thank you (all complete). **Expect:** still Thank you.
- [ ] Reload on a home-screen install and after swiping the app away and reopening. **Expect:** returns to
      the same track. In Staff mode, Welcome identifies the signed-in account and offers its own resume;
      in Client Visit mode, the claimed roster identity resumes its existing track.
- [ ] Scan a visitor QR code, reload before confirming Welcome. **Expect:** same track and roster name,
      not "code already used"; URL is now the track route rather than `?qr=`.
- [ ] Admin ends the session, then reload the client. **Expect:** Welcome, "this session has ended".
      Admin reopens the session and reloads again: the track resumes.
- [ ] Admin deletes the track while the iPad is open. **Expect:** within ~3 s it returns to Welcome with
      "Your session is no longer available."
- [ ] Open a URL with a made-up `?t=`. **Expect:** Welcome, "We couldn't find your session."

## 6. User Setup and visitor entry

Use an approved synthetic session and roster. User Setup applies one active session site-wide; it does not
create data isolation between SharePoint folders or override list permissions.

- [ ] In Staff mode, select and save one active session. Open participant entry. **Expect:** no client selector,
      the signed-in SharePoint display name is shown, and only the selected company's session can be joined.
- [ ] Continue and reload in the same tab. **Expect:** one UserVisitLogs row for the tab, with repeat writes
      deduplicated by AppId; the visit log is analytics, not a compliance audit record.
- [ ] Switch active session. Accept the confirmation. **Expect:** new joins use the newly selected session;
      a stale QR, resume URL, or join for the previous session is rejected by the app.
- [ ] Enable Client Visit mode and save. Add two different synthetic roster names; generate a QR for each.
      **Expect:** each code maps to only its roster row and session; participant UI has no client selector.
- [ ] Scan one visitor code. **Expect:** Welcome names that visitor and requires Continue before Agenda;
      the Track and visit log refer to the roster ID/name, not a different visitor.
- [ ] Scan the same code again or disable the visitor. **Expect:** the code is rejected. Disabling retires
      unused codes permanently; re-enabling the roster row does not revive them. Replace the code explicitly.
- [ ] Deny UserVisitLogs add permission or make the log request fail. **Expect:** the app still permits a valid
      participant visit and shows a non-blocking logging warning.
- [ ] In a signed-in browser with no active session, open participant entry. **Expect:** clear no-session state;
      admin selects the active session in User Setup before participants can join.
- [ ] Verify effective SharePoint permissions separately. App-level active-session filtering is not list-level
      security; participants with broad list-read permission may still call SharePoint REST directly.

## 7. Admin PIN login and lockout

The login is a mock check against `adminusers.json`. Sign-in is by PIN only (no username).

- [ ] Correct PIN opens the Sections tab; the admin's name shows in the top bar.
- [ ] Wrong PIN shows "Incorrect PIN.", clears the field and refocuses it.
- [ ] Empty PIN: **Expect** "Incorrect PIN." (no crash).
- [ ] Server down at login: **Expect** "Couldn't reach the server: …".
- [ ] Lock returns to the PIN screen; the browser Back button doesn't reveal the admin.
- [ ] **Lockout: there is none.** Enter a wrong PIN 10+ times, then the right one. **Expect (current
      behaviour):** it still signs in; there is no attempt counter, delay or lockout, and no server-side check
      (`auth.js` says so on purpose: the mock login is not a security boundary). If the room needs
      lockout, that comes with the Azure AD sign-in at the CEC deployment; if this test ever *does* lock
      you out, the behaviour changed and this section needs updating.
- [ ] Reload `/admin.html`: **Expect** the PIN screen again (the sign-in isn't remembered).

## 9. Today's client and per-participant responses (Phase 4)

Automated: `npm run test:storage` (budgets, races, resume, both response shapes, adapter parity,
seeds, against the mocked SharePoint REST and the local server) and `npm run test:migration`
(`clients.spec.ts` walks Kroger and Domino's on the real local server; `sharepoint.spec.ts`
measures the request budgets in a real browser against the mock; `setup.spec.ts` covers the Setup
page). **None of it touches the real tenant.** `admin-today.spec.ts`, `admin-sharepoint.spec.ts`,
`admin-smoke.spec.ts` (also on WebKit) and `scripts/test-admin-today.js` do the same for the Phase 5 admin. The checks below are the ones only a person on
the test site can make.

### Locally, in two minutes

1. `DATA_DIR=<scratch copy of server/data> PORT=3199 node server/index.js`, then open the
   participant page: it says **"Today's experience isn't live yet"**, in the default look.
2. `API=http://localhost:3199 npm run go-live -- c-kroger`. Within a few seconds, without a
   reload, the page becomes Kroger's Welcome: the mockup palette, "Welcome to the Kroger
   experience.", then **KROGER TRIVIA NIGHT** with Kroger's History first.
3. `API=http://localhost:3199 npm run go-live -- c-dominos`. A page left open turns to Domino's:
   a different blue, **blue buttons** (its red accent is only a thin ring on the white plate), the
   name "Domino's" in type on that plate (no logo, and nothing drawn in its place), **DOMINO'S
   TRIVIA NIGHT**, two activities. Nothing of Kroger's shows. Pick a wrong answer: the only red on
   the screen is the answer marked Incorrect; Retry and Home stay blue.
4. Pick a wrong answer and **reload before pressing Retry**: the question comes back still wrong,
   still waiting for its Retry. Finish it; the completion screen counts it as wrong.
5. Finish everything: the finale has **no "Start over"**. Add `?debug=1` before the `#` and it appears.

### On the SharePoint test site (not verified by any automated test)

- [ ] **Setup → Check Lists** says "All list schemas ready". If not, "What to fix" names each
      column; create them exactly as PROVISIONING.md says and check again.
- [ ] **Setup → Run self-test**: seven steps pass. The numbers to expect are 3, 1, 1, 1, 1, 1, 3
      requests. If "A second create with the same AppId is refused" fails, turn on **Enforce unique
      values** for `Responses.AppId` before any event: without it a participant can end up with
      two records. If "Update it with one write" fails, a blind `If-Match: *` overwrite is not
      accepted on this site and saving will not work as built. If only "Two reads in one request
      ($batch)" fails, everything still works but each QR scan costs 13 requests instead of 8:
      put `"batch": false` in the folder's `pms-config.txt` (or build with `PMS_BATCH=false`) (12), and report it.
- [ ] **Setup → Seed sample clients**, then again: the second run reports everything already
      present and changes nothing. Edit a question in Admin and seed again: the edit survives.
- [ ] **Setup → Assign existing activities to a client**, if the site has activities from before.
- [ ] Make a client live from **Admin → Today** (Go live). The panel should say "Verified: participants
      now see <client>". Its readiness list should show **SharePoint lists: Ready** (that row is the
      schema check, read as one `$batch`; if it says the lists could not be checked, run Setup → Check Lists).
- [ ] Open the participant page with the browser's network panel: count the requests before
      Welcome appears. Expect **8** (AppSettings and currentuser; Clients, Sessions, Sections;
      Tracks; Questions, Options). After it appears: the visit log (3 more).
- [ ] Scan a visitor's QR code with the network panel open: count the requests before "Hi
      {name}!" appears. Expect **8** (contextinfo, QRTokens, AppSettings; one `$batch`; Tracks,
      Questions, Options; then a MERGE to the QRTokens item), **9** for the first scan of the day
      (a MERGE to the Sessions item as well). After it appears: the visit log (2 more). Open the
      `$batch` reply: five parts, each `HTTP/1.1 200 OK` with JSON.
- [ ] Scan the **same** code on a second iPad: it says "This QR code has already been used", shows
      "Scan your visitor QR code", and the Tracks list has gained nothing. If two iPads can be
      made to scan one code within the same second, exactly one gets in.
- [ ] Answer a question, press Next, and watch the network panel: each pick is **one** POST with
      `X-HTTP-Method: MERGE` to one Responses item, and Next does not wait for it.
- [ ] In the Responses list, the participant has **one** item whose `AppId` and `TrackId` are
      their track id, and `ResponsesJson` holds every answer.
- [ ] Two iPads answering at the same moment: neither shows "Couldn't save".
- [ ] Open the same visit link (`...#/agenda?t=<track>`) on a second device: it resumes where the
      first left off.
- [ ] Admin → Results and the Live display show those answers; Admin restart of an activity
      sends the participant back to its first question and the answers do not return.
- [ ] Throttling cannot be provoked on purpose (Microsoft does not support load-testing
      SharePoint). If a save is ever throttled, the page should carry on and save a little later.

### What has NOT been verified against real SharePoint

1. That a `MERGE` with `If-Match: *` and only `ResponsesJson` in the body is accepted (the self-test checks this).
2. That a duplicate `AppId` is refused with a message the adapter recognises as a duplicate (it looks for "duplicate" or "unique value" in a 400; the self-test checks this).
3. That `$filter=TrackId eq '…'` and `SessionId eq '…'` with `$select` return what the mock returns, and that `__next` paging appears where expected.
4. That the item's `__metadata.type` in a read can be reused for a later write (the adapter does this to avoid a metadata request).
5. The real request count and timing of a page load, and the real cost of a QR first scan (8 requests against the mock, 9 for the first device of a session; 13 where `$batch` is refused).
6. `Retry-After` on a real 429 or 503, and how the tenant throttles ten devices on one account.
7. That the thirteen new columns exist with the right internal names (Check Lists verifies this).
8. Choice columns: whether the site refuses a value outside the choices over REST.
9. Permissions: that participants can add and edit Responses items and read the new columns.
10. A real iPad on the real site: theme before first paint, resume on a second device, the "isn't live yet" screen turning live.
11. **`$batch`** (new with the lean QR scan): that `POST <site>/_api/$batch` accepts the multipart body the page sends (one `application/http` part per read, CRLF line ends, an absolute encoded address, `Accept: application/json;odata=verbose` in each part), that it wants the same `X-RequestDigest` as any write, and that the reply is `multipart/mixed` with one part per read, in order, each carrying JSON. The self-test checks exactly this with two reads. Not checked by anything: whether SharePoint counts a batch as one request or as its parts when it throttles (the saving is certain for round trips, not for the 3,000-per-5-minutes budget), and how long a five-part batch takes against five reads sent side by side.
12. The QR claim as the participant page now sends it: a `MERGE` of the QRTokens item with `If-Match` set to the `__metadata.etag` from a filtered read (`$filter=AppId eq '…'`), answered 412 when another device changed the item first. The legacy `claimQrToken()` relies on the same pair, but it has not been observed on the tenant either.
13. Writing a Tracks item with only the list's item type (from the batch) and without first reading the list's columns, as the Responses and UserVisitLogs writes already do; and deleting a losing device's Tracks item with `If-Match: *`.
14. Two or more real iPads scanning one code at the same moment (proven here with five pages against the mock and five against the local server).
15. The heading focus on a real iPad: with no keyboard attached, no box round "Today's experience isn't live yet" or round a question; with a Bluetooth keyboard, the green ring after Enter on Next. Proven here in Chromium and Playwright's WebKit, not in iPadOS Safari.

## 10. Running a demo day (Phase 5)

The exact steps, from the PIN to End session. Nothing here needs a console, a script or Setup, once Setup has been
done once on the site.

**Before the day (any time)**

1. **Clients**: the client is there and *Active*. To add one: *Add client*, type the name (the slug and the event title
   fill themselves in), add the subtitle and the welcome line, *Save*. A client with sessions has its slug locked.
2. **Content**: pick the client in the switcher (it opens on whichever is live). Its activities are switched on, each with
   questions that have answers (and a correct answer where it is graded). Today's readiness list tells you if not. To start from
   another client's work, *Copy from another client...*: choose the source, tick the activities, read the counts (and which will
   be skipped because the client has them), *Copy*. The copies start switched off. A copy that cannot be finished is removed again, and
   *Run it again* copies only what is missing.
3. **The client's look** (colours, logo, hero art, background): **Clients → Brand**, see "Setting up a new client's look" below.
   With no picture at all, participants see the name in type on a white plate.
4. **Guests** (needs the client live, so the day before is fine if you Go live then and End session after, or on the day): see
   "Guests, codes and the print sheet" below.

**On the day**

1. Open `admin.html`, enter the PIN. You land on **Today**.
2. **Go live** card: choose the **client** and check the **date** (it starts as today, in this browser's time).
3. Read **Readiness**. A *Blocker* disables Go live and says what to fix and where; a *Warning* is yours to judge.
   *Re-check* reads everything again after you fix something in another tab.
4. Press **Go live**. If another client is live and people have joined it, a dialog names both and the number of people and
   says what happens to their pages (they move to the new Welcome within about 25 seconds, or about a minute and a half for
   someone with a question on screen; anyone partway through is taken out of the activity and starts again from Welcome; saved answers stay in the old session's results; unscanned visitor
   codes of the old session stop working). *Cancel* changes nothing.
5. The status panel turns **LIVE** and "**Verified: participants now see <client>**" appears. If it says *Not verified*,
   someone else changed it: look at the status panel.
6. Hand out the **participant link** (*Copy*) or show its **QR image**; *Open participant view* opens it in a new tab.
7. **Controls**: choose **how people are identified** (*Guests scan a personal QR* or *Staff sign in*) and the **activity flow**
   (*Sequential* or *Open*). For guests, open **Guests and QR** (below). Codes can only be made for the live session, and
   switching back to *Staff sign in* retires the unscanned ones.
8. During the event the **Participants** count refreshes every 10 seconds. **Results** lists each iPad and the live tally;
   **Live display** (a button on Today, and on each Results card) is the big display, see "Projecting the Live display" below.
   *Restart…* on Results sends one iPad back to a chosen activity (the iPad notices within a minute at most).
9. To change client: pick it on Today and *Go live* again.
10. When it is over, **Today → Controls → End session** (it asks). The status says *NOT LIVE*, unscanned codes stop working, and
    **pages that are open notice by themselves**: an iPad on Welcome or the Activities hub shows "This session has ended. Thank you. Your
    answers are saved." within about 25 seconds; one with a question on screen finishes that activity first (its answers still save), and
    sees the notice instead of the hub when it goes back; someone on the thank-you page keeps it. An iPad that opens or reloads the page
    sees the same words at once. *Reopen session* undoes it: the pages come back by themselves with their progress.
    Export results from the Live display before or after; ending a session does not delete anything.
11. **For the leaders, at the end of the day: Results → the session's card → Leader report (PDF)** (and **Participant answers (CSV)** if
    someone wants the raw rows). Make it after End session, and before anyone edits the questions for the next event: the report reads
    the questions, the answers' wording and which answer is correct at the moment it is made, and its cover says when that was. It is
    made in your browser from the saved answers and is not stored anywhere, so keep the file. It can be made again for any session the
    Results tab lists.

**Projecting the Live display**

1. On the laptop or iPad that is connected to the projector or screen (or mirrored to it with AirPlay), open `admin.html`, enter the PIN and
   press **Live display** on Today. (Keep Today open on another device or tab if you want both: the display's *Open in a new tab* opens it
   again, and a new tab asks for the PIN.)
2. Check it: the client's name and colours, "N answers from M iPads", a card for each question of each live activity. It refreshes by
   itself every 12 seconds; *Refresh* reads everything again now (new questions or edited words appear within 5 minutes without it).
3. Press **Full screen**. The display covers the window with large type; the admin bar, tabs and buttons are gone. It shows **one question at a
   time, the whole card on the screen** (nothing scrolls). Move with **Previous** and **Next** at the bottom, or the **left and right arrow keys**
   (after the last it goes round to the first). **Auto-advance** (off each time you enter full screen) moves on by itself every 15 seconds and goes
   round; a move by hand starts the 15 seconds again, and it waits while the tab is hidden. The controls and **Exit full screen** fade (and the
   pointer hides) after 3 seconds and come back when you move the pointer, tap, press a key or Tab to one. **Escape** also leaves.
4. Where the browser offers its own full screen (Chrome, Edge, Safari on a Mac) it uses it; on iPad Safari the display covers the page but the
   browser's own bars may stay: add `admin.html` to the Home Screen first if you want them gone.
5. The exports are not on the full-screen view: press *Exit full screen*, then *Export CSV / PDF / PPT*.
6. Before the event, try it once on the real projector: can the back row read the type, is the whole card there (axis labels and "N answered"
   included), and does the screen's own resolution change it? (The type scales with the window, 1.2 to 2.4 times, and a very long question is
   made smaller until the card is whole.) A written-answers question shows the rows that fit and says how many it left out.

**Guests, codes and the print sheet** (Guests and QR; the session must be live and set to *Guests scan a personal QR*)

1. **Paste names** into the box, one per line (commas also separate names: write "Jordan Lee", not "Lee, Jordan"). Under the box it says,
   before anything is saved, "N new, M duplicates skipped" and how many names were shortened (a name is kept to 60 characters) and
   how many blank lines were ignored. Repeats, and names already on the list (whatever their case or spacing), are skipped.
   *Add N guests* saves them; if some could not be saved the box keeps those, and pressing Add again adds only them.
2. **Generate all codes (N)** makes one single-use QR code for every enabled guest who has none, with progress ("Making codes: 12
   of 40"). It is safe to press twice, or again after a failure: guests who have a code (scanned or not) are skipped.
3. Each guest shows a status read from real data: **No code**, **Not scanned** (a code is out), **Joined** (they scanned),
   **Completed** (they have answered every question of every live activity), or **Disabled**. It refreshes every 15 seconds while
   the tab is open; *Refresh* does it now. One guest at a time: *Generate QR*, *Show QR* (the same code again), *Replace code* (the old
   one stops working), *New visit code* (for someone who has joined), *Disable* / *Enable*.
4. **Print QR sheet (N)** opens the sheet: a card for each guest whose code nobody has scanned, 3 across by 4 down, 12 to a page,
   with the guest's name, the QR code, the client's name and "Scan to begin". Choose *Print or save as PDF*. Print on **A4 or US
   Letter at 100%** (not "fit to page") with **headers and footers off**; the page breaks never split a card. On an iPad: *Print*, or
   *Share* then *Print*; pinch the preview to save a PDF. *Back to Guests and QR* returns. A guest with no code, who has already joined
   or who is disabled is not on the sheet (the sheet says how many).
5. **Export CSV** saves `guests-<client>-<date>.csv`: name, code status, joined (Yes or No).
6. Before handing the cards out, scan one with a spare iPad: it should open the participant page and greet that guest by name.

**If something looks wrong**

- The leader report lists "Unnamed participant 1": that visit had no name recorded (staff mode on the local server has no sign-in name;
  a guest whose roster entry was deleted keeps the name their QR code carried). The report never guesses one.
- The leader report has a section "Questions no longer in the activity": a question was deleted, or its activity was taken out of the
  session, after people had answered it. Their answers are there and are counted in no score.
- A participant's score looks low after a Restart: only the answers they gave after the restart exist; their block in the report says
  when they were restarted.
- "The report could not be made: That session no longer exists.": the session was deleted in another tab. Refresh Results.
- The Live display says "Connection lost. Retrying...": the page keeps what it showed and tries again by itself (it waits longer after each failure and for as long as SharePoint asks).
- An iPad still shows its hub after End session: it checks every 20 seconds (a minute with a question on screen), and not at all while the screen is off; it checks when the iPad is woken.
- Print QR sheet is greyed out: no guest has a code waiting. Make the codes first, or everyone has scanned theirs.
- Generate all codes says the session is not the live one: Go live with it on Today first. It also needs *Guests scan a personal QR*.
- A guest is not on the print sheet: they have no code, have joined already, or are disabled. *Replace code* or *New visit code* gives
  them a card again.
- Go live is greyed out: the line under it says which readiness rows to fix.
- A client is missing from the picker: it is archived (Clients → Restore).
- "Another client already has a session on this date": expected if two clients share a day; going live replaces the first for participants.
- Participants see "isn't live yet": nothing is live or the live client is archived (Today says which). "This session has ended." is the session that was ended.
- A copy stopped part way: the dialog lists what was copied, skipped and not copied; nothing half-built is left. *Run it again*.
- An activity made while its client is already live: it is added to the live session, so Results count it; it is off until switched on.

### Setting up a new client's look (Brand Studio, Phase 6)

Allow ten minutes, and do it before the day. Everything is on **Clients → Brand** (the button on the client's row); nothing a participant
sees changes until you press **Save**.

**What to prepare**

| Slot | Size | Shape | Format | Limit | Where it shows |
| --- | --- | --- | --- | --- | --- |
| **Hero badge** | 1200 × 1200 px | 1:1 | PNG or WebP, transparent background | 300 KB | Welcome, as it is (no plate) |
| **Client logo** | 800 × 400 px | 2:1 | PNG or WebP, transparent background | 150 KB | On the round plate on Welcome, when there is no hero |
| **Background** (optional) | 1536 × 2048 px | 3:4 | JPEG or WebP | 350 KB | Behind every screen, darkened so the words stay readable |
| Answer picture (Content, a question with picture tiles) | 480 × 320 px | 3:2 | PNG or WebP | 60 KB | On an answer tile |

You do not have to hit these exactly: choose any PNG, JPEG or WebP up to 10 MB and **Crop and fit** moves and zooms it inside a frame of the right
shape (drag, mouse wheel, the Zoom slider, or the arrow keys with + and −; *Fit whole picture* and *Fill the frame* jump between the two), then
the page makes the file exactly the right size and under the limit, in your browser. Things to know:

- **Not accepted**: SVG (a drawing can carry hidden script, and SharePoint will not store it), GIF and any animated picture, a damaged file, a
  file over 10 MB, and a picture so small it would have to be enlarged more than twice (the message says how wide it needs to be). Export a
  vector logo as a PNG with a transparent background first.
- **White-on-transparent logos** vanish on the white plate: choose the **Dark plate**. The page warns if a logo is mostly very light.
- **Keep what matters inside the dashed line** (the safe area) on each picture. For the background it is the part that every screen shows,
  because a phone shows the middle of the width and a desktop the middle of the height; click the picture to set the **focal point** (the
  part that stays in view).
- **Colours**: the primary colours the page, the buttons, the pills and the tiles. The page tells you the contrast of each pairing, says
  "adjusted for readability" (with before and after, and an **Auto-fix**) when a light primary had to be darkened, and warns, without
  stopping you, about a red that could be mistaken for a wrong answer, a very light or dark primary, and an accent that will not show.
  The accent is decoration only (a thin rule, a ring on the plate); it never colours a button.
- **Safari on an iPad cannot make WebP**, so a *photograph* used as a hero or logo may be refused there as too detailed for its limit (the
  message says so). Prepare pictures on a computer, or use flat artwork.

**Check it**

1. **The preview** on the right (below the controls on a narrow screen) draws the real screens, from your unsaved changes: choose the device
   (iPhone 390 × 844, iPad portrait 820 × 1180, iPad landscape 1180 × 820, desktop 1440 × 900) and the screen (Welcome, Activities, Question,
   Correct answer, Finale). It is read-only.
2. **On a real iPad before Go live**: Save, then under the preview copy the *Check it on a real iPad* address, or show its QR code, and open
   it on the iPad. It is `index.html?preview=<client>`: that client's Welcome and read-only activities, marked **Preview**, even though the
   client is not live, and it saves nothing. Look at it in both orientations, with the ringer switch as you will have it.
3. **Save.** If someone else saved the same client's look while you had it open you are asked before yours replaces theirs.

**What participants see after a Save.** A participant page that is **already open keeps the old look until it is reloaded**; a page opened
or reloaded after the Save shows the new one. Nothing is pushed to open pages (and going live again would also send everyone back to
Welcome, so do not do that during an event). The Live display and the exports use the saved colours.

**Replacing or removing a picture** uses a new file name each time (`<slug>-<slot>-<hash>`), so the old file is never shown by mistake, and the
old file is removed once the new one is saved (on SharePoint it goes to the site's recycle bin). **Leaving with unsaved changes** asks first.

## 8. Touch target audit (console snippet)

Every button, link, dropdown, checkbox/radio and switch should be at least 44×44 pt. To check a
screen, run this in the Safari/desktop console with the responsive viewport at 820×1180, on each
screen and each open dialog. It prints the controls that are too small; an empty list is a pass.

```js
(() => {
  const sel = 'button, a[href], select, textarea, summary, [role=tab], input:not([type=hidden]):not([type=file]), label.option, label.choice, label.switch';
  const small = [];
  for (const e of document.querySelectorAll(sel)) {
    const t = e.matches('input[type=radio],input[type=checkbox]') ? e.closest('label') || e : e;
    const r = t.getBoundingClientRect();
    if (r.width && r.height && (r.width < 44 || r.height < 44))
      small.push(`${t.tagName}.${t.className} [${(t.textContent || '').trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return small;
})();
```

Last audited with the seeded data: Welcome, Agenda, all four quiz/feedback sections, Master results, and every
admin tab and dialog (Today live, not live and with blockers, the switch confirmation, Clients and its form, Guests and QR with its
print view, Results, Content with its editor and the add and copy dialogs) at 390, 820 and 1440 wide pass in the current browser harness
(`admin-today.spec.ts`, `admin-content.spec.ts`, `admin-guests.spec.ts`). Physical iPad Safari, screen-reader
behavior, orientation and safe-area checks still require the target devices. Ranked-voting, multi-select and the
Thank you screen may not be in every local seed; run the snippet on them when those screens are available.

### Phase 5 (admin Today and Clients): not verified against real SharePoint

16. **A `$batch` of the 12 lists' `/fields`** (13 until Phase 10c-2a; the readiness row "SharePoint lists"). The Setup page reads them one by one; Today sends one batch (12 lists with 50 or more fields each, a large reply). If the site refuses it the screen still loads, one read per list (24 requests instead of 4), and the Setup self-test's batch step is the way to find out.
17. That a user who can open the admin page may read `/fields` of every list. If not, the row is a warning ("the lists could not be checked") and never a blocker.
18. The request counts: Today loads in 4 requests (5 from the PIN, which reads AdminUsers), a poll is 1, Go live is 12 for a client's first session of the day (8 for the same client and date again). Measured against the mock, not the tenant, where a 429 or a slow `$batch` would change them.
19. That a participant page agrees on the 10-second refresh while an iPad sleeps: the confirmation says a hidden page checks as soon as it comes back; proven from the source and with a page left open, not on a real iPad that was locked.
20. Two admins on two machines pressing Go live in the same second: one session and one AppSettings item on the real lists (proven with the mock, which enforces a unique `AppId` the way the real list must; Setup's self-test checks that).

### Phase 5b (Content by client, copying, guests and printing): not verified against real SharePoint

21. **Bulk writes.** A copy writes 3 records at a time with 120 ms between one lane's writes (a copy of two activities is 32 records and 43 requests against the mock, about 1.3 s; Generate all codes for 12 guests is 18 requests). Whether the tenant throttles that, and how it answers (`Retry-After` on a 429 is honoured by the adapter, proven only against the mock), is not known.
22. **The columns the new screens write**: `Sections.ClientId`, `Sections.Order`, `Sections.Description`, `Questions.Layout`, `Options.ImageUrl` (thirteen from Phase 4, nothing new). A list that lacks `Layout` or `ImageUrl` refuses a write that carries it, naming the column; the screen only sends them when a question uses tiles or an option has a picture. `Options.ImageUrl` is a single line of text, so an address over 255 characters is refused by the screen.
23. **Read filters of 20 ids**: `$filter=AppId eq 'a' or AppId eq 'b' ...` (questions) and `QuestionId eq ...` (options), 20 to a read, inside a `$batch` part. The address length inside a batch part against the real endpoint is the open question.
24. **Copy ids**: a copy's ids are `<source id>~<client id>` (so copying twice meets the first copy). Whether a unique indexed `AppId` text column accepts `~` is expected, not observed.
25. **A copy that fails** is undone by deleting what it wrote (`DELETE` with `If-Match`); proven with injected 503s against the mock and the local server. A delete that itself fails leaves records nothing refers to, which a re-run writes over.
26. **Printing**: the sheet is checked by DOM geometry in Chromium and WebKit with print media, and by the PDF Chromium makes at A4 and Letter (12 cards on the first page, 3 pages for 25 cards). Not checked: iPadOS Safari's print sheet and "Save as PDF", a physical printer, whether the browser's own margins and headers shrink the page, and whether the QR codes (32 mm) scan reliably from a real print with the iPads' cameras. Scan one before handing cards out.
27. **CSV download and `window.print()`** from iPad Safari (a Blob download with the `download` attribute, iOS 13 and later).
28. **Preview in a client's colours**: the client's palette is set as custom properties on the preview frame, which the shadow root inherits; proven in Chromium, not in iPadOS Safari.

### Phase 6 (Brand Studio): not verified against real SharePoint, or on a real iPad

29. **Uploads to ClientLogos.** `Files/add(url='<name>',overwrite=true)` into the library's root folder (`/RootFolder`), one file per picture, flat names, with the page's own sign-in. Proven only against the mock. Open questions: that the user who can open the admin page may add and recycle files in `ClientLogos`; that the library's root folder is the folder to use (a library with a subfolder convention would need `ServerRelativeUrl` changed in one place); that `overwrite=true` is allowed (the same name is always the same bytes); that a file `recycle()` is allowed and goes to the Recycle Bin.
30. **Participants can read the files.** A participant's page shows the hero, logo and background as `<img>` of an address on the same site, with the page's own sign-in. Proven in a browser against the mock, which serves the library. Not known: that every account that opens `index.html` (firm iPads signed in, visitors on a firm iPad) can read `ClientLogos`. Check with the real participant account, on an iPad, after the first upload: if a picture does not appear, the fallbacks show (the plate, the name in type, the gradient) and the page works, but the look is wrong.
31. **Response headers and caching.** A hashed name never changes content, but the library decides its own `Cache-Control`. Not observed: whether Safari re-fetches a file on every Welcome (it is at most 300 KB).
32. **Content types and the browser's own rules.** SharePoint serving a `.webp` as `image/webp` (and a `blob:` preview in the admin page under the site's content security policy) is expected, not observed. SVG upload is disabled in the page and in the adapter.
33. **Request counts** (mock): the Clients tab loads in 3 requests from the PIN and **opening Brand Studio costs none** (the client is already on the page; the preview needs no data). A Save with a colour change is 5 requests (7 for the first write on a page, which also reads the list's columns): one read of the client, then the write. A Save with one new picture is 5 as well (the library folder is asked once per page, then the file, then the client); replacing a picture adds the removal of the old file (1). Not measured against throttling.
34. **The `?preview=<clientId>` page on the tenant**: it reads the client and its activities (2 requests plus the page's own). Not run on a real iPad.
35. **Real iPad Safari**: the Crop and fit gestures (one finger to move, two to pinch, the zoom slider, the file picker offering Photos and Files), EXIF orientation of a photo from the camera roll (proven for a synthetic rotated JPEG in WebKit, not for a real HEIC-converted photo), the canvas limit for a very large input (a 10 MB phone photo of 12 megapixels), the look of the preview frame, and the **Check it on a real iPad** QR code scanned with the iPad camera. WebKit in Playwright is the same engine, not the same hardware.
36. **Fonts in the preview**: the preview frame uses the admin page's three Open Sans weights plus three more loaded when Brand Studio opens (all inside the admin page; there is no separate font file on SharePoint). Proven in Chromium and WebKit, not on an iPad.
37. **Legacy rollback.** Brand Studio writes `Clients.PrimaryColor`, `SecondaryColor` and `LogoUrl` from the theme on every save so the legacy pages keep working; the legacy pages ignore `ThemeJson`, so a client's hero, plate and background are not seen there. Nothing was run against the legacy build beyond the existing suites.

### Phase 7 (budgets, polling, the Live display, End session): not verified against real SharePoint, or on a real iPad

38. **A `$batch` of AppSettings, the session, the track and the activities, on every look.** One participant look is ONE request (4 parts on the hub, 3
    elsewhere); the Live display's refresh is one request of 4 parts. Proven against the mock, which batches. Not known: that a participant account may
    read those four lists through `$batch` (it reads them one by one today), and, above all, **whether SharePoint's throttling counts a batch as one request
    or one per part**. If it counts parts, a waiting iPad is 9 to 12 resource units a minute (not 3), ten of them on one account about 2% to 4% of the 3,000
    in five minutes, still well inside; the Live display would be about 20 a minute. Watch the throttling headers on the test site during a ten-iPad rehearsal.
39. **The measured numbers are the mock's.** Ten iPads idle for five minutes: 138 requests (4.6% of 3,000); a waiting page 2.8 to 3 a minute; a page on a
    question 0.8; the Live display 5.6; Results 4.6; Today 6; Content 4; Guests and QR 4 (`test-results/budget/*.json`).
40. **Timers on a real iPad.** A dimmed or locked iPad pauses page timers and fires none: the page checks once when it is woken (`visibilitychange`), which
    was proven by faking a hidden tab, not on a sleeping iPad. So an iPad left on a desk with the screen off learns of an End session when it wakes.
41. **End session on real devices**: Welcome and the hub within about 25 seconds (jitter included), a question on screen up to about 72 seconds, answers still saving
    after the end, Reopen bringing the hub back, a reloaded page showing the same words. Proven with the mock and Playwright's clock in Chromium (and the words in WebKit).
42. **The admin page is about 601 KB gzip, 1.66 MB raw (554 KB, 1.58 MB when this was written; its budget has been 700 KB since Phase 7c).** It carries jsPDF, PptxGenJS and Chart.js (all in the one file, because a standalone page has nowhere else to
    fetch them from). Not measured: its load and parse time on an iPad over the venue's network. The participant page is 153 KB gzip.
43. **Full screen on an iPad**: the cover works (proven in Chromium and WebKit); the browser's own Fullscreen API on an element is not offered by every iPad Safari.
    Not checked on a real projector or over AirPlay: legibility from the back of a room, the idle fade of the pointer, Escape from a keyboard on an iPad.
44. **Exports on iPad Safari**: CSV, PDF and PowerPoint are Blob downloads (iOS 13 and later), proven in Chromium and WebKit on a Mac. jsPDF's HTML and SVG paths are
    left out of the admin build (nothing uses them: `scripts/test-bundle-budget.js` fails if an export starts to); a PDF made in WebKit has its client name and creator.
45. **Results on SharePoint** reads every session in full (6 requests each) when it opens and on Refresh, which grows with the number of sessions the site has
    ever had; only the live session is refreshed by the timer. Not tested with a site that has hundreds of sessions.

### Phase 7b (leader report and participant CSV): not verified against real SharePoint, or on a real iPad

46. **The two downloads on a real iPad.** *Leader report (PDF)* and *Participant answers (CSV)* are Blob downloads with the `download`
    attribute, as the Live display's exports are (iOS 13 and later). Proven in Chromium and in Playwright's WebKit on a Mac
    (`leader-report.spec.ts`), where both files arrive and the PDF reads back with its fonts embedded. Not checked on an iPad: that Safari
    shows its download prompt for each, that the PDF opens in Files and in the Books and Preview viewers with Open Sans (not a substitute
    face) and the accented names right, that the CSV opens in Excel or Numbers for iPad with the accents right, and that *Share* →
    *Print* prints the report at full size. Do it once, with a session that has a name such as Łukasz in it.
47. **The time on an iPad.** Sixty people and fifteen questions made a 38-page report in 0.30 s in Chromium and 0.34 s in WebKit on a
    Mac (0.33 s and 0.38 s from the click to the file, the local server's reads included), against a limit of ten seconds. An iPad is
    slower and the reads go to SharePoint, not to a server on the same machine; neither was measured.
48. **The reads on SharePoint.** Four requests (five when an answer points at a question outside the session's activities): the session;
    one `$batch` of the session's activities, its client, its tracks, its visit log and its guest roster; one `$batch` of the questions
    and options; the answers, 200 to a page. Counted against the mock. Not known on the tenant: that the admin's account may read
    `UserVisitLogs` and `VisitorRoster` through `$batch` (Guests and QR already reads both that way), and how long the four take.
49. **Names on the real site.** A staff participant's name is the SharePoint display name that the participant page wrote to
    `PMSVisitLog` (`SignedInName`; `UserVisitLogs.DisplayName` until schema version 3, Phase 10i) for that account. Locally there is no sign-in, so every staff visit in a local test is "Unnamed
    participant N"; the path through the visit log is proven with the mock and with made-up rows, not with a real sign-in. If several
    iPads share one signed-in account, every one of their visits carries that account's name (as "Name", "Name (2)", ...).
50. **A logo from ClientLogos in the PDF.** The page draws the logo on a canvas to turn it into a PNG. Proven with a logo served by the
    local server. On the tenant the file is on the same site, so the canvas should be readable; if SharePoint serves it in a way the
    canvas may not read, the report is made without the logo (the client's name is on the cover either way) and the browser console says so.
51. **Paper.** The pages are A4. Printed on US Letter with "fit to page" they shrink by about 6%; nothing was printed on paper here, in
    colour or in greyscale, and the pictures in `test-results/report/` were looked at on a screen.
52. **Characters outside the font.** The embedded faces cover Latin, Latin-1 and Latin Extended-A. Anything else (an emoji, Greek,
    Cyrillic, Chinese, Arabic) prints as one replacement mark, the notes on the last page say so, and the CSV keeps the text. A name in one of those
    scripts would be unreadable in the PDF. No such name was in any test but the one that checks the mark.

### Phase 7c (polish from the 7b review): not verified against real SharePoint, on a real projector, or on a real iPad

53. **The Live display on a real projector or TV.** Proven in Chromium (all four sizes, every question) and, for one size and the arrow keys, in
    Playwright's WebKit: the whole card inside the window at 1920x1080, 1366x768, 1280x720 and 1024x768, nothing scrolling. Not checked: a real
    projector or TV (over HDMI, AirPlay or a Chromecast), where the window's size is not always the screen's; overscan that crops the edges (the
    card has a margin of 1 to 2 rem, which a cropping TV may eat); the type from the back of a room; the pointer and the controls fading on a
    screen you cannot touch; Previous, Next and the arrow keys from a presenter's clicker (some send Page Up and Page Down, which do nothing here: the
    arrows are what was asked for); and Auto-advance left running for a whole session on a device that may sleep.
54. **The Live display on an iPad.** Full screen is the page's own cover (iPad Safari does not offer the Fullscreen API for every element). Not
    checked on a real iPad: that the card fits with Safari's address bar and tab bar showing (`100%` of the visual viewport), that the controls are
    easy targets (they are 44 px or more), and rotation with the display open (the card is sized again on a resize: tested by resizing the window).
55. **The leader report on an iPad.** The new page order (the summary first, the counting rules last) is proven by tests and by looking at the
    pictures in `test-results/report/` (`*-cover.png`, `*-last.png`, `*-participants.png` for the light, dark and sixty fixtures). Not checked: how it
    reads on an iPad's screen in Files, Books or Preview (is page 1 enough for a leader? does the last page get found?), or in a print.
56. **What moved off the cover (answered in Phase 8).** The session line and the notes were moved to the last page in 7c; page 1 now also says, in one line under
    "Made on", "This session had ended when the report was made." or, in bold, "This session had not ended when the report was made, so answers may still arrive."
    (the full "Session: ..." line, with the time it ended, and the notes are still on the last page). Proven by tests and by the pictures
    `test-results/report/not-ended-cover.png` and `ended-cover.png`. Not checked: how it reads on an iPad in Files, Books or Preview, or in a print.
57. **Names on the Results screen on the real site.** The screen now reads the session's visit log and roster (one `$batch` of two lists, only for a
    session with a visit that has no name of its own) and looks again, on the live session's timer, for a person who joined in the last two minutes and
    is still unnamed (twice at most). Counted against the mock: +1 request when Results opens, and one more on the first refresh that finds a new
    nameless person. Not known on the tenant: that the admin's account may read both lists (the leader report and Guests already do), how long the
    sign-in of a staff iPad takes to be written (the screen assumes seconds), or that staff names appear as the report shows them.
58. **The 700 KB budget.** Raised from 600 KB (see AGENTS.md). Nothing was dropped. Not measured: the admin page's load and parse time on an iPad.

### Phase 9a (the independent review's fixes): not verified against real SharePoint, or on a real device

The findings, what was fixed, what is open and what needs a decision are in `REVIEW-9A.md` (in git history at `7347c72`). Automated:
`npm test` (it now runs `scripts/test-oracle.js` and `scripts/test-review-9a.js`), `npm run oracle -- --seeds 500`,
`npm run test:report:mutations` (30), `npm run test:migration`. On the test site and a real iPad:

69. **Staff mode, two iPads on ONE sign-in, the plain link** (DI-1, not fixed: a decision). Begin on the first, answer a question;
    open the link on the second. **Expect today:** the second iPad's main button says "Activities" (or "Click here to begin") and
    opens the FIRST iPad's visit. Do not run an event this way: use one sign-in per person, or guest mode with personal QR codes.
70. **"Click here to begin" with Sessions read-only for the participant account** (DI-3). **Expect:** the visit starts; the
    session stays "not started" in the list and nothing else is affected. Press the button twice quickly on a slow connection:
    one visit in Results, not two.
71. **A QR scan cut off in the middle** (DI-4): scan a guest code, turn Wi-Fi off the moment the page appears, wait for "We can't
    reach the server", turn Wi-Fi on and scan the code again from the camera. **Expect:** one visit for that guest in Results.
72. **An expired sign-in** (FH-1): leave a participant page open until the sign-in runs out (or sign out in another tab).
    **Expect:** within about a minute a banner "Your sign-in has expired. Reload this page to sign in again. Your answers are
    kept on this device." Reload, sign in. **Expect:** back on the same visit, and an answer given while signed out is saved.
    Write down what SharePoint really answers (a page, a redirect, a 401) if it does not show.
73. **Answers left unsent** (FH-2): on the last question turn Wi-Fi off, press Submit, wait for "Couldn't save", turn Wi-Fi on and
    touch nothing. **Expect:** within about a minute the answers are in Results.
74. **The wrong address** (FH-3): open `index.html` and `admin.html` through any other host name the site answers to.
    **Expect (since Phase 10b):** the page works there as it does at its usual address when that folder has its `pms-config.txt` (a page is no longer built
    for one address: any `https` address is SharePoint), and "This page cannot start" with `Details: PMS-CFG-001` when it has none; never "isn't live yet"
    from a page that fell back to a local server. (Phase 9a to 9c pages said "This page is not set up for https://..." here.)
75. **The hub or an activity failing to load** (FH-4): Wi-Fi off, open an activity. **Expect:** "Can't reach the server. Check the
    connection, then try again."; Wi-Fi on, "Try again" opens it without the page reloading.
76. **A tile picture** (DI-7): duplicate an activity that has picture tiles, replace a picture in the original, save. **Expect:**
    the duplicate still shows the old picture. Paste a broken picture address into an option: **expect** the tile to show its words.
77. **A ranking question with an option removed after answers** (RES-1): the Live display, Results, the exports and the leader
    report give the remaining options the same points and order.
78. **Long addresses** (not a fix, a question for the tenant): open Results and make each export for a session with at least 15
    questions of four options. If it fails with a 400 or 414, the address was too long (REVIEW-9A.md, "Could not be checked", in git history at `7347c72`).
79. **Unscanned codes are retired**: with unscanned guest codes outstanding, End session, and Go live with another client.
    **Expect:** no error, and the unscanned codes show as expired. (Phase 9a asked this because the app filtered on `Used eq 'false'`. Since
    Phase 10c-2a it does not: it reads the session's codes and tests `Used` itself. The fuller check is item 103.)

### Phase 9b (the decided fixes from the review): not verified against real SharePoint, or on a real iPad

What was decided and done is in `REVIEW-9A.md` (each finding's status; in git history at `7347c72`) and MIGRATION-PLAN.md, "Phase 9b". Automated:
`npm test` (`scripts/test-review-9b.js` and more tests in the files named there), `npm run oracle -- --seeds 500` (it now damages answer items at
random), `npm run test:migration` (`review-9b.spec.ts`, `review-9b-setup.spec.ts` and the specs that changed). All of it ran against the local server
and the mocked SharePoint REST. On the test site and a real iPad:

80. **The staff-mode warning** (DI-1). Today, with a staff-mode session live: **expect** "Staff mode: every person needs their own sign-in. iPads that share
    one sign-in must use Guests scan a personal QR, or two people's answers will be mixed." under "How people are identified" and as a warning in the readiness
    list; Go live is still allowed. Switch to Guests scan a personal QR: **expect** both gone. (The code that picks "the visit this account already has" is
    unchanged: two iPads on one sign-in in staff mode still meet each other's visit, item 69.)
81. **The preview address** (SEC-1). Open `index.html?preview=<a client id>` on an iPad: **expect** the questions and options in the client's look and **no**
    option marked right. The Content tab's Preview (behind the PIN) still marks them. Then try **Guided Access** (Settings, Accessibility, Guided Access; triple-click
    the side button on the participant page) or, if the device team manages the iPads, a single-app mode profile: **expect** that no address can be typed. Note
    what is still readable through SharePoint's own addresses with the iPad's account (SHAREPOINT-DEPLOYMENT.md, "Permissions and limits").
82. **A damaged answer item** (DI-6). In the Responses list change one participant item's `ResponsesJson` to `{oops` (a test visit only). **Expect:** Results shows
    "1 participant's answers could not be read and are not counted: <name or visit id>. Correct or delete the damaged item in the Responses list, then reload." beside
    its export buttons, that visit says "Answers unreadable" and cannot be restarted, the others are counted; the same sentence is at the top of the Live display and,
    in bold, on the cover of the leader report (PDF) under the line about the session having ended; the CSV has no extra row. That participant's own page says
    "We can't open your saved answers". Put `[]` back: reload Results and all of it is gone. Also try `7` and `null` as the text. (Since Phase 10c-2a nothing reads or writes
    an item whose AppId is the session's id: item 102.) Write down anything SharePoint does to the text (a rich-text column, a changed quote) that the mock does not.
83. **Removing a visit with no answers** (DI-9). In Results a visit that says "Not started" has **Remove...**; others do not. **Expect** the question "Remove this visit? It has
    no answers. If it was made by a guest's code, that code stays used: issue a replacement code if the guest needs to start again." and, on yes, the visit gone from Results
    and from the report. Give a guest's visit an answer from the iPad just before pressing Yes: **expect** "This visit now has answers, so it was not removed." An ended session
    has no Remove. The guest's page that held the removed visit says "This visit is no longer on record. Ask your facilitator for a new code."; a staff page says to press the
    button below to start again. Check in Guests and QR that the guest's old code still reads "Scanned" and the roster is unchanged, then issue a replacement.
84. **Kroger and Domino's** (SAM-1, SAM-2). On a site seeded before Phase 9b: **expect** Kroger's name in type on Welcome (not a blue box), no picture in the Clients list or the
    Live display, and the readiness warning "has no logo or hero image"; **expect** "Sample content: confirm with the client team before real use" on both clients in Clients and
    in Content. Press **Mark as confirmed** on one: **expect** "Confirmed by <admin name> (<SharePoint account>) on <date>." and that the notice is gone after a reload; look at that
    client's `ThemeJson` in the Clients list: it holds `"sample": { ..., "confirmedBy", "confirmedAt" }` and the rest is as it was. Make the leader report before and after: the cover
    carries "Sample content, not yet confirmed with the client." only before. Upload a real logo in Brand Studio: **expect** it replaces the name in type, and no sample line returns.
    Not known on the tenant: that Seed sample clients writes the marker as the mock shows (the seeds are stored the same way as any client's theme).
85. **Please check by eye** (DEP-1). Setup, **Check Lists**: **expect** every row Ready on a correctly built site and, under "Please check by eye", only lines that are true.
    For each line, look at that column in the list's settings and say whether SharePoint's own description agrees with the line. Make one of them wrong on purpose on the test
    site (Enabled as text, an index removed from Tracks.SessionId) and check the line appears and Go live is still allowed. Write down how SharePoint names a Choice, a Yes/No and a
    Number column in the REST answer (`TypeAsString`), and whether it says Order0 for a column you made called Order.
86. **Short addresses** (G). A session with 60 questions of four options: open Results, the Live display and each export; open the participant page on an activity of 30
    questions. **Expect** all of it to load. Before Phase 9b the Results screen would have asked for every option in one address of about 9,600 characters.
87. **The two probes** (G). Run **Run self-test** (test site only). **Expect** two extra rows, "Probe (read-only): a Yes/No filter on QRTokens.Used, written three ways" and
    "Probe (read-only): how long a $filter this site accepts". Write down what each says: which of `eq 'false'`, `eq 0` and `eq false` the site accepts, and the longest filter it answered. Since Phase 10c-2a
    the app does not filter on a Yes/No column, so nothing depends on the first answer: it is kept for whoever defines the next lists.

### Phase 10b (deployment settings and the list namespace): not verified against real SharePoint, or on a real device

What changed is in MIGRATION-PLAN.md, "Phase 10b", and SHAREPOINT-DEPLOYMENT.md, "Which site and which lists: `pms-config.txt`". Automated:
`npm test` (`scripts/test-deploy-settings.js`, `test-settings-file.js`, `test-list-namespace.js`, `test-request-baseline.js`, `test-setup-deployment.js`,
`test-site-override.js`), and `npm run test:migration` (`settings-file.spec.ts`, `setup-deployment.spec.ts`, `request-baseline.spec.ts` and the specs that
changed). All of it ran against the local server and a mocked SharePoint REST that holds two sets of lists. **None of it has met the real site**: every item
below is something only the site can show. Use a scratch folder and the scratch package (`build-svelte/package/scratch-10b-<hash>/`, with its `NOTES.txt`),
and until Phase 10c has made the `PMS3...` lists, **open Setup only and change nothing**.

88. **The settings file is served and read.** Upload the three pages and `pms-config.txt` (`{"configVersion":1,"listPrefix":"PMS3","label":"Test, folder 3"}`)
    to the scratch folder and open `setup.html`. **Expect** the panel "This copy of the app" with: Opened from (the folder), Site (the site's address, "from this
    page's address"), Lists "PMS3Clients, PMS3Sessions, ... (12)" with `prefix "PMS3" from pms-config.txt`, Picture library "PMS3ClientLogos (default for this
    prefix)", Grouped reads "on (default)", Label "Test, folder 3 (from pms-config.txt)", and a Build line. If instead it says the settings file "could not be
    used", read the Details line: `page` means SharePoint sent a web page where the file should be (a sign-in page, or an error page such as "File Not Found"
    for a file the site will not hand out); `status 403` or `404` handling is items 89 and 90. **Answered on the first real site (14 Oct 2026, see "Phase 10g"):** that
    library did not hand a `.json` file to a page, and did hand a `.txt` file; the file is therefore `pms-config.txt` since Phase 10g (its content is still JSON, and the page
    reads it whatever the content type).
89. **A missing file is "not found", and nothing else.** Rename `pms-config.txt` in the folder and reload `setup.html`. **Expect** "This copy of the app has
    not been set up yet" (`PMS-CFG-001`), the two ways to put it right, and every button below switched off. Then open `index.html` and `admin.html`:
    **expect** "This page cannot start" with `Details: PMS-CFG-001` and **Try again**, and no PIN screen. If the Details say `PMS-CFG-002 page 200` or `status ...`
    instead, SharePoint did not answer a plain 404 for a missing file (some sites answer with a "not found" page and status 200, or a redirect): the page then
    stops, which is the safe side, but it will not fall back to values built into the pages on that site. Tell the developer what the line says. Put the file back.
90. **A signed-out browser.** In a private window that is not signed in, open `index.html` in the scratch folder. **Expect** the site's own sign-in, or
    "This page cannot start" with `PMS-CFG-002 page 200`, `status 401`, `status 403` or `unreachable`; **never** a page that carries on. After signing in, **Try again**
    (or a reload) starts the page.
91. **A file with a mistake.** Edit the file in SharePoint to `{"configVersion":1,"listPrefx":"PMS3"}` (a typo) and reload Setup. **Expect** `PMS-CFG-002`,
    with `"listPrefx" is not a setting this app knows.` Also try `"listPrefix": "PMS 3"`, a trailing comma, and a `siteUrl` of another site (`PMS-CFG-004`).
    Does SharePoint's editor add anything to the file (a byte-order mark is read; anything else would show as `json`)? Put the file right again.
92. **The list rows and the probe** ("Where the lists are", Setup). Press **Read where the lists are**. It only reads. Before Phase 10c, on a new prefix:
    **expect** every row "There is no list with this title." and the probe "Not asked". **On a folder whose settings say `"listPrefix": ""` (read-only, and only
    with the site owner's agreement)** the rows show production's lists: for each, the address SharePoint reports and its id. **Send a picture of the rows to
    the developer.** A row that says "At another address than its title suggests" is a list that was created under another name and renamed; the probe's line
    says whether asking by that address returns the same list. Whether `web/GetList` answers at all on this tenant, and whether `$expand=RootFolder` is allowed,
    are not known: a row that says "Could not be read (...)" answers that.
93. **One more request on every load.** The file is a small static file, asked for once per page load before anything else (never while a page is open).
    With ten iPads opening the participant page together, watch for a slow first screen or a 429 on the file (the page would stop with `PMS-CFG-002 status 429`
    and **Try again** would recover it). Whether SharePoint counts a file download toward the same throttling as list requests is not known.
94. **Two copies on one site.** Only after Phase 10c has made the `PMS3...` lists: with a session live in production (`p_cec_01`), press Go live in the scratch
    copy. **Expect** production's participants to see no change, and the scratch copy's `PMS3AppSettings` to hold the new session. This is the whole point of the
    prefix, and it has only been shown on the mocked site.
95. **The label.** Sign in to `admin.html` in the scratch folder. **Expect** "Test, folder 3" in the navy bar beside the product name, at 390 px wide too, and
    nothing in production's admin bar (its pages have no settings file).
96. **The legacy pages.** `p_cec_01`'s legacy pages bundle the same data layer, which gained code in this phase (their bytes changed; their requests did not, by
    the request baseline). If the legacy build is ever uploaded again, run its usual checks (QA sections 1 to 9): nothing in it reads `pms-config.txt`.
    (Since Phase 10c-1 the legacy build can be made only from the tag `legacy-final`, never from this branch.)

### Fix: assigning activities proves what it did (not verified against real SharePoint)

**Items 97 and 98 are retired (Phase 10c-2a).** They checked "Assign selected to client..." against the real `Sections` list. The Unassigned group, both assign
buttons, Setup's assign step and `npm run test:assign` are gone: on the new site every activity is made for a client (Add activity, Copy from another client,
Duplicate, the sample seed). The numbers are not used again. What the fix was is still in MIGRATION-PLAN.md, "Fix (2026-10-13)".

### Phase 10c-1 (the clean break): not verified outside this Mac, the mocked SharePoint and the local server

What changed is in `CLEAN-BREAK-10C1.md` (in git history at `7347c72`) and MIGRATION-PLAN.md, "Phase 10c-1". The phase removed
the legacy app and changed no behaviour of the new pages; the request baselines are the evidence for that, on the mock. **None of it has met the real site or a real
device, and the new site has not been touched.**

99. **`npm install` on a clean copy.** The `postinstall` script is gone (it copied libraries into `public/vendor/` for the legacy pages). It was **not** run on the
    development Mac, where `npm install` removes hand-restored binaries. On a fresh clone: `npm install`, then `npm test` and `npm run build:svelte:release`.
    **Expect** no script to run during the install, 894 tests to pass (914 when Phase 10c-1 ended; Phase 10c-2a removed tests with what they tested), and three files in `build-svelte/release/`.
100. **The PIN after the move.** The admin's PIN check moved from the legacy admin folder into `migration/src/lib/admin-pin.js` with its code unchanged. On the test
    site, unlock the admin with the PIN that worked before. **Expect** it to unlock, and a wrong PIN to be refused as before. On a plain-`http` address (a LAN
    address in local development) the pure-JavaScript SHA-256 is used instead of the browser's: check there once too.
101. **Local development without the legacy pages.** `npm run dev` now serves no page. Start `npm run dev:svelte`, `dev:svelte:admin` and `dev:svelte:setup` beside
    it and open ports 5173, 5175 and 5176. **Known gap:** the admin's participant link and QR codes on the local server point at port 3000, where the legacy
    participant page used to answer and nothing does now. Decide whether the local server should serve the built pages (three lines in `server/index.js`).

### Phase 10c-2a (what the new project no longer has): not verified outside this Mac, the mocked SharePoint and the local server

What changed is in `DROPS-10C2A.md` (in git history at `7347c72`) and MIGRATION-PLAN.md, "Phase 10c-2a". The phase took out what
existed only for the legacy app's data, and changed three queries. **None of it has met the real site or a real device.** Use a test site and scratch clients.

102. **No item for a session in the answers list.** With one participant who has answered, press **Restart** on Results (one activity, then "from the beginning").
    Open the `Responses` list (or its prefixed title) and sort by `AppId`. **Expect** one item for each participant (`AppId` and `TrackId` are the visit's id) and
    **no item whose `AppId` is the session's id** (`<slug>-<date>`). Before this phase a restart on SharePoint made an empty one (`ResponsesJson` = `[]`). The
    participant's page must go back to the start of that activity as before. With the network panel open, the first restart on a page was 9 requests on the mock
    (it was 14). On a list that still holds such an item from the older build: nothing reads it; say if Results, the Live display or the report mentions it.
103. **Codes are retired with no filter on the Yes/No column.** Make three guest codes and scan one. Then, one at a time: (a) disable an unscanned guest; (b) change
    "How people are identified"; (c) **End session**; (d) Reopen, make a code, and **Go live** with another client (and once through "All sessions" for an existing
    session). **Expect** each time: the unscanned codes show as expired, the scanned one stays used. In the network panel every read of `QRTokens` has
    `$filter=(SessionId eq '...')` (with `VisitorId` for (a)) and **none has `Used eq`**. **What only the site can show:** what the real list sends for `Used` on a
    code that was never scanned. The app takes `false` and "nothing" as unscanned and only `true` as scanned (the mock sends a real true or false). If the real
    list sends words ("Yes", "No", "0"), every code would count as scanned or none would: stop and tell the developer before an event.
104. **A session with more than 200 codes.** The read is 200 rows to a page. With a guest list of 250 and a code for each, End session. **Expect** all the
    unscanned codes expired, not only the first 200 (the next-page link is followed; proven on the mock for other lists).
105. **Tidying a replaced tile picture.** In Content, give an answer a tile picture with **Upload** and save. Duplicate the activity. On the original, upload
    another picture for that answer and save. **Expect** the first file still in the picture library (the duplicate shows it) and the duplicate's tile still showing
    it. Delete the duplicate, replace the picture once more and save: the file it replaced goes to the recycle bin. In the network panel, after each Save: one read
    of the activities, then one `$batch` of the answers by question, and **no address with `ImageUrl eq`**. On a site with 30 or more activities, say how long that
    `$batch` takes and whether it is refused: how many reads one batch may carry on this tenant is not known.
106. **Deleting a client, and the check-in code.** On Clients press **Delete** on (a) the live client: refused, and the words include "today's live session";
    (b) a client with an earlier session: refused ("a session, a client track, a QR token ..."); (c) a new client with nothing: it asks, then deletes. In the
    network panel (a) and (b) send two requests before the answers are read (one `$batch` of AppSettings and the client's sessions by `ClientId`; one of the visits
    and codes by `SessionId`, 15 sessions to a read) and **no read of `Tracks` or `QRTokens` without a filter**. Then **Generate QR** for the live client and
    **New code** twice: the list under the code shows this session's codes, newest first, six at most. **Changed on purpose:** codes of the client's earlier
    days are no longer in this dialog (they are counted on that day's card on Results).
107. **Twelve lists.** Setup, **Check Lists**: twelve rows, and none is `ThemeConfig`; "Where the lists are" has the twelve and the picture library. A site that
    still has a `ThemeConfig` list from the older build: nothing asks for it, and it can stay or be deleted. The Live display of a session whose client was
    deleted shows the built-in default colours, not the colours that list held.
108. **Nothing is live without a client named.** After the first **Go live** on the new site, open `AppSettings`: the item `default` holds both
    `ActiveSessionId` and `ActiveClientId`. (An item with a session and no client, which only the older build could leave, now reads as not live: Today says
    nothing is live and participants see "isn't live yet". Go live again puts it right.) An activity whose `ClientId` is empty is shown to nobody and no screen
    lists it: on the new site none can be made; if a list is filled by hand, give every activity its client's id.
109. **The self-test's sentence**, only if Run self-test (item 12) reports that `$batch` is refused: the row ends
    `(set "batch": false in pms-config.txt), and still works`. It used to name `public/config.js`, a file that no longer exists.

### Phase 10c-2b (one schema file, the PMS list names, schema v2): not verified outside this Mac, the mocked SharePoint and the local server

What changed is in `SCHEMA-10C2B.md` (in git history at `7347c72`); every list and column is in
[SHAREPOINT-LISTS.md](SHAREPOINT-LISTS.md). **None of it has met the real site.** These need the new site, with lists made exactly as SHAREPOINT-LISTS.md says
(by hand now; by Setup's Create from 10c-3).

110. **`SortOrder` keeps its name.** Create the Number column `SortOrder` on PMSActivities and PMSActivityQuestions (through the browser, and if you can, through
    REST as Setup will). Open `/_api/web/lists/getbytitle('PMSActivities')/fields?$filter=Title eq 'SortOrder'`: **Expect** `InternalName` `SortOrder`, not
    `SortOrder0` or an encoded name. Then reorder two activities in Content and read the items back: the new numbers are in `SortOrder`.
111. **The new titles are found.** On a page whose `pms-config.txt` says `"listPrefix": ""`: `/_api/web/lists/getbytitle('PMSActivities')` answers the list
    (not 404), and so does each of the other eleven and `PMSClientImages`. Setup's "Where the lists are" shows all thirteen found. With `"listPrefix": "Test"`
    the same for `TestPMSActivities` and the rest.
112. **A page opened before Setup has run.** On the new site before any list exists (or with PMSAppSettings empty): open `index.html`. **Expect** "This page
    cannot start" with `Details: PMS-LST-010`, and no further requests in the browser's network panel. Open `admin.html` and enter a PIN: the same screen
    with PMS-LST-010 (at the PIN when there are no lists; after Unlock when the lists exist without the item). Open `setup.html`: it opens, and says
    "This site's lists have not been set up for this app yet. ... Open Setup." Then put `SchemaVersion` 1 and 3 on the item by hand on the TEST site only:
    PMS-LST-011 and PMS-LST-012, and Setup's words for each.
113. **Dates shown as Date & Time read back as the same day.** Make every date column "Date & Time" (SessionDate included). On a site whose time zone is
    not UTC (try one west of UTC), go live for today: Today and Results show today's date, not yesterday's. Then, on the TEST site only, switch SessionDate
    to "Date Only": Setup's Check Lists says "Shows the date only: make it Date & Time." (that relies on SharePoint reporting `DisplayFormat` 0 for Date
    Only, which only the real site can show).
114. **What the real site reports for the strict check.** Run Check Lists on a site made exactly to SHAREPOINT-LISTS.md: every row Ready. In particular
    `AppId` reports `Required: true`, `Indexed: true`, `EnforceUniqueValues: true`; the eight columns of chosen words report `Text`; `ResumeCount`,
    `ThemeVersion`, `SortOrder` and `SchemaVersion` report `Number` (or `Integer`, which is accepted); and no other column reports `Required: true`.
115. **The indexes.** In each list's settings, Indexed columns: AppId everywhere, and only PMSClientSessions.ClientId, PMSActivities.ClientId,
    PMSAnswerOptions.QuestionId, PMSParticipants.SessionId and QrTokenId, PMSParticipantAnswers.SessionId and TrackId, PMSGuestQRCodes.SessionId and VisitorId,
    PMSGuestList.SessionId and PMSVisitLog.SessionId. A first QR scan (it filters PMSParticipants on SessionId and QrTokenId) still reaches Welcome in 8 requests.
116. **Yes/No defaults.** Add an item by hand to PMSGuestQRCodes, PMSActivities and PMSGuestList without touching Used or Enabled: each reads No.
117. **An answer text over 255 characters** (a known gap in 10c-2b; *fixed in Phase 10c-3, see item 131*): in Content, give an answer an option text of 300
    characters and save. Before 10c-3 SharePoint refused it in its own words; now the input stops at 255 and says so.

### Phase 10c-3 (Setup creates and completes the lists, and adds the first admin): not verified outside this Mac, the mocked SharePoint and the local server

What changed is in `PROVISION-10C3.md` (in git history at `7347c72`); the steps are SHAREPOINT-DEPLOYMENT.md, "Preparing a new
site". **Every point below is UNPROVEN: the fake answers as SharePoint is documented to, and nothing of Setup's Create has met a real site.** Run them on the new
site (or a test site first), with the browser's network panel open, and write down what the site said.

118. **May the signed-in account create lists?** Open Setup as the person who will deploy, press **Show the plan**, then **Create**. **Expect** either the summary
    "Created 13 lists, 89 columns and 47 settings in ... s (149 writes)." or, at the first write, "Your account cannot create lists on this site. A site owner must
    press Create, or create the lists by hand from SHAREPOINT-LISTS.md." with "Nothing was made before it stopped." (one refused write in the network panel). A
    site owner has Manage Lists; a member usually does not.
119. **Which column definitions SharePoint accepts.** Create sends `fields/createfieldasxml` with `Options` 25 (AddToDefaultContentType, AddFieldInternalNameHint,
    AddFieldToDefaultView) and one of five definitions: `<Field Type="Text" ... MaxLength="255" />`, `<Field Type="Note" ... RichText="FALSE" AppendOnly="FALSE"
    NumLines="6" />`, `<Field Type="Number" ... />`, `<Field Type="DateTime" ... Format="DateTime" />`, `<Field Type="Boolean" ...><Default>0</Default></Field>`
    (each with `Name`, `StaticName` and `DisplayName` the internal name, and `Required="TRUE"` on AppId alone; the plan's Technical details show every one).
    **Expect** each accepted. If one is refused, Create stops and names it: note the column and SharePoint's words.
120. **Is the internal name honoured?** After Create, `/_api/web/lists/getbytitle('PMSActivities')/fields?$select=InternalName,Title,TypeAsString` and the same
    for every list: every column's `InternalName` is exactly its name in SHAREPOINT-LISTS.md (above all `SortOrder`, `Name` on PMSClients and PMSAdminUsers,
    `Status`). Create reads each column back as soon as it is made and stops on a difference ("SharePoint made the column ... with the internal name ...0"): if
    it stops, note which.
121. **Index and uniqueness in one step, or not.** Create sets the index and then uniqueness, each its own MERGE, never together and never at creation, on an empty
    list. **Expect** both accepted on AppId of all twelve lists. On the TEST site only, out of interest: a MERGE that sets both at once on a new empty column,
    and one that sets uniqueness on a column with no index; note what SharePoint answers (the fake refuses both, behind an option).
122. **The wording and status of a refusal.** As an account without Manage Lists: the status SharePoint gives (403 expected) and its words, from the "Technical:"
    line under Create. The same for **Mark the site as ready** with an account that may not edit PMSAppSettings ("Not marked ready: your account cannot change
    PMSAppSettings ...").
123. **How long a full Create takes, and whether it is throttled.** The summary line gives the time and the number of writes (6.6 s for 149 writes on the fake,
    three lists at a time, 120 ms between one list's writes, plus 89 reads back). Note the real time, and any 429 or 503 (with `Retry-After`) in the network
    panel: the data layer waits them out, up to 30 s, before a write is counted as failed.
124. **A new list's default settings.** After Create, open each list's settings: Attachments off, Content approval off, and Versioning as SharePoint made it, or
    off on PMSParticipants, PMSParticipantAnswers, PMSGuestQRCodes and PMSVisitLog when "Turn off version history" was ticked. Note what SharePoint gave a new
    list before Setup's settings step (on the TEST site, make one list with Create stopped after step 1 by closing the tab, and look): attachments and version
    history on are expected. Each list's description ends "Made by Setup." (or "...its settings are not made yet." until its settings are made).
125. **A hand-built list passes the strict check.** On VJR's hand-built lists: **Show the plan** says "Nothing to create" (or names exactly what is missing, and
    under "Setup will not touch" anything made differently, with its fix), **Check Lists** shows twelve rows Ready, and **Mark the site as ready** writes the
    version. In particular PMSActivities' built-in Title, required as SharePoint makes it, is not reported; note what `Required` the real Title reports.
126. **The version item, and the pages before and after.** Before Mark the site as ready: `index.html` shows "This page cannot start" with `PMS-LST-010`. After
    it: PMSAppSettings holds one item, Title `default`, AppId `default`, SchemaVersion 2, the other columns empty; `index.html` says the experience is not live
    yet; the admin page unlocks with an admin's PIN; the first Go live updates that same item (no second item).
127. **Reading back a column.** Create reads each new column with `fields/getbyid('<id>')`, the id taken from SharePoint's answer to the create (or, without
    one, `fields/getbyinternalnameortitle('<name>')`). **Expect** 89 reads back after 89 creates, each answering the column it made.
128. **A Create that stops part-way is finished by pressing it again.** Close the tab while Create is in step 2. Open Setup again: **Show the plan** names only what
    is left (the columns not made, their indexes, and the settings of any list Setup made whose settings are not made yet), and **Create** finishes; then the plan
    says "Nothing to create" and the site is marked ready.
129. **The read of the site's lists.** `/_api/web/lists?$select=Id,Title,BaseTemplate,Hidden,Description,EnableAttachments,EnableModeration,EnableVersioning`
    answers in one page (note whether it sends `__next`). With `"listPrefix": "Test"` beside lists with no prefix, the plan names only `Test...` lists and Create
    sends nothing to the others (look at every write's address). A list made through REST under `TestPMSClients` has the item type
    `SP.Data.TestPMSClientsListItem` (the data layer reads it, so another name still works; note it).
130. **Add an admin.** On the new site: Admins says "There is no admin on this site yet."; add one with a PIN of 6 to 12 digits typed twice. **Expect** one item in
    PMSAdminUsers (AppId `admin-` and 8 hex, Name and Title the name, PinHash 64 hex), no request in the network panel carries the PIN, the admin page unlocks
    with it and not with 1234 or a wrong PIN. A seed file imported later brings no admins and says so.
131. **The 255-character limits.** In Content type or paste 300 characters into an answer's text: the field stops at 255 and says "255 characters: the most an
    answer's text can hold."; the question saves. The same for a client's name on Clients. (The data layer also refuses a longer single line in its own words
    before anything is sent; SharePoint's own refusal is no longer reached.)
132. **The picture library Setup made.** Create makes `PMSClientImages` as a document library (template 101). Upload a logo in Brand Studio and open the participant
    page: the picture shows, from `/sites/<site>/PMSClientImages/...`.

### Phase 10f (the new site, the sample pictures, the release package): not verified outside this Mac, the mocked SharePoint and the local server

The release package's `RUNBOOK.md` (`npm run package:release`) is the order to do these in, on `https://internal.global.deloitteonline.com/sites/PCOE`, folder
`Shared Documents/PMS`; it says which item each step answers. Its steps were rehearsed on the mocked SharePoint with the package's own pages, twice (an empty site,
and a hand-built one with a misnamed column): `npm run test:rehearsal`. **Every point below is UNPROVEN until the new site shows it.**

133. **The sample pictures in the library.** Setup, **Seed sample clients** on the new site. **Expect** "Complete: 76 created, 0 completed, 0 already present. Pictures:
    6 uploaded, 0 already in the library.", and six files in `PMSClientImages`, named and sized as `migration/src/lib/sample-pictures.js` lists them (a logo, a hero and
    a background for Kroger and for Domino's, WebP), uploaded BEFORE the two clients were made. The library's file listing (`/_api/web/lists/getbytitle('PMSClientImages')/RootFolder/Files`)
    is read once; a second press reads nothing of it, uploads nothing and writes nothing. If the library refuses the listing, the seed stops before any client is made.
134. **The sample pictures on the pages.** With Kroger live: Welcome on an iPad shows the "Operate at the speed of Fresh" badge and the dark blue background, loaded from
    `/sites/PCOE/PMSClientImages/...` with the participant account's own sign-in; Domino's shows the ball and the gingham. Brand Studio shows each client's three pictures
    as Saved; Today's readiness has no "no logo or hero image" warning for either. The logos are the clients' real logos, as files: nothing is redrawn.
135. **The permissions.** As RUNBOOK.md step 10 sets them (the table is also in SHAREPOINT-LISTS.md, "Permissions"): a participant account can open every participant
    screen, save answers, scan a code and see the pictures, and **cannot read PMSAdminUsers** (Check Permissions says None; `/_api/web/lists/getbytitle('PMSAdminUsers')/items`
    is refused for it). A facilitator can go live, edit Content, upload in Brand Studio and read Results. What a participant page does when a list it only reads is refused
    (a write it should not send) is not known.
136. **The folder address in QR codes.** On Today the participant link and its QR code are `https://internal.global.deloitteonline.com/sites/PCOE/Shared%20Documents/PMS/index.html`
    (the page works it out from its own address; nothing is built in). A guest's printed code is that address with `?qr=<code>`; scanned with an iPad's camera it opens the
    page in that folder. Files moved to another folder or site mean every printed code must be printed again.
137. **One activity end to end on the new site.** Kroger live; one iPad answers "Kroger's History" to its end ("5 of 5 right on the first try"); Results shows today's session
    with one participant and those answers; the leader report (PDF) and the CSV download.

### Phase 10g (the settings file is `pms-config.txt`): the first finding from the real site

**Observed on the real site, 14 Oct 2026** (the package `pms-50ae628` uploaded to `Shared Documents/PMS` on `https://internal.global.deloitteonline.com/sites/PCOE`, a classic
SharePoint; reported by VJR, not seen by the automated tests): the three pages open as pages; `setup.html` started, worked out its site from its own address and reported the build
`pms-50ae628`; it then stopped with `PMS-CFG-002` ("the site sent a web page in its place"). Opening `.../PMS/pms-config.json` in a browser shows SharePoint's own page, "Sorry,
something went wrong: File Not Found", **although the file is in the folder**, and a page's request is answered with that page and a success status (so it is not a 404 to the
page, which is why it was read as a web page). **This site will not serve `.json` files from a document library.** The same file renamed `pms-config.txt` in the same folder **is
served as its text**. The file is `pms-config.txt` since Phase 10g, with the same content and rules; nothing reads a `.json` beside it. Everything else in this section and the ones
before it has still not been seen on the real site: the lists, Setup's plan, Create, Mark ready, Add an admin, Go live and the iPad.

138. **A missing `pms-config.txt` comes back as a 404.** *(Still to see.)* On the PCOE site, rename `pms-config.txt` in the folder (to `pms-config.old`, say) and open
    `.../Shared%20Documents/PMS/pms-config.txt` in the browser with the developer tools' Network panel open. **Expect** HTTP status 404 for it (the body does not matter).
    Then reload `setup.html`: **expect** "This copy of the app has not been set up yet" (`PMS-CFG-001`), as item 89 says. If the site answers a missing `.txt` with its
    "File Not Found" page and status 200 instead (as it did for the `.json`), Setup says `PMS-CFG-002` with `page 200` in the Details: the page then stops, which is the safe
    side, but a build-time `PMS_` fallback can never be used on that site; tell the developer what the line says. Put the file back.

### Phase 10h (three fixes from the first real-site run): what the real site showed, and what is still to see

**Observed on the real site, 14 Oct 2026, evening** (the package `pms-969bf16` in `Shared Documents/PMS` on `https://internal.global.deloitteonline.com/sites/PCOE`, Chrome on Windows;
reported by VJR, not seen by the automated tests): runbook steps 1 to 9 passed (Create made 13 lists, 89 columns and 47 settings in 42.5 s with 149 writes; Check Lists all ready; the
site marked ready, version 2; an admin added; Seed sample clients "76 created ... Pictures: 6 uploaded"; `PMSAdminUsers` locked to the site owners). Then:

- **`ClientId` is left out of an item read that does not name its columns.** The admin's Content tab and Today's readiness said Kroger and Domino's had no activities. The four
  seeded activities are on `PMSActivities` with the right `ClientId`: `.../getbytitle('PMSActivities')/items?$select=Id,Title,AppId,ClientId,Enabled&$top=20` returned
  `sec-trivia` and `sec-guess-the-brand` with `c-kroger`, and the two Domino's activities with `c-dominos`. The same read without `$select` (`items?$top=200`, what the data layer
  sent) returned every column of the list **but** `ClientId` (its `InternalName`, `StaticName` and `EntityPropertyName` are all `ClientId`, type `Text`). Why, and whether other
  columns or lists are affected, is not known. Since Phase 10h every item read names its columns (`pms-schema.js` `selectOf`), and the mock leaves `ClientId` out of an unnamed read
  as this site does. This very probably explains the 13 Oct report from the old site (an activity "assigned on the popup, not shown on Kroger's activities, no error"): the write
  worked and the read lost the column.
- **SharePoint refuses a duplicate with 500, not 400.** Setup's self-test step "A second create with the same AppId is refused" said FAIL: "Refused, but not as a
  duplicate: SharePoint (500): The list item could not be added or updated because duplicate values were found in the following field(s) in the list: [AppId]." The data
  layer read a refusal as "it is there already" (409) only for 400 with those words, which the mock said and this site does not. Every path that meets a record already
  there leans on it (a participant's answers after a lost reply, a visit's track, the visit log, two admins at Go live, seeding, the seed-file import, a copy, a slug
  that is taken): each would have failed outright on this site. Since Phase 10h a refusal is a duplicate when SharePoint says 400, 409 or 500 with its duplicate
  error code or with words about duplicate or unique values; any other 500 stays a 500, and the error keeps the status SharePoint said (`sharePointStatus`).
- **Seen once, cause unknown, to watch:** in the admin page's console, one plain `GET .../getbytitle('PMSActivities')/items?$top=200` from the page (most likely the Content tab's
  15-second look, which swallows its errors) was answered **403 Forbidden**, where the same address from the console was answered 200 a moment earlier. Nothing in the app
  explains it. If it happens again, note the time, the tab, what the Network panel shows for that request (status, response body) and whether the page went on working.

139. **What this site leaves out of an unnamed read.** *(Still to see.)* Setup, **Run self-test** on the PCOE site (it makes and deletes one item of its own). The row
    "Probe (read-only): columns this site leaves out of a read that names no columns" reads one item of every list that has one, without `$select` and with it, and lists any
    column the first left out. **Expect** at least `PMSActivities: ClientId`. Send the whole line back: it says which other lists and columns this site leaves out (nothing in
    the app depends on it any more; it says whether the cause is ClientId alone).
140. **Content and Today after the fix.** With the Phase 10h pages: Content shows Kroger's two activities and Domino's two; Today's readiness for Kroger says "2 activities are
    live" and nothing blocks Go live; Go live with Kroger says "Verified: participants now see Kroger"; Results names Kroger on the session's card. (A create's reply is assumed
    to leave `ClientId` out as a read does; the data layer completes it from what it wrote either way.)
141. **A read that names a column the list lacks.** *(Only on a broken site; still to see.)* The mock refuses it with 400 ("The field or property 'X' does not exist."), as
    SharePoint is believed to. On such a site every page that reads that list stops with SharePoint's words naming the column, where Today used to load and show the missing
    column as a blocker; Setup's Check Lists (which reads the lists' columns, not their items) still names it. Seen only if a column is deleted by hand after Setup marked the site ready.
142. **The site's error code for a duplicate.** *(Still to see.)* The data layer knows a duplicate by its words, which this site sent in English, or by SharePoint's error
    code, which is assumed (`Microsoft.SharePoint.SPDuplicateValuesFoundException`, as the mock's `DUPLICATE_CODE` has it) because the tenant's own was not captured.
    In Chrome on the PCOE site: open the developer tools' Network panel, run Setup's self-test, and click the request of the step "A second create with the same AppId
    is refused" (a POST to `PMSParticipantAnswers/items` answered 500). Send back its Response body: the `error.code` line says which code this site gives. **Expect**
    the step to say "Refused: AppId enforces unique values." with the Phase 10h pages.

#### Phase 10i: a column SharePoint will not return by name (schema version 3)

**Observed on the real site, 15 Oct 2026** (the package `pms-e250a36` in `Shared Documents/PMS` on the PCOE site, Chrome on Windows; reported by VJR, not seen by the
automated tests):

- **Setup's self-test:** "Passed: 10 of 10 steps, 37 requests". The step "A second create with the same AppId is refused" said "Refused: AppId enforces unique values."
  (item 142's expectation; the site's `error.code` was not captured).
- **Content** showed each client's activities (item 140, in part). **Go live:** Domino's went live, with the "Staff mode" warning only.
- **The participant page** (Chrome on Windows): Welcome greeted the person by their SharePoint name and showed the hero badge; both activities were listed; the thank-you screen
  said "2 activities completed, 3 of 8 right on the first try".
- **Results did not load:** "SharePoint (400): Value does not fall within the expected range." The failing request, from the console, was the visit log's read of
  `readNameSources`: `GET .../getbytitle('PMSVisitLog')/items?...&$select=Id,AppId,SessionId,ClientId,Page,EntryMode,SharePointUserId,DisplayName,VisitorId,...`.
- **A console check** read every custom column of every list on its own (`items?$select=Id,<column>&$top=1`) and compared each field's `InternalName` with its
  `EntityPropertyName`: every list "all fine", no column whose `EntityPropertyName` differs from its internal name, **except** `PMSVisitLog`: `DisplayName: 400 Value does
  not fall within the expected range.` `PMSGuestList` also has a `DisplayName` column and passed, but had no items; `PMSGuestQRCodes` had no items either. An unnamed read of
  `PMSVisitLog` (`items?$top=1`) returned `Id, ServerRedirectedEmbedUri, ServerRedirectedEmbedUrl, ContentTypeId, Title, ComplianceAssetId, AppId, SessionId, Page, EntryMode,
  SharePointUserId, VisitorId, VisitorName, TrackId, VisitedAt, ID, Modified, Created, AuthorId, EditorId, OData__UIVersionString, GUID`: no `ClientId` and no `DisplayName`.
- **The likely cause:** `DisplayName` is also the name of a property SharePoint gives every list item (`SP.ListItem.DisplayName`); a column with that name can be written but not
  read back through REST. With a guest on the site, the QR check-in of a named guest (it reads the guest by AppId, naming its columns) and Guests and QR would have failed the
  same way. Since Phase 10i (schema version 3) the columns are `PMSGuestList.GuestName` and `PMSVisitLog.SignedInName`; the old `DisplayName` columns stay on the site, and
  nothing reads them. Item 139 (what the site leaves out of an unnamed read besides `ClientId`): the probe's line was not reported; the console read above shows `DisplayName`
  left out too.

143. **Which columns this site will not return by name.** *(Still to see.)* On the PCOE site, after the steps of RUNBOOK.md's note up to its step 7 (so the guest
    list and the codes each have an item), Setup, **Run self-test**. The row "Probe (read-only): columns this site will not return by name" reads one item of each
    list that has one, naming every column the list has (read from its fields), and, if that is refused, each column alone. **Expect** `PMSGuestList.DisplayName`
    and `PMSVisitLog.DisplayName`, each "no longer used since version 3; 400: Value does not fall within the expected range.", and no column of the app; the
    lists it could not test because they are empty are named too. Send the whole line back. If it names `PMSGuestList.DisplayName`, a refusal needs only an item to
    return (that list passed on 15 Oct 2026 because it was empty); if it names a column of the app, the app's reads of that list fail on this site.
144. **The QR check-in of a named guest on PCOE.** *(Still to see.)* With the live session in "Guests scan a personal QR", one guest added on Guests and QR and
    their code made (the note's step 7): an iPad scans the code. **Expect** Welcome to say "Hi" and the guest's name, the guest's row on Guests and QR to say Joined,
    and Results to name them with their answers. (The scan reads the guest by AppId, naming the list's columns: since version 3 the name is
    `PMSGuestList.GuestName`; version 2's `DisplayName` would have been refused once the guest existed, and with it the check-in and Guests and QR.)
145. **The PCOE site brought from version 2 to version 3.** *(Still to see.)* RUNBOOK.md's note: Setup says the lists are version 2 and this version needs 3
    (PMS-LST-011, with what to press); Show the plan says "0 lists, 2 columns, 0 settings to create." (GuestName, SignedInName) and lists the two old `DisplayName`
    columns as harmless; Create says "Created 0 lists, 2 columns and 0 settings in ... s (2 writes)."; the line under Mark the site as ready says "Raised the
    lists from version 2 to version 3."; Check Lists is all Ready; Results then loads the live session, with the visit of 15 Oct as "Unnamed participant 1" (its
    sign-in name is only in the old column, which the site will not return). Not known until then: that SharePoint makes the two columns as the mock does (each is
    read back; Create stops and says so if not), and that the MERGE of `SchemaVersion` lands (it is read back too).

#### Phase 10j: fewer waits on the participant page

**Reported on the real site, 15 Oct 2026** (the package `pms-da9fc8d` on the PCOE site, its lists of version 3; reported by VJR, not seen by the automated tests): the
participant page "responds slowly (showing loading)". The live client has only a handful of activities, so the data is small. On the mocked SharePoint the page waited
for 4 rounds of requests (requests that wait for each other, one after another) before Welcome, 7 or 8 when "Click here to begin" was pressed, 1 on every arrival on the
hub and 1 on opening every activity but the first; since Phase 10j it waits for 2, 2 (4 if pressed at once), none and none (`scripts/test-participant-waits.js`,
RELEASE-10J.md). How long one round takes on the site is what nobody has measured: the timing check measures it.

**The timing check** (read-only, in Chrome, on `index.html`; RUNBOOK.md's note for the PCOE site, steps 1 and 4):

1. Open the participant page fresh (Ctrl+F5).
2. Begin a visit, open an activity, finish it, and go back to the hub.
3. F12, Console, paste the line below, press Enter, and send the table and the summary line.

```
(()=>{const n=performance.getEntriesByType('navigation')[0];const e=performance.getEntriesByType('resource').filter(x=>/\/_api\/|pms-config/.test(x.name));const t=e.map(x=>({at:Math.round(x.startTime),ms:Math.round(x.duration),status:x.responseStatus??'',kb:Math.round(x.transferSize/1024),what:decodeURIComponent(x.name.split('/_api/')[1]||x.name.split('/').pop()).replace(/&?\$select=.*$/,'').slice(0,80)}));console.table(t);const d=t.map(x=>x.ms).sort((a,b)=>a-b);console.log(`page file ${Math.round(n.responseEnd-n.startTime)} ms, ${Math.round(n.transferSize/1024)} KB | requests ${d.length}, median ${d[d.length>>1]} ms, slowest ${d[d.length-1]} ms | fields reads: ${t.filter(x=>/\/fields/.test(x.what)).map(x=>x.ms+' ms, '+x.kb+' KB').join('; ')||'none'}`)})()
```

| Run | Page file | Requests | Median | Slowest | Reads of a list's columns | 429 or 503 |
|---|---|---|---|---|---|---|
| Before: `pms-da9fc8d`, PCOE | *(still to see)* | | | | | |
| After: the Phase 10j package, PCOE | *(still to see)* | | | | | |

146. **The timing check, before and after, on PCOE.** *(Still to see.)* RUNBOOK.md's note, step 1 with the pages there now (`pms-da9fc8d`) and step 4 with the Phase
    10j pages, each in Chrome after the same visit (fresh load, begin, one activity to its end, back to the hub). **Expect** about as many requests after as before
    (the mock says 30 for a whole visit of two activities where there were 33), started in fewer bunches one after another: in the table's `at` column, Welcome's reads in two
    bunches, the press of "Click here to begin" in two, and no read of an activity's questions when it opens (they were read, all at once, once the first screen was up).
    What one request costs there is the median; send both tables and both summary lines.
147. **The size and time of a read of a list's columns on PCOE.** *(Still to see.)* The summary line's "fields reads:". Before Phase 10j the column check that comes
    before a list's first write read `.../fields` with no `$select`, which a real list answers with every field it has, hidden ones too, each with its whole definition
    (on the mock: 2,690 B named, 15,902 B not, for PMSParticipants' 13 fields; a real list has many more). With the Phase 10j pages each such read names eight
    properties. **Expect** the "after" reads to be a fraction of the "before" ones in KB and in ms. (Setup's and the admin's schema checks still read every property:
    not part of this check.)
148. **Whether the site answers 429 or 503.** *(Still to see.)* The table's `status` column, before and after. A 429 or 503 means SharePoint asked the page to wait (the
    page waits for as long as `Retry-After` asks before it asks again); the timer's looks are paced for that. **Expect** none for one person's visit.
149. **An activity opens at once, with an edit made in Content.** *(Still to see.)* On the iPad of the note's step 8: after one activity, back on the hub, open the
    other: no "Loading activity..." line. Then, with the iPad on the hub, change a question's words in Content (admin page), open another activity on the iPad, go back to
    the hub, and open the activity whose question changed: it shows the new words. (The hub reads the activities and the enabled ones' questions and options behind
    what it shows, on each arrival; an activity already open keeps what it opened with.)

#### Phase 11a: the Results charts, names on the charts, Deloitte's colours

**What VJR saw on the real site, 15 Oct 2026**: Admin → Results → Live results showed plain blue bars and totals only ("34 answers from 5 iPads"), and nothing showed
what Mike A, a guest who joined by their own QR code and finished four activities, had picked. Phase 11a draws a chart of its own kind for each question in
Deloitte's colours, with a headline in words, and on the facilitator's own view a bar opens the names of the people who picked it. All of it ran against the local
server and the mocked SharePoint REST in Chromium, WebKit and Firefox (RELEASE-11A.md); none of it has met the real site, a projector or an iPad.

150. **A named guest on the right bar.** *(Still to see.)* On PCOE, with a session live in "Guests scan a personal QR": a guest (say Mike A) scans their code and answers
    one activity. Admin → Results → **Live display**: press the bar of the answer they picked. **Expect** `Who picked: <answer> (N people)` under that card, with
    "Mike A" and the time they answered among the names, and as many names as the bar counts. Press the bar of an answer they did not pick: they are not there.
151. **Full screen and the wall page show no names.** *(Still to see.)* On the same Live display press **Full screen**, then **Next** through every question: no
    participant's name anywhere (the written answers have no names under them). Leave it, press **Open in a new tab**, enter the PIN in the new tab: its heading is
    "Live results · Wall display", there is no **Names shown** switch, and no name anywhere, its full screen included. (The browser test reads the whole page for the
    names; on the site, look.)
152. **Show answer.** *(Still to see.)* On the wall (either), a quiz question (a single choice or true or false with a correct answer) marks no answer and says nothing
    about who got it right until **Show answer** on its card; then the correct answer is Dark Green, with a tick and "Correct", and the line "N of M got it right
    first time" appears. On the facilitator's own view it is always marked.
153. **The table view.** *(Still to see.)* On each kind of question, **View as table**: the same numbers as the chart (people, share, a ranking's support score, points
    and first places, a scale's average, the words and their counts), the numbers right-aligned; **View as chart** brings the chart back.
154. **The charts on an iPad in Safari.** *(Still to see.)* The Live display on an iPad, upright and on its side: nothing scrolls sideways, every label is whole (long
    answers wrap), a tap on a bar opens its names and the close button (×) closes them, the scale's average line does not run through a number, and full screen
    shows one question whole. (Safari does not focus a tapped button; Esc on a keyboard closes the names opened last.)
155. **A staff sign-in name on the Live display.** *(Only in staff mode; still to see.)* A member of staff's name is in the visit log, which Results reads and the Live
    display does not (no request was added, VJR's choice of 16 Oct 2026). **Expect**: opened from Results, the Live display names them; opened straight from its
    address in a new tab, the same person is "Unnamed participant N" there.
156. **Deloitte's colours on a projector.** *(Still to see.)* On the room's projector, full screen: the top choice (Deloitte Blue) stands out from the other bars (the
    tint) and the correct answer (Dark Green) from both, and the words read from the back of the room. (In greyscale the pairs measured 2.72:1 to 4.53:1 apart;
    pictures in `test-results/charts/grey-*.png`.)

#### Phase 11a-2: the charts fit their card, tooltips are never cut off, the headlines' words

**What was seen on the real site, 16 Oct 2026** (`pms-3fb312a`, a colleague's Windows laptop in Chrome, photographed by VJR): in full screen a confidence question's chart
had a scrollbar of its own, its tooltip ("2 people · 100%") was cut off at the chart's bottom edge and lay over the middle step's label, and the card had an empty white
space under the chart; on the admin view a card stretched to the height of its neighbour whose names were open; confidence columns were thin; the scale's figures under
the bars were not on their gridlines; a headline said "Most people (50%) chose ..." and another ended "... co.."; Kroger's header said "34 answers from 5 iPads" though one
visit had answered nothing. Phase 11a-2 fixed them all (the last as VJR chose: the screens count the iPads that answered; the PDF and PowerPoint wait for 11b). All of it ran against the local server in Chromium,
WebKit and Firefox at nine sizes and at a Windows laptop's scaling (1536x864 at 125% and 150%); none of it has met that laptop, a projector or an iPad.

157. **A confidence question in full screen on the Windows laptop.** *(Still to see.)* On the laptop that showed the fault (Chrome, Windows' own display scaling as it
    is), Admin → Results → **Live display** → **Full screen**, and **Next** to a confidence question. **Expect**: no scrollbar anywhere inside the white card; the columns
    are wide (40% of their step, up to about 110 px on a screen 1536 wide); the plot reaches down to the step names, with no empty white space under them; pointing at a column
    shows its tooltip whole ("2 people · 100%" and the step's name), above the column's number and clear of the step's name and of "Average ... of ...". Do the same on
    a single choice and a ranking: the figures under the bars ("0%", "50%", "100%") sit centred on their gridlines.
158. **The wall page.** *(Still to see.)* **Open in a new tab**, the PIN: on the same laptop and on the projector, nothing scrolls inside a card, every tooltip is whole,
    and two cards side by side each keep their own height. On the facilitator's own view, open the names of a bar: the card beside it does not grow.
159. **The headlines' words.** *(Still to see.)* A single choice whose top answer has exactly half ("2 of 4"): the headline says "The top choice (50%) was ...", never
    "Most people". Above half: "Most people (75%) chose ...". An answer whose words end with a full stop (Kroger's "Kroger grocery and Baking co."): the headline ends
    with that one full stop. A true-or-false question: "Most people (N%) said True." Ties, rankings and written answers say what they said before.
160. **"N answers from M iPads" counts the iPads that answered.** *(Still to see.)* Kroger's session of 16 Oct (five visits, which answered 9, 8, 0, 8 and 9 times): the
    Live display's header and its Results card's "Live results" both say "34 answers from 4 iPads" (they said 5). On a session that is live, begin a visit on an iPad and
    answer nothing: the count of iPads does not change on the next refresh, and goes up by one once that iPad has answered. (VJR's choice of 16 Oct 2026: the Live
    display's one-page PDF and PowerPoint still printed every visit, "from 5 iPads", until Phase 11b: item 167.)

### Phase 11a-3 (the polish batch after the 11a-2 real-site checks): not verified on the real site, an iPad, the laptop or a projector

**What was seen on the real site, 16 Oct 2026** (`pms-283ad18`, the Windows laptop in Chrome and an iPad in Safari, photographed by Satyadev): a chart's tooltip could lie over
the question, the "got it right first time" line and the Show answer / View as table buttons above its mark; client heroes showed as squares; a locked activity's title was too
faint to read. The brief also named a question of eight long answers cut off in portrait full screen. None of what follows has run in a browser yet: Playwright's browsers
were not installed on the machine the work was done on (see RELEASE-11A3.md).

161. **A tooltip and the words above its mark.** *(Still to see.)* On the laptop, Admin → Results → **Live display**, on the admin view and in **Full screen**: point at the top
    bar of a single choice, the first column of a confidence question and a side of a true-or-false question. **Expect** the tooltip whole and clear of the question, of
    "N answered · N of N got it right first time" and of **Show answer** / **View as table** (under its mark when there is no room above), and still clear of the mark's own
    label, the step names and "Average ... of ...". Only where the window has no room on either side may it lie over those words. The same on the iPad: a touch on a bar.
162. **Names in the "Who picked" panel and the CSV.** *(No change: VJR decided on 16 Oct 2026 to keep names as the directory gives them, "Last, First".)* Nothing to check beyond items 150 and 155.
163. **The wall page's header.** *(No change: VJR decided on 16 Oct 2026 to leave the admin header, tabs, Lock and Export on `/wall`; Full screen is the projector view.)*
164. **The participant page's heroes and greeting on an iPad.** *(Still to see.)* The heroes are opaque squares because the pictures stored for them are: VJR's sources were
    JPEGs, which cannot be transparent (Brand Studio keeps a hero's transparency). To see a round hero: in Brand Studio upload a hero that is a PNG with a transparent
    background, Save, reload the participant page. **Expect** the hero drawn with no square behind it. The greeting stays "Last, First" (VJR's decision, 16 Oct 2026). A locked
    activity on the hub: its title is white and readable (it was a pale blue on blue), with the lock and "Finish the previous activity".
165. **Eight long answers in portrait full screen.** *(Still to see.)* The large session's question of eight answers of about 90 characters (or any question that long), in
    **Full screen** on the iPad held upright, on a screen 1,600 px wide or more (a projector, a large monitor) and on the laptop with the window made short. **Expect** the whole
    card on the screen, or else the type made as small as it goes and the screen scrolling as one page with "More below": never a card cut at its edge. (Until 11a-3 a window
    1,550 px wide or more stopped making the type smaller before it reached its smallest, and cut the card. Whether that is what was seen on the real site is not known.)
166. **The network coming back during a look.** *(Still to see.)* On an iPad with a question open, turn Wi-Fi off, have the facilitator restart that activity, and turn
    Wi-Fi on. **Expect** the restart notice and the activity's first question within a few seconds, not a minute later.

### Phase 11b (the leader report and the Live display's one-page PDF and PowerPoint on the chart model and palette): not verified on the real site, in PowerPoint or on paper

Everything below was made in node with the same model, layout and writers the admin page uses, read back with pdf.js (the PDFs) and from the slides' XML (the PowerPoint),
rendered with pdf.js in Playwright's Chromium, and the one-page PowerPoint was exported to a picture by PowerPoint on Satyadev's Windows machine. None of it has been opened from
the real site, printed, or saved by a browser on the admin page (see RELEASE-11B.md).

167. **The Live display's Export PDF and Export PPT.** *(Still to see.)* Kroger's session of 16 Oct, Admin → Results → **Live display** → **Export PDF** and **Export PPT**.
    **Expect** the header of both to say "34 answers from 4 iPads" (the iPads that answered, as the Live display's own header; until 11b, "from 5 iPads"); each question drawn
    as on the screen, with its sentence above it, "N of M got it right first time" for a quiz question, a correct answer in dark green with a tick and the word "Correct", the
    top choice in blue with "Top choice", a ranking's places and support scores, a confidence scale's columns with its average; **no participant's name anywhere** in either
    file. Open the .pptx in PowerPoint (not a viewer): every shape and line where the PDF has it, the ticks drawn, nothing outside the slide. In the PDF, words in other scripts
    and emoji are left out (the PDF's Helvetica cannot draw them; the PowerPoint keeps them): a comment written only in Japanese shows as empty quotation marks.
168. **The leader report on the chart model.** *(Still to see.)* Results → **Leader report (PDF)** for Kroger and for Domino's, opened in Edge and in Acrobat. **Expect** the cover
    as it was (the logo, the title band in the client's colour, the tiles, completion, hardest and easiest); under "Results by activity" each question's sentence and "N of M
    got it right first time" above its bars, the bars in Deloitte's colours (the client's colour only in the title band, the rules and the completion bars), the correct answer
    in bold with a tick and "Correct", the ranking's places with "Support N · N pts", the confidence scale's columns and average; the comments with their names; and on the last
    page the eight counting rules, then the sentence "The Live display and its one-page PDF and PowerPoint count only the iPads that answered ...".
169. **The leader report in black and white.** *(Still to see.)* Print one leader report (and one Export PDF) on a black-and-white printer. **Expect** every chart to read by its
    words: the correct answer's tick and "Correct", "Top choice", each bar's count and share written beside it, a ranking's places, the scale's average. (The tint of the other
    bars is 2.4:1 on white, as on the screen: its value is always written beside it.)
170. **A session with one iPad.** *(Still to see.)* A session where one iPad answered one question. **Expect** "1 answer from 1 iPad" on the Live display's header, on its Results
    card and in the header of Export PDF and Export PPT (it said "1 answers from 1 iPads").

### Phase 8 (browsers, devices, accessibility, performance, the unsupported-browser page): not verified on a real device, a real screen reader, or the real SharePoint site

A printable sheet for the real devices, one page each for iPad Safari, iPhone Safari, Safari on a Mac, Chrome, Edge and Firefox, built from these items and from
items 15, 26 to 28, 35, 40 to 44, 46 and 53 to 56 above, is `DEVICE-TEST-SHEET.md` (in git history at `7347c72`).

59. **The engines are Playwright's own builds, on a Mac.** WebKit is not iPadOS Safari and Firefox is not a venue laptop's Firefox; Chrome is Chromium, and **Edge was
    not run at all** (it is Chromium, so it shares Chrome's results, which is a reasonable belief and not an observation). The matrix, with what does not run where and why,
    is in `migration/playwright.config.ts` and MIGRATION-PLAN.md, "Phase 8".
60. **The safe areas.** On an iPhone the header, the greeting and the Next bar must clear the notch, the Dynamic Island, the rounded corners and the home indicator. Chromium
    was given emulated insets (iPhone portrait: top 47, bottom 34; landscape: left and right 47, bottom 21) and every screen was checked against them; WebKit and Firefox
    cannot emulate insets, so for them the test only shows that the stylesheets use `env(safe-area-inset-*)` on all four edges. A real iPhone has not been looked at.
61. **Turning the device over.** Tested by changing the window's size in the middle of a question (the question, the chosen answer and what was in view stay), in three engines.
    That is a resize, not an iPad's `orientationchange` with its toolbars appearing and going; a real rotation (and what Safari's address bar does to the height) is not tested.
62. **Pinch-zoom.** The viewport tag has no `user-scalable=no` and no `maximum-scale`, and a synthetic pinch (gesture events and a two-finger `touchmove`) is not cancelled in a
    normal tab (it is with `?kiosk=1`). A real pinch on a real iPad, in a tab and from the Home Screen icon, has not been done.
63. **The unsupported-browser notice.** The feature test is proven by removing each feature the app needs in a real browser, the module-failure path by feeding a page a
    broken module, and the `nomodule` path by making the module inert and lifting the attribute (no engine here lacks module scripts), and the scripting-off path with JavaScript
    disabled. **No real old browser has been tried** (Safari 15 or 16.0 on an old iPad, an old Edge): whether such a browser reaches the notice, or fails in a way none of
    these paths covers, is unknown. The check is "does it have what the build needs", which is Safari 16.4 and later by the build's own target.
64. **Screen readers.** Playwright's `ariaSnapshot` shows the accessibility tree each engine builds; it is not VoiceOver, NVDA, JAWS or TalkBack. What a person is told (the heading
    on each new screen, "Correct" and "Incorrect" once, the locked activity's reason read with its name) was shown from the tree and the live region's text, in order, not heard.
65. **Colour as a real display shows it.** The contrast numbers are computed from the pixels the browsers painted (text 4.58:1 or better in every look, the focus ring about 9:1) and
    from axe-core; not checked on a projector, in sunlight or with a colour-blindness filter on a real screen. The red and the green of right and wrong each carry an icon and a word.
66. **The numbers in the performance table are the mock's.** Chromium on a Mac with a 4x slower CPU and the "Slow 4G" profile (1.6 Mbit/s, 150 ms) over a local HTTPS connection to the
    mocked SharePoint, which answers at once. The participant page's Welcome was usable in 1.7 s and admin Today in 4.33 s (3.2 s of it to get the page, 604 kB gzip, to the PIN
    screen: over the 3 s flag). A real iPad on the venue's Wi-Fi against the real site is not known; run the first load of both pages on the venue network, cold.
67. **Slow SharePoint.** With every request 800 ms late and one 429 with `Retry-After: 2`, Next advanced at once, the first answer was saved once (the refused write waited its two seconds
    and was retried), Completion waited for the saves, and there was one Responses item. The latency and the 429 are the mock's; the tenant's throttling is still unknown (item 6, item 38).
68. **The two changes to what a screen reader hears** (focus now goes to the heading of Welcome, the hub, and the admin after Unlock and after Lock) have been seen in the tree and by
    keyboard in three engines; how VoiceOver on an iPad reads them, and whether moving focus on Welcome when the page first opens is welcome or noisy, needs a person with VoiceOver on.
