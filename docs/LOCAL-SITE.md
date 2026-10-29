# The local PCOE site (Phase 12)

A stand-in for the PCOE SharePoint site on your own computer, so a developer can open **the shipped pages** (the release package's own bytes) against
believable data and look at every screen on every device size before anything is uploaded. The live site then needs only the short smoke test at the
end of this file.

It is development tooling: no page imports it, and the release package never holds any of it (`npm run test:local-site` checks both).

## Start it (Windows or macOS, one command)

```bash
npm run local:site -- --open
```

That serves the newest package in `build-svelte/package/` (make one with `npm run package:release`, or pass `--package <folder>`) and opens
Playwright's own Chromium on the control page. Use **Node 22** (on the Windows checkout: `.local/node22/node.exe scripts/local-site/server.js --open`).

| Page | Address |
|---|---|
| Participant | `https://pms-local.test/sites/PCOE/Shared%20Documents/PMS/index.html` |
| Admin | `https://pms-local.test/sites/PCOE/Shared%20Documents/PMS/admin.html` |
| Setup | `https://pms-local.test/sites/PCOE/Shared%20Documents/PMS/setup.html` |
| Control page | `https://pms-local.test/__local/` |

**Why `https://pms-local.test` and not `http://127.0.0.1:5190`.** A page opened over plain http, or at `localhost` or `127.0.0.1`, takes itself for the
local Express server (`migration/src/lib/settings/address-check.js`) and never talks to SharePoint, so the shipped pages could not be tested there. On
`https://pms-local.test/...` they behave exactly as on PCOE: they read `pms-config.txt` beside them, work out the site from their own address and call
`/sites/PCOE/_api`. The name is in no DNS. `--open` starts a browser that maps it to the server (`--host-rules`) and accepts the server's own certificate;
nothing on the machine is changed. To use your own browser instead, add `127.0.0.1 pms-local.test` to the hosts file (needs an administrator), open
`https://pms-local.test:5190/__local/` and accept the certificate warning once.

Options: `--scenario <name>` (default `ready`), `--latency none|pcoe|slow` (default `pcoe`, about 350 ms a request, as measured on PCOE; `slow` is about
1,500 ms), `--port 5190`, `--fresh` (rebuild the scenario's data), `--freeze` (items' Created and Modified at 16 Oct 2026, 17:00 IST).

The admin PIN of every scenario but `empty` is **482916** (admin "Rivera, Morgan"). It is a made-up PIN for this mocked site only.

## What it is made of

- `scripts/local-site/server.js`: an HTTPS server. It serves the package's pages and `pms-config.txt` byte for byte (gzip, as SharePoint sends them), the
  REST API from the mock `scripts/sharepoint-fake.js` (its engine behind real HTTP: every list with its columns, `$batch`, unique `AppId`, `If-Match`
  versions, the picture library), and the library's files.
- What SharePoint does that the mock alone did not, each held by a test in `scripts/test-local-site.js`:
  - a `.json` file in the folder comes back as SharePoint's "File Not Found" page **with status 200** (PCOE, 14 Oct 2026);
  - a second `AppId` is refused with **500** and SharePoint's words (PCOE, 14 Oct 2026);
  - a read that names no columns leaves `ClientId` out; a column called `DisplayName` is refused by name (PCOE, 14 and 15 Oct 2026);
  - a read returns **100 items and a `__next` link** unless it asks for more with `$top`;
  - a 429 or 503 carries `Retry-After`; `$batch` works as SharePoint's does (reads only);
  - a write after the **write token expired** is refused once with "The security validation for this page is invalid", then the page gets a new token;
  - a query string over **2,048 characters** is refused (ASSUMED: ASP.NET's default; not measured on PCOE);
  - **`PMSAdminUsers` is readable by an admin only** (403 for anyone else, in a `$batch` part too);
  - a column deleted by hand gives SharePoint's own words naming the column;
  - a read that filters on a column with no index is refused (the mock's rule, stricter than SharePoint's 5,000-item list-view threshold).
  Each is switched off by `quirks: false`, which the tests use to show each check can fail.
- **Then Setup's own self-test runs on it and says "Passed: 11 of 11 steps"**, as it did on PCOE on 16 Oct 2026. That is the acceptance test of the stand-in.
- The data of each scenario is kept in `scripts/local-site/data/<scenario>/state.json` (git-ignored) after every write, so a restart keeps it; **Reset** on
  the control page puts the scenario back as it was built.

## Personas (who SharePoint says is asking)

Chosen on the control page; a cookie only the local server reads (the pages never know).

| Persona | SharePoint user | Notes |
|---|---|---|
| `admin` | Rivera, Morgan | An owner of the site; the only one who may read PMSAdminUsers. |
| `staff` | Okafor, Jamie | A Firm iPad signed in as a member of staff. |
| `guest` | PMS iPad, Shared | An iPad on the shared sign-in; the guest arrives with a personal QR code (the control page lists the unscanned ones). |
| `outsider` | Lindqvist, Sam | Signed in, not an admin: the admin page meets a 403 on PMSAdminUsers. |

## Scenarios

| Scenario | What it is |
|---|---|
| `empty` | A brand-new site with no lists: review Setup from the start (Show the plan, Create, Mark ready, add an admin). |
| `sample-pack` | Lists ready, one admin, and Setup's "Seed sample clients" pressed: the older Kroger and Domino's pack with the six shipped sample pictures. |
| `ready` | Lists ready, one admin, **VJR's dummy dataset** (Template, Kroger, Domino's; five activities each, 28 questions) and VJR's pictures if they are on disk; no session. |
| `tiles` | `ready` plus a **test-only** sixth Kroger activity of picture tiles (VJR's four tile pictures). |
| `event-day` | Kroger live on the dataset, 60 visits (45 guests by QR, 15 staff, some on a shared sign-in) at every stage: not started, part-way, to the end, restarted twice; a ranking tie, a 100% answer, a 50% answer, a question added late that nobody answered, an answer to an option removed since, one damaged answer item, a long comment, comments in other scripts, with emoji and starting with `=`. |
| `finished` | `event-day` with the session ended, and Domino's run to the end on two iPads the day before. |
| `pcoe-16oct` | Calibration: what PCOE showed on 16 Oct 2026, to compare with the photographs (UX-REVIEW.md says what could not be rebuilt). |
| `stress` | 60 clients, one session of 400 visits over 30 questions, one question with eight answers of 90 characters. |
| `chaos` | `ready`, answering a fault every sixth API request in turn: 429, 503, 500, a dropped connection, an expired write token. |
| `confidence-check` | Prompt 22: `ready` with the confidence check. Kroger and Domino's ask it; Kroger's session of 14 Oct (20 guests, 4 Before only) and Domino's of 15 Oct (12, 2 Before only) ended with their summaries written by the dashboard's own code; Kroger live today with the check (18 Before, 5 After). Unlock with the local PIN; Results shows the check, the Live display the Producer's card, the dashboard the shift by client. The other scenarios, and Setup's real **Seed sample clients**, gain no check: a site that already has the samples never gets one added behind its owner's back. |

Every scenario is built from a seeded generator with a fixed "now" (16 Oct 2026, 17:00 IST), so it is the same site every time. Every person in it is invented.

### VJR's dataset is dummy data

`scripts/local-site/datasets/pms-content-pack.json` is VJR's content pack and session flow of 17 Oct 2026, word for word. **It is dummy data**: the facts
(Deloitte founded in London in 1845, "Together makes progress", Kroger's headquarters and 84.51°, Domino's headquarters and "Piece of the Pie
Rewards") and the riddles are the author's and must be checked before any real session. Four activities had no description (Kroger's and Domino's "Open
feedback" and "Guess the brand"): the Template's is used, and the scenario's notes list them. The "reveal" lines have no column to live in; they are kept in
`data/<scenario>/reveals.json` and on the control page.

The **activities' purposes** are facilitator guidance and are stored nowhere in the app:

| Order | Activity | Purpose |
|---|---|---|
| 1 | Straight talk | Surface top priorities |
| 2 | Confidence continuum | Gauge confidence in Deloitte |
| 3 | Open feedback | Capture what matters in the client’s own words |
| 4 | MCQ | Warm up with a quick quiz |
| 5 | Guess the brand | Close on a light note |

### VJR's pictures

Eleven pictures (third-party brand artwork supplied by VJR for this internal app) go in `scripts/local-site/datasets/images/` under the names in
`scripts/local-site/datasets/branding.json`. That folder is **git-ignored**: the files are never committed, never packaged and never altered, and the
loader works without them (the slots are then empty, which is itself a state to review). Which client wears which picture is `branding.json`, in one
place. After adding them, rebuild the scenarios with `--fresh` (or Reset on the control page).

## The screenshot harness and the measurements

```bash
npm run ux:shoot
```

Writes `ux-review/<date>/` (git-ignored): a PNG of every screen and state on the review's devices, `index.html` (the contact sheet), `shots.json`, and
`ux-review.zip`. `--only participant,admin,setup`, `--devices laptop-1366,ipad-portrait`, `--font-variant <folder>` (the font experiment). WebKit stands in for
the iPad; Chromium for the Windows laptops and the projector; Firefox once for the main flows (Windows may refuse to start it: `spawn UNKNOWN`, as
[TESTING.md](TESTING.md) says; the harness records that and goes on).

`node scripts/local-site/measure.js` writes `ux-review/<date>/perf.json`: LCP, CLS, long tasks, input delay, scripting time and requests, in Chromium with
the CPU four times slower, at PCOE's latency and the slow profile, on `event-day` and `stress`.

`node scripts/local-site/font-metrics.js` measures the fallback face for Open Sans from the TrueType files.

## What the local site cannot show

- SharePoint's real permissions (only `PMSAdminUsers` is modelled), real throttling, real `$batch` limits, versioning or the recycle bin.
- Safari on a real iPad, Guided Access, the Firm iPad's MDM, its fonts, its keyboard and its audio. Playwright's WebKit on Windows uses Windows fonts.
- A real network: latency is added; bandwidth and packet loss are not.
- What SharePoint does on a cold cache, with its CDN, or when the folder's files are cached (a stale page after an upload: press Ctrl+F5).
- How the 2,048-character query limit really behaves on PCOE (assumed).

## The live smoke test after an upload (Satyadev)

After uploading a package to `Shared Documents/PMS`:

1. **Setup**: the Build line names the package, and "The lists are the version this app needs".
2. **The self-test**: "Passed: 11 of 11 steps".
3. **One admin screenshot** of Results with the Kroger session.
4. **One participant screenshot** on a Firm iPad in Safari.
5. **The Font line on Setup**, if it was added (UX-REVIEW.md, the font question).

Everything else is reviewed locally.
