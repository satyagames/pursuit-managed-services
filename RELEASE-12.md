# Phase 12: the local PCOE site, the UX review, and the approved fixes

**17 Oct 2026. Part 1 on `pms-12` (from `pms-11b`), Part 2 on `pms-12-fixes` (from `pms-12`). The package is `pms-d19bd14`. Nothing is pushed.**
Nothing of Part 2 has met the real site, a real iPad or a projector: the short live smoke test is at the end of [LOCAL-SITE.md](LOCAL-SITE.md).

## 1. What Part 1 made

- **A local stand-in for PCOE** (`scripts/local-site/`, [LOCAL-SITE.md](LOCAL-SITE.md)): the release package's pages byte for byte over HTTPS at
  `https://pms-local.test/sites/PCOE/Shared%20Documents/PMS/`, the REST API from the mock, the picture library, personas, latency, faults, nine scenarios,
  VJR's dummy dataset and pictures (git-ignored). Setup's own self-test passes on it, 11 of 11.
- **A screenshot harness and measurements** (`npm run ux:shoot`, `scripts/local-site/measure.js`, `font-metrics.js`).
- **[UX-REVIEW.md](UX-REVIEW.md)**: 25 findings, the dataset's gaps, the pictures' weight, the measurements, and the font recommendation.

## 2. What Part 2 changed (one commit each, every test written first and seen to fail)

| Finding | Change |
|---|---|
| F-01 | A single-choice or true-or-false poll is never a readiness blocker (SharePoint stores its "not correct" as No). |
| F-02 | The PIN screen says an account may not open the admin page, names the list and whom to ask (`lib/admin-unlock.js`). |
| F-03 | A used QR code: "This QR code has already been used. Ask your facilitator for a new code." |
| F-04 | The wall and full screen say only "N participants' answers could not be counted." (`wallUnreadableNotice`). |
| F-05 | A picture tile sits on the logo plate; while a verdict shows, the picture moves up and is drawn at 80% (no tile changes size). |
| F-08 | A Results card shows its Live results before the list of people. |
| Fonts | Open Sans stays embedded; `styles/fonts-fallback.css` (local Arial, size-adjust 104.46%, ascent 102.32%, descent 28.05%) is second in `--font-sans`. |
| F-10 | "Loading..." while the participant page starts. |
| F-11 | A chosen answer has a 2px ring and its number or letter in a badge. |
| F-13 | The phone's sticky bar is a light blurred fade, so a background picture shows through. |
| F-14 | "Correct" and "Top choice" share the baseline, with a dot between. |
| F-15 | Content: the activities column is the wider one; Delete at the end of the row. |
| F-17 | A switched-off button keeps a 2px edge at 70%. |
| F-20 | Opening an activity clears leftover confetti (`effects.ts` `clearEffects`). |
| F-24 | `robots noindex` on the participant page; an empty inline icon on all three pages. |

**Not changed, on purpose:** F-16 (the staff-mode warning twice: Phase 9b's rule); F-09, F-12, F-18, F-19, F-23, the reveal line, the seed pack and
Straight talk as a ranking (questions for VJR, UX-REVIEW.md section 9).

## 3. Gates (Node 22, this Windows machine)

| Gate | Result |
|---|---|
| `npm test` (every node suite, the request baselines among them) | **1,286 of 1,286** |
| `check:svelte` | 0 errors, 0 warnings, 363 files |
| `test:bundle` | 37 of 37; `PHASE_12`: participant +269 B, admin +340 B gzip in this checkout (allowances 600 and 1,000), Tailwind rules unchanged |
| `test:local-site` | 26 of 26 on pms-d19bd14 (Setup's self-test 11 of 11) |
| Browser specs edited this phase (`admin-today`, `review-9b`, `sharepoint`), Chromium | 58 of 59; the one is `admin-today.spec.ts:421` "slugs", the known flake (AGENTS.md), 1 in 3 alone |
| `test:rehearsal`, Chromium, on pms-d19bd14 | 6 of 6 |
| **Not run** | `test:migration` in full and in WebKit; Firefox (Windows refuses to start it: `spawn UNKNOWN`); `test:report:mutations`; `oracle -- --seeds 500` (no counting rule changed) |

## 4. The package

**`pms-d19bd14`**, made by `npm run package:release` from commit `d19bd14` in a fresh checkout: checksums pass in the folder (7 OK) and in a fresh unzip (7 OK).

| File | Bytes | gzip -9 | SHA-256 |
|---|---:|---:|---|
| index.html | 374,368 | 157,027 | `9cae99e5bf091d27acabc75a4a469c6a5bc7995d6ef28237594daa5c1bca3557` |
| admin.html | 1,538,195 | 559,126 | `3afac50a60add82fccc769d4c35183d048eb7e6059311afb88d34182ba48d3c4` |
| setup.html | 1,172,836 | 788,960 | `55c50be26ca5500ce7b55e062fa9de90fc59a11638662b34d9e9d74e1370653a` |
| pms-config.txt | 54 | | `04426124f56abad3973d69fb4a8608e673d86745419bf1cc41c5a70441cc607f` |

Upload the three pages to `Shared Documents/PMS` (the `pms-config.txt` there stays). Then the live smoke test of LOCAL-SITE.md: Setup's Build line and lists
version; the self-test 11 of 11; one Results screenshot; one participant screenshot on a Firm iPad.
