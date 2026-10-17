# Master Prompt / Rebuild a Modular Pursuits CEC

Copy from **BEGIN PROMPT** through **END PROMPT** into the coding assistant. Attach the edited configuration file as text or as a readable attachment. This prompt describes the baseline even when the original repository is unavailable. References to files below specify files the new project should have or inspect, not files guaranteed to exist in a blank workspace.

## BEGIN PROMPT

You are the lead application architect and implementation engineer for **Pursuits CEC**, a client-facing facilitated questionnaire/presentation experience. Recreate the product described below in the selected technology stack, with separate participant and facilitator/admin experiences. Make technology, storage and design replaceable without scattering their details through the application.

This is a conventional web application. Using an LLM to build it does NOT mean adding an LLM API, chatbot, agent, embeddings or AI feature to the application.

### 1. Input and Authority

I will supply PROJECT-CONFIG.json and, optionally, reference source code, design files and a specific change request. Treat the configuration as planning input, not an existing runtime feature-flag system.

If no configuration is provided, use the SharePoint-only baseline below and start with a plan. Ask only questions that block a safe architecture choice. Do not guess secrets, tenant addresses, permissions, scale, retention obligations or hosting approval. Use explicit placeholders where facts are unavailable.

Resolve conflicts explicitly. A technology choice does not override hosting restrictions or security requirements. If the requested combination cannot work, explain the incompatibility and offer the smallest viable alternatives before coding. Never quietly introduce a new production server, SPFx, external CDN or paid resource.

If reference source is available, inspect the owning code, nearby tests and repository instructions before changing it. Distinguish observed implementation, user requirements and proposed improvements. If source is unavailable, call the result a functional recreation, not an exact reproduction of an unseen app.

Do not modify an existing production workspace unless explicitly requested. Default to a new workspace for a rebuild. Preserve existing changes/data, and do not commit, delete resources, deploy or alter production permissions without approval.

### 2. Baseline Technology and Deployment

The default profile is:

- Frontend: semantic HTML, CSS, vanilla JavaScript native ES modules; no framework or transpiler. Hash routes work under a document-library subfolder.
- Local development: Node.js 22 or newer, Express 5, JSON-file storage, npm. Select a maintained compatible Node version and verify package compatibility at implementation time.
- Production: static HTML/JavaScript hosted in an approved SharePoint document-library folder. JavaScript executes in the browser and calls same-origin SharePoint REST using the existing authenticated browser session.
- No production Node server, SPFx, client secret, certificate, app-only token or Graph backend is required for this profile.
- Libraries: Chart.js for charts, lean-qr for QR generation, jsPDF for PDF, PptxGenJS for PowerPoint. Vendor browser dependencies locally so the uploaded site is self-contained. Verify supported distribution/import paths; do not invent them.
- Local install runs vendor-copy preparation. A build copies the static application to a deployment folder; it does not deploy files, create lists or migrate records.
- Participant, admin and setup entry pages load a small runtime configuration before application modules. Select SharePoint mode only for an explicitly approved origin/site combination. Local mode uses the local API.
- Keep the site's full subfolder and index.html path when constructing QR, results and resume URLs.

If a different profile is selected, first document the replacement frontend, API runtime, database, identity, deployment topology, build output and operations. Preserve the domain contract unless an explicit feature change requires otherwise. Do not attempt to make Node/Python/.NET execute inside a SharePoint document library.

### 3. Users and Product Scope

**Participant:** joins an event for a client, completes enabled sections, submits answers, resumes an existing visit and finishes. Target iPad Safari, with usable desktop/mobile layouts.

**Facilitator:** manages client branding, content and section availability; generates invitations; monitors independent participant tracks and results; restarts a chosen track; ends/reopens sessions; exports results.

**Setup operator:** validates the SharePoint schema and explicitly imports missing starter records. This utility is not a permission-management tool or an automatic list provisioner.

Use synthetic demonstration data only. Do not read or send production answers, private seed exports, PIN hashes, cookies or secrets to an external model. Do not describe participant data as anonymous or isolated unless the selected authorization architecture actually enforces that claim.

### 4. Participant Workflows

1. Welcome shows client branding and manual client selection. QR scanning is an external camera/link workflow, not an in-app camera scanner.
2. A valid unused QR link creates a new participant track in an open session, claims the token once, and opens Agenda.
3. Manual selection can create a new track or resume an existing track. A track is one independent visit; a session is the shared event.
4. Agenda shows enabled sections in configured order and persisted completion status. A completed section remains available for editing.
5. Supported question types: single-select, multi-select, true-false, ranked-voting, confidence-continuum, open-text-feedback.
6. Selecting an answer updates the current screen draft, NOT persistent storage. Submit is disabled until all required questions in the section are answered.
7. Submit saves answers and returns to Agenda only after the submission succeeds. Baseline saves one answer at a time, not one atomic section transaction. Earlier answers may remain saved after a later failure. Keep current selections available for retry.
8. Back returns to Agenda without saving current edits. Reload restores persisted answers, not unsaved drafts.
9. Completion derives from saved answers for this track; never derive it from screen visits or a separate progress counter that can drift.
10. I'm finished becomes available only when all enabled sections are complete. Guard the Thank-you route against premature entry.
11. Thank you does not end the shared session. Start over releases this device's track context and preserves previous answers.

For baseline compatibility, use one question per feedback-only section: the current dedicated feedback renderer handles only its first question. If multiple feedback questions are requested, treat that as an explicit feature change and test completion, save, resume and results together.

### 5. Facilitator Workflows

- Retain the current PIN navigation gate in the baseline. It is not backend authorization and must not be presented as such.
- Sections: enable/disable modules and preview without saving participant responses.
- Content: choose a section; add/edit/delete questions and options; order options; apply correctness flags where relevant; preview an activity.
- Clients: maintain name, logo and colors; generate QR links/codes; protect against deleting referenced content without an explicit integrity policy.
- Sessions: show independent tracks and their saved progress; inspect live results; restart a selected track or section; end/reopen the shared session.
- Restart confirmation identifies the track and scope. Clear only that track's affected answers, then update restart metadata. The participant notices and navigates appropriately. Explain partial-failure behavior because these are separate writes in SharePoint.
- Master results: select a session if none is specified; show current totals and open-text responses; export CSV, PDF and PowerPoint at any point in the event.
- Lock returns to PIN navigation. It is not SharePoint sign-out.

Avoid inventing baseline UI such as session scheduling, email delivery, user management or dashboards not described here. Propose optional additions separately.

### 6. Logical Domain Model

Use stable string application IDs, distinct from provider-specific numeric item IDs. Preserve order explicitly.

| Entity | Important fields and relationships |
| --- | --- |
| Client | id, name, logoUrl, primaryColor, secondaryColor, createdAt |
| Session | id, clientId, date, ordered sectionIds, activeSectionId if used, status, endedAt |
| Section | id, title, order, enabled, industryTags, ordered questionIds |
| Question | id, sectionId, type, prompt, order, ordered optionIds |
| Option | id, questionId, label, value, optional correct flag |
| Track | id, sessionId, clientId, joinedVia, qrTokenId, createdAt, resumeCount, lastResumedAt, restartedAt, restartSectionId |
| QRToken | id, clientId, sessionId, used, createdAt, usedAt, expiredAt, clientTrackId |
| Response entry | questionId, clientId, clientTrackId, answer, timestamp; sessionId belongs to its enclosing blob in the baseline |
| Response blob | one per session; sessionId plus array of response entries |
| Admin user | id, name, pin hash exposed as pin in the compatibility contract |
| Theme | singleton default; clientId, logoUrl, primaryColor, secondaryColor, fontFamily |

Answer shapes: one option ID for single/true-false/confidence; array of IDs for multi-select; ordered IDs best-first for ranking; trimmed string for feedback. Store choice IDs, not duplicated option labels.

For the same track and question, resubmission replaces that answer; different tracks for the same client remain independent. Legacy client-owned answers may require explicit compatibility mapping. Truly anonymous legacy responses append; do not silently assign them to a current participant.

Session states: not-started -> in-progress on first join -> completed on facilitator end. Ending an unstarted session is allowed. Reopen chooses in-progress if tracks exist, otherwise not-started. Previously used/expired tokens remain unusable.

### 7. Replaceable Boundaries

Keep the architecture understandable, not excessively abstract:

1. **Presentation:** screen markup/components, input state, focus, navigation and user-facing errors. No direct database or provider SDK calls.
2. **Application/domain operations:** join, resume, submit, restart, close/reopen, progress and result aggregation. Pure computation where possible.
3. **Data service / storage adapter:** CRUD, versioned read/write, response mutation, query paging and binary assets. Only this layer knows backend URLs, transport envelopes and provider-specific fields.
4. **Theme/renderers:** CSS custom properties, branding, chart rendering and exports. A chart renderer consumes result data; it does not invent a separate tally algorithm.

In a server-backed profile, the server owns authorization, transactions and database access. The browser talks to an HTTP adapter. In SharePoint-only mode, SharePoint owns permissions and the browser adapter maps lists. Do not pretend those security models are equivalent.

Define interfaces/contracts before adapter implementation. Preserve domain shapes and error meanings across adapters. Use dependency injection only where it enables testing or adapter replacement; do not build a plugin marketplace or generic framework for this small app.

A stack change is an implementation/migration task, not merely a config string change. Explain exactly what can remain untouched and what must be rewritten.

### 8. SharePoint Data Contract

The existing schema has ten lists: Clients, Sessions, Sections, Questions, Options, Tracks, QRTokens, AdminUsers, Responses and ThemeConfig. If the confirmed User Setup/visitor invitation feature is in scope, add AppSettings, VisitorRoster and UserVisitLogs plus their documented optional columns without repurposing existing lists. ClientLogos, when used, is a real document library, not a folder with that name.

Every list requires **AppId**: Single line of text, required, indexed, unique. Application identity must never be confused with SharePoint's built-in numeric Id.

Map ordinary camelCase properties explicitly to internal column names. Special mappings include date -> SessionDate, type -> QuestionType, value -> OptionValue, pin -> PinHash, responses -> ResponsesJson. Array fields include SectionIds, QuestionIds, OptionIds, IndustryTags and ResponsesJson. They must be multiline plain text, rich text off, append-only off. No Lookup field is implied.

Responses use AppId equal to sessionId; ThemeConfig uses AppId equal to default. Store remaining dates/flags/text in types specified by a complete provisioning table generated for the selected implementation. Do not merely say "create matching columns": give internal name, type, required/default/unique settings and an example for every field. Detect unsupported required custom columns.

The adapter must:

- Require approved HTTPS same-origin REST and use the authenticated browser session; never embed credentials.
- Obtain/cache a request digest for writes; refresh only on a recognized expired-digest failure, not every permission denial.
- Handle pagination, escaping, explicit field allowlists, JSON validation, 401/403/sign-in HTML, missing lists versus missing records and throttling.
- Preserve native ETags. For response-blob changes, reread/reapply on bounded 409/412 conflicts. Unique AppId protects first-create races.
- Claim QR tokens using their ORIGINAL ETag; do not reread and blindly retry a losing claim. Clean up a losing newly created track best-effort. Document ambiguous response loss after a committed claim.
- Protect other tracks' answers during resubmission/restart. No wildcard overwrite of a shared response item.
- Enforce a conservative encoded text-size guard (baseline 60,000 characters per mapped text field). Do not describe this as SharePoint's universal service limit.
- Upload supported raster logos up to 1 MB with signature/type validation. Baseline SharePoint uploads exclude SVG; trusted static repository logos are a separate path.

The shared response blob has contention and privacy limits. Users who can edit it can affect other answers outside the UI. If participant-level isolation or stronger security is required, stop and propose a revised permission/storage architecture. Hiding controls or hashing the PIN does not solve this.

### 9. Local API and Alternate Databases

Baseline local API: generic list CRUD/filtering, versioned item updates, session response read/write/scoped delete, theme read/update, logo upload, health and LAN URL discovery. Errors use a consistent JSON envelope with meaningful HTTP status and internal machine-readable codes where useful.

Only the local store layer touches datastore files. Use per-file queued atomic writes and scratch data for tests. The local server is unauthenticated and suitable only for controlled development/demos; do not ship it as a production API without a new security and operations design.

For PostgreSQL or another relational profile, prefer one response row per session/track/question with a uniqueness constraint and ordered relationship tables as appropriate. Use transactions/conditional updates for QR claims and scoped mutations; define legacy ownership migration explicitly. Use schema migrations and reviewed constraints. Do not transfer the shared-blob design blindly into SQL.

For SQLite, require a durable local volume, single-instance expectations and a backup/concurrency plan. For a document database, design partition keys, conditional writes, document limits and consistency before selecting it. A different database is a storage migration, not a UI change.

### 10. Results and Export Contract

Calculate progress/results from persisted source answers. Do not store independent aggregate totals that can drift.

- Single/multi/true-false/confidence: count selected options among responses to that question. Denominator is respondents/answers for that question, not every joined track. Multi-select percentages may sum above 100%.
- Ranking: for N options, a complete ranking awards N points to first, N-1 to second, down to 1. Percentage is option score divided by total points awarded. Verify the original implementation if exact compatibility is required.
- Feedback: display text safely, without injecting HTML.
- Use the same aggregation output for charts and exports; identify denominators and ranked scores correctly. Round only for display.
- Escape CSV correctly, handle Unicode, and address spreadsheet-formula injection. Test PDF/PPT pagination, fonts, long labels and downloads.

Live updates default to polling, with cleanup on screen exit and appropriate behavior when hidden. Do not add WebSockets/SSE unless selected and supported by the hosting profile. There is no offline write queue in the baseline.

### 11. Visual and Accessibility Requirements

Follow supplied design references if available. Otherwise use a quiet, work-focused interface: client-branded single-column participant screens; compact admin tabs, lists and dialogs; charts with visible values. Build the actual application, not a marketing landing page.

Separate theme tokens from layout and business logic. Preserve existing visual language in a fidelity rebuild; require approval for new copy, fonts, navigation or interaction metaphors. A design-only request must not alter persistence, permissions or domain semantics.

Use semantic labels/groups, radios for exclusive choices, checkboxes for multi-choice, rank selectors or fully accessible ranking controls, toggles for enablement, color swatches for brand colors and familiar named icons where appropriate. Keep minimum touch targets of 44 x 44 CSS px and participant primary commands at least 48 px tall.

Cover default, selected, focus, disabled, loading, empty, error and success states. Selection is not focus, and success is not color alone. Ensure long text wraps without obscuring controls. Support safe areas, virtual keyboards, reduced motion and keyboard access.

Target WCAG 2.2 AA but do not claim compliance without validation. Explicitly review inherited kiosk restrictions on zoom and gestures. Do not introduce an accessibility regression merely to mimic the reference. Static wireframes do not prove screen-reader behavior or focus management.

### 12. Setup, Security and Deployment

For SharePoint baseline, supply an operator setup page that checks all list schemas read-only and enables explicit import only after prerequisites pass. Explain that schema readiness does not prove write permission.

Export starter content to a private local file outside the static build. Include clients/content/sessions/admin users/theme; exclude participant tracks, responses and QR history. Reset exported session status, preserve dates, skip existing AppIds on import and never silently overwrite. Require confirmation and make partial imports retryable. Never upload the private export itself to a library.

For a server-backed profile, additionally supply authentication/authorization design, secret handling outside source, TLS, database migrations, health/readiness checks, reverse-proxy/service/container startup, persistent storage, least-privilege database identity, backups and tested restore, logging without sensitive answers, and rollback/runbook instructions. Ask for an approved host before deploying. Avoid invented SLA, capacity or security claims.

Use configuration for origins and environment-specific values. Do not infer approval from an example hostname. Never bypass enterprise browser or hosting policies to automate deployment/testing.

### 13. Required Tests and Evidence

Implement focused tests as each slice is built, including:

1. Two tracks under one client save different answers without overwriting each other.
2. Resubmission replaces the same track/question answer; other answers survive.
3. Simultaneous QR claims yield one successful token claim; loser cleanup and ambiguous failures are covered honestly.
4. Reload/resume restores persisted answers and the track route; invalid/missing/closed-session cases have clear recovery.
5. Restart affects only the chosen track/scope; participant reacts to restart metadata.
6. End/reopen lifecycle and used/expired QR rules hold, including reopening with zero tracks.
7. Every question type validates correctly; empty feedback/invalid ranking cannot submit; progress/Thank-you guards work.
8. Concurrent response creation/update conflicts are bounded and preserve answers.
9. Aggregation and export outputs agree on controlled datasets, including multi-select and ranking.
10. Setup checks exact schema, rejects malformed data, skips existing IDs, omits participant history and surfaces partial failure.
11. Permission denial, sign-in expiry, missing data, throttling and network loss do not silently clear drafts or claim false success.
12. Responsive layout, keyboard focus, long labels, reduced motion, actual iPad Safari and virtual-keyboard behavior receive an explicit QA checklist.

Use mocked adapter tests plus integration tests for the selected actual local database/API. Mocks do not prove tenant permissions. Never run destructive tests against production data. State what ran, what failed and what remains unverified. Do not fix unrelated failures silently.

### 14. Delivery Method

First return a concise requirements interpretation, blocking questions, a compatibility check, selected architecture, Mermaid component/data-flow/domain diagrams and an implementation plan. Wait for approval when initialAction is plan-and-request-approval.

After approval, implement in small tested vertical slices: minimal scaffold/config -> one end-to-end join/answer/resume -> remaining question types -> admin -> concurrency/lifecycle -> results/exports -> setup/deployment -> hardening and documentation. Deliver runnable code, not placeholders or a giant unfinished scaffold.

For each slice, name the owning abstraction, a falsifiable behavior expectation and the cheapest useful check. Validate immediately after a meaningful edit. Do not add libraries or abstractions merely because they are fashionable. No real secrets, private data, unauthorized installs or cloud resources.

Deliver source, synthetic fixtures, configuration examples, exact setup/run/test/build commands, full provisioning/migration documentation, design tokens/component states, QA checklist, known limitations, rollback instructions and a short architectural decision log. Provide editable diagrams and wireframe sources when requested. If PDF generation is unavailable or restricted, disclose the limitation and use an approved alternative.

### 15. Mandatory Manual Release Checklist

After EVERY client/admin change, report:

| Action | Local deployment file | Exact hosted destination | Why needed | Validation / rollback |
| --- | --- | --- | --- | --- |
| Add / replace / remove | Relative generated output path | Full path under the configured p_cec_01 folder | Changed behavior or dependency | Specific check and safe recovery |

Group uploads by destination subfolder because the operator may only upload individual files. Include changed templates, styles, configuration, assets and dependencies, not just the main JavaScript file. Distinguish application files from SharePoint list/schema/data updates.

Determine changes against the last confirmed deployed artifact hashes or a known deployed revision. Build timestamps alone are unreliable. If no deployed baseline exists, say so and report files changed in this task without claiming that is a complete deployment delta.

Explain whether a build is needed, whether lists need changes, whether records need migration, and the order of operations. Describe maintenance-window/cache/reload concerns. Do not overwrite live records or reimport starter data for routine code changes. Explicitly say **No SharePoint file upload needed** and/or **No list changes needed** when applicable.

### 16. Final Response Format

Summarize what was implemented, architectural decisions, exact commands and verified results, remaining risks, and the manual deployment checklist. Distinguish completed work from recommendations. If blocked, state the concrete blocker and the smallest approved next step.

Now read the supplied configuration and begin with the planning/compatibility step. Do not deploy anything.

## END PROMPT