# Copy-Ready Follow-Up Prompts

Use one template at a time after the [master prompt](MASTER-PROMPT.md) and approved [configuration](PROJECT-CONFIG.json). Replace angle-bracket placeholders. These are normal user prompts, not special model syntax. Do not send unresolved placeholders as if they were requirements.

## 1. Start the Approved Implementation

```text
Implement the approved Pursuits CEC plan for <profile> in <workspace>.
Approval covers local source edits/tests only, not deployment or production data.
Start with one working join -> answer -> Submit -> reload/resume slice.
Preserve the approved contracts and hosting/security constraints. Build only the
abstractions needed by this slice. Use synthetic data and a scratch datastore.
Run focused tests, report actual results, then continue through the approved plan.
After each completed slice, list exact artifacts, schema changes and manual upload
steps. Identify anything that requires a separate decision before continuing.
```

## 2. Change Frontend Stack, Preserve Behavior

```text
Migrate the frontend from <current> to <target>. Do not change the backend,
database schema, permissions, answer shapes, session lifecycle or user journeys.
First inspect the data-service contract, routes, styles and existing tests.
Explain what is reusable and what must be rewritten, including generated assets,
subfolder routing, framework lifecycle cleanup and bundle/dependency implications.
Propose the exact PROJECT-CONFIG changes and a phased migration with rollback.
Wait for approval, then migrate one screen at a time with contract/regression tests.
Preserve the existing design unless separately approved. No SSR or server features
when the hosting profile is SharePoint static. Finish with an exact upload manifest.
```

## 3. Change Database or Storage Provider

```text
Assess migration from <current storage> to <target storage> for Pursuits CEC.
Keep participant/admin behavior, logical IDs, answer ownership and result math.
Before coding, check hosting and authorization compatibility. Do not assume a new
server is approved. Identify whether this migration is possible under current rules.
If viable, define the new adapter, schema, indexes, uniqueness, ordering, transaction
boundaries, legacy-answer mapping, binary asset storage and permissions.
Plan approved export, dry-run import, count/tally comparison, cutover freeze, backup
and rollback. The starter-seed exporter is not a full participant-history export.
Wait for approval before migrations. Use sanitized scratch data for tests.
Do not put credentials in browser code or silently reinterpret old answer ownership.
```

## 4. Add or Change One Feature

```text
Feature: <specific user-visible behavior>.
Actor and trigger: <who does what>.
Acceptance examples: <Given / When / Then cases>.
Must remain unchanged: <routes, storage, permissions, design, exports, etc.>.
Inspect the owning module and nearby test first. Explain the smallest change and
whether it affects schema, data migration, URLs, progress, results or exports.
List loading, empty, success, error, cancellation and permission-denied behavior.
Do not turn this into a stack rewrite or unrelated cleanup. Implement after any
required scope approval, add focused tests and run existing relevant regression gates.
End with exact changed deployment files and SharePoint list/data actions, or say none.
```

Example acceptance request:

```text
Support multiple open-text questions in a feedback-only section. Require a
nonblank answer for each. Submit saves all using the existing per-answer contract;
partial failure retains drafts. Revisit/resume restores every saved answer.
Agenda completes only when all questions are saved. Results show each question
separately. Do not change hosting, authentication or existing answer schemas.
```

## 5. Design-Only Change

```text
Change <screen/component> to match <attached approved reference or description>.
This is presentation-only: preserve question IDs, data contracts, save timing,
validation rules, navigation semantics, permissions and results calculations.
Inspect existing design tokens and component styles. Reuse the current visual system
unless the reference explicitly approves a new one. Separate style from domain logic.
Provide responsive behavior at mobile/tablet/desktop widths, long-label handling,
visible focus, touch targets, contrast, disabled/error/loading states and reduced motion.
Use real synthetic screen states, not a marketing mockup. Verify via permitted browser
tools and disclose unavailable Safari/accessibility checks. Do not bypass host policy.
List only the changed deployment artifacts and state whether list changes are needed.
```

## 6. Change Hosting or Production Server

```text
Plan hosting for profile <profile> on <approved target; otherwise UNKNOWN>.
Expected participants: <number or unknown>. Data residency/retention: <requirements>.
Budget: <limit or unknown>. Identity provider/access model: <approved model or unknown>.
Do not deploy. First confirm compatibility and unresolved approvals.
Describe frontend/API/database/asset topology, TLS, secrets, authorization, durable
storage, migrations, health checks, logs, backups/restore and rollback.
For SharePoint static, explicitly confirm there is no production application server.
For a server profile, give supported runtime/service requirements and commands only
after the target is known. Do not guess subscription, tenant, DNS or credentials.
Provide a beginner-friendly runbook and separate local preparation from live operations.
```

## 7. Produce a Manual Upload Checklist

```text
Prepare the manual release checklist for the changes made in this task.
Last confirmed deployed baseline: <commit/artifact manifest or UNKNOWN>.
SharePoint application folder: <approved site/library>/p_cec_01.
I cannot upload folders. Group files by destination folder and show:
Add/Replace/Remove | local generated file | exact hosted path | reason | validation.
Include HTML templates, CSS, config, chunks, images and dependencies when changed.
Separately list required columns, list settings, record changes and migration order.
If the baseline is unknown, identify this task's files without calling it a complete delta.
Never infer changes from build timestamps alone. Include safe upload order, reload,
active-session risks and rollback. Do not upload or edit anything remotely.
Explicitly state when no file upload or no list change is needed.
```

## 8. Review Another Model's Implementation

```text
Review the implementation against the approved master prompt and configuration.
Do not edit yet. Lead with concrete findings ordered by severity and source references.
Check domain correctness, independent tracks, conditional QR claims, concurrent writes,
partial-save recovery, progress derivation, result/export agreement, SharePoint schema,
permissions, nested paths, privacy claims and deployment compatibility.
Distinguish observed failures from hypotheses. Propose a cheap reproducer for each
important finding. Flag missing tests and any claimed success not supported by evidence.
Do not approve merely because the UI looks complete or the project compiles.
```

## 9. Handoff to a Different Model

```text
Create a compact handoff for another coding model. Include:
- User goal, approved profile and non-negotiable constraints.
- Implemented versus proposed features; current task and next narrow action.
- Relevant changed files and why, public contracts and migration assumptions.
- Commands actually run, results, failing checks and known environment restrictions.
- Data safety rules, approvals not granted and exact deployment status.
- Outstanding decisions and the last confirmed deployed baseline.
Do not include secrets, real answers, private seed files, cookies or PIN hashes.
Keep facts separate from assumptions. Do not claim work is deployed just because it builds.
```

## 10. Generate or Refresh Design Documents

```text
Create/update low-fidelity and high-fidelity wireframes plus a UX handoff guide for
<approved scope>. Preserve the current feature contract unless changes are labeled.
Include participant, admin, setup, loading/empty/error/recovery and responsive states.
Use paired screen IDs, annotations, source ownership and synthetic content.
Provide editable sources, theme tokens, component states, accessibility acceptance
criteria and usability review tasks. Distinguish reconstruction from screenshots.
Export PDFs only through approved tools; disclose image-based or unverified outputs.
Validate page counts, clipping, assets and readability. Do not modify runtime code
or live data. Explicitly report that design documentation needs no app deployment.
```

## 11. Debug One Failure

```text
Observed behavior: <error and reproduction>.
Expected behavior: <specific contract>.
Environment: <local/SharePoint, browser, route, account role without credentials>.
Start from the failing request/module/test, form one falsifiable hypothesis and run
the cheapest discriminating check. Preserve data and unrelated changes.
Distinguish API mode/config issues from missing columns, permissions and sign-in expiry.
Do not broadly grant permissions, reset lists, reimport seeds or rewrite the stack.
Implement the smallest root-cause fix, rerun focused checks, then provide the exact
manual file/list update checklist. Report blockers and untested tenant behavior honestly.
```