# History

One entry for each finished phase since the new site's first package: what it changed for good, and where its full report is. The reports are kept
as they were in [history/](history/), with the earlier records: [MIGRATION-PLAN.md](history/MIGRATION-PLAN.md) (the Svelte rebuild, Phases 1 to 9),
[ARCHITECTURE.md](history/ARCHITECTURE.md) (the legacy app), [PROVISIONING.md](history/PROVISIONING.md) and
[SHAREPOINT-DEPLOYMENT.md](history/SHAREPOINT-DEPLOYMENT.md) (the old site), [UX-REVIEW.md](history/UX-REVIEW.md) (Phase 12),
[EXPORT-DESIGN.md](history/EXPORT-DESIGN.md) (Phase 13's brief) and [Prompt_Lib/](history/Prompt_Lib/README.md) (a prompt library of 24 Sept 2026
for rebuilding the legacy app with another model: it describes the vanilla stack and is kept only as a record).

**Where the history is.** This copy of the repository starts at `2a84d29` (16 Oct 2026, VJR's files without their history); `3a8b32b` is the tree that
built the deployed `pms-283ad18` byte for byte. Phases up to 11a-2 are in VJR's history, not here: their commits are named in their reports.

| Phase | Package | Commits here | What it left behind |
|---|---|---|---|
| 10f | `pms-50ae628` | (VJR's history) | The six sample pictures, made by Brand Studio itself; `Design-Docs/` left the branch; the release package and its runbook; the new site is PCOE, folder `Shared Documents/PMS`, lists `PMS...` with no prefix. [Report](history/RELEASE-10F.md) |
| 10g | `pms-969bf16` | (VJR's history) | The settings file is `pms-config.txt`: PCOE will not serve a `.json` from a library. Steps 1 to 9 of the runbook ran on PCOE with this package (14 Oct 2026). [Report](history/RELEASE-10G.md) |
| 10h | `pms-e250a36` | (VJR's history) | Every item read names its columns; a duplicate is 409 however SharePoint says it; Setup carries the admin's tokens. [Report](history/RELEASE-10H.md) |
| 10i | `pms-da9fc8d` | (VJR's history) | Schema version 3: `GuestName` and `SignedInName` replace the two `DisplayName` columns; Setup brings an older site up; the self-test has 11 steps. [Report](history/RELEASE-10I.md) |
| 10j | `pms-0a1c701` | (VJR's history) | The participant page waits for fewer rounds: the activities' content is held for the page's life, writes are fetched ahead, the hub draws at once. [Report](history/RELEASE-10J.md) |
| 11a | `pms-3fb312a` | (VJR's history) | The Results charts, drawn by hand (Chart.js left the pages), in Deloitte's colours, one chart model; names on the facilitator's view only. [Report](history/RELEASE-11A.md) |
| 11a-2 | `pms-283ad18` | (VJR's history) | Nothing in a chart's card scrolls; tooltips in a layer of their own; the headlines' words; "N iPads" counts the iPads that answered. [Report](history/RELEASE-11A2.md) |
| 11a-3 | `pms-618b8fc` to `pms-e2fbfb6` | `3a8b32b`..`168ca75` | Tooltips keep clear of a card's words; full screen's type floor; a locked activity's title is white; a ranking's place is its number. The work moved to Satyadev's Windows checkout. [Report](history/RELEASE-11A3.md) |
| 11b | `pms-21462b6` | `3f4bc2d`..`cd7faf3` | The leader report and the Live display's PDF and PowerPoint on the chart model and palette; the chart figure on paper. [Report](history/RELEASE-11B.md) |
| 12 | `pms-d19bd14` | `d5879b8`..`8492ce8` | The local PCOE stand-in and its screenshot harness; the UX review's approved fixes; Open Sans stays embedded with a measured fallback. [Report](history/RELEASE-12.md) |
| 13 | `pms-757be5c` | `518e6dc`..`1ab63bd` | The files a leader gets, redesigned: At a glance, an activity per page, the summary pack, Summary by activity (CSV), takeaways from one model. [Report](history/RELEASE-13.md) |
| 14 | see [RELEASE-14.md](../RELEASE-14.md) | from `1ab63bd` | Structure only: `lib/` in folders by module, the shared code out of `public/`, a header on every module, the documents rewritten and checked against the code (`scripts/check-docs.js`). The pages behave as before. |

## What has met the real site

PCOE (`https://internal.global.deloitteonline.com/sites/PCOE`): steps 1 to 9 of the runbook (`pms-969bf16`, 14 Oct 2026); the self-test, Content, Go
live and a participant's visit (`pms-e250a36`, 15 Oct); the lists of version 3 and a visit (`pms-da9fc8d`); a named guest's visit by QR code and Results
(`pms-0a1c701`); the Results charts on a Windows laptop in Chrome (`pms-3fb312a`, 16 Oct); the charts' fit and tooltips on that laptop and an iPad
(`pms-283ad18`); Setup's self-test, 11 of 11 (16 Oct). The open checks are the first items of [QA-TESTING.md](../QA-TESTING.md).
