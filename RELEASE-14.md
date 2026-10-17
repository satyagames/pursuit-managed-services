# Phase 14: the code in folders, the documents rewritten and checked, and the final build

Branch `pms-14` (from `1ab63bd`, the tip of `pms-13`), 17 Oct 2026, by Claude for Satyadev. **A change in structure only**: nothing a person sees, nothing
counted or stored, no list, column, request, URL or word on a screen changed. What was removed, moved and kept, with the evidence for each, is
[CLEANUP-LOG.md](CLEANUP-LOG.md); the rules this phase adds are in [docs/RULES.md](docs/RULES.md#rules-from-phase-14-structure-and-documents-keep-them-holding).

## 0. Where it started

- The untouched branch was measured first, on this machine (Windows, Node 22 from `.local/node22`, `core.autocrlf input`), into the git-ignored
  `build-svelte/baseline-14/`: every gate, the package `pms-1ab63bd` and its hashes, the export list of every module (`exports.txt`, 719 names), and
  the screenshots of the local site.
- The work was done in a git worktree (`../pms-14-wt`, branch `pms-14-wt`) while the baseline's browser run used the main checkout, then brought onto
  `pms-14`. A power cut paused the work once; nothing was lost (a work-in-progress commit, `8e9f92d`).
- Firefox does not start on this machine (`spawn UNKNOWN`), before and after: **Firefox was not exercised.**

## 1. Stage 1: cleanup and structure

PENDING
